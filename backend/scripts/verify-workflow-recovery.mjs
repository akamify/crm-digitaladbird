// Cold physical backup of a freshly created, stopped TEST cluster only.
// Never accepts a database URL or external directory and never reads .env.
import {cp,mkdtemp,readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';

export async function verifyRecovery({databaseDir,port,server,cwd}) {
  const source=path.resolve(databaseDir);
  if(path.dirname(source)!==path.resolve(tmpdir()) || !path.basename(source).startsWith('crm-workflow-test-')) {
    throw new Error('Recovery rehearsal accepts only a freshly generated test-cluster directory.');
  }
  const config={host:'127.0.0.1',port,database:'postgres',user:'postgres',password:'local-test-only'};
  async function cleanStop(instance,directory) {
    if(process.platform!=='win32') return instance.stop();
    const pgctl=path.join(cwd,'node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe');
    await promisify(execFile)(pgctl,['-D',directory,'stop','-m','fast','-w','-t','60'],{windowsHide:true});
    // The embedded package uses taskkill /f on Windows and its stop() waits on
    // a future exit event. pg_ctl has already stopped/reaped this child cleanly.
    instance.process=undefined;
  }
  const quote=name=>'"'+name.replaceAll('"','""')+'"';
  async function fingerprint(pool) {
    const tables=(await pool.query(`SELECT schemaname,tablename FROM pg_tables
      WHERE schemaname IN ('public','readiness') ORDER BY schemaname,tablename`)).rows;
    const result=[];
    for(const table of tables) {
      const name=`${quote(table.schemaname)}.${quote(table.tablename)}`;
      const {rows:[row]}=await pool.query(`SELECT COUNT(*)::int AS rows,
        md5(COALESCE(string_agg(digest,'' ORDER BY digest),'')) AS digest
        FROM (SELECT md5(row_to_json(t)::text) AS digest FROM ${name} t) s`);
      result.push({...table,...row});
    }
    return result;
  }
  let pool=new pg.Pool(config);
  const before=await fingerprint(pool);
  const lead=(await pool.query(`SELECT l.id,l.assigned_to_user_id,u.role FROM public.leads l
    JOIN public.users u ON u.id=l.assigned_to_user_id JOIN public.counselor_workflow_state s ON s.lead_id=l.id
    WHERE l.deleted_at IS NULL AND u.role IN ('member','partner') LIMIT 1`)).rows[0];
  await pool.end(); pool=null;
  await cleanStop(server,source); // Files are never copied from a running cluster.
  const backupDir=await mkdtemp(path.join(tmpdir(),'crm-workflow-backup-'));
  const restoreDir=await mkdtemp(path.join(tmpdir(),'crm-workflow-restore-'));
  const start=Date.now();
  await cp(source,backupDir,{recursive:true,errorOnExist:true,force:false});
  const backupMs=Date.now()-start;
  const version=await readFile(path.join(backupDir,'PG_VERSION'),'utf8');
  await stat(path.join(backupDir,'global','pg_control'));
  const recoveryStart=Date.now();
  await cp(backupDir,restoreDir,{recursive:true,errorOnExist:true,force:false});
  const restored=new EmbeddedPostgres({databaseDir:restoreDir,user:'postgres',password:'local-test-only',port,persistent:true});
  let running=false;
  try {
    await restored.start(); running=true;
    pool=new pg.Pool(config);
    const after=await fingerprint(pool);
    if(JSON.stringify(before)!==JSON.stringify(after)) throw new Error('Restored table data differs from backup source.');
    const indexes=(await pool.query(`SELECT schemaname,indexname FROM pg_indexes
      WHERE tablename IN ('counselor_workflow_state','counselor_workflow_events') ORDER BY schemaname,indexname`)).rows;
    const health=await pool.query(await readFile(path.join(cwd,'scripts/counselor-workflow-health.sql'),'utf8'));
    // Load only the service with an injected test DB; never initialize the real app/config.
    const require=createRequire(import.meta.url);
    const configPath=require.resolve('../src/config/database.js');
    const db={query:(...args)=>pool.query(...args),withTransaction:async fn=>{
      const client=await pool.connect();
      try {await client.query('BEGIN');const value=await fn(client);await client.query('COMMIT');return value;}
      catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    }};
    require.cache[configPath]={id:configPath,filename:configPath,loaded:true,exports:db};
    const {createService}=require('../src/services/counselorWorkflowService.js');
    const service=createService(db,{logger:false,rolloutMode:'pilot',rolloutAt:'2020-01-01T00:00:00Z',pilotStarts:{[lead.assigned_to_user_id]:'2020-01-01T00:00:00Z'}});
    const user={id:lead.assigned_to_user_id,role:lead.role};
    const detail=await service.read(user,lead.id);
    const list=await service.workspace(user,{view:'received',lead_view:'all_time'});
    if(!detail.enabled || !detail.state || !list.rows.some(row=>row.id===lead.id)) throw new Error('Restored application service read failed.');
    const report={result:'PASS',scope:'Local synthetic recovery rehearsal; not deployed staging',method:'Cold physical copy after clean PostgreSQL shutdown; separate restored cluster directory',
      postgres_major:version.trim(),backup_ms:backupMs,recovery_and_validation_ms:Date.now()-recoveryStart,
      backup_directory:backupDir,restored_directory:restoreDir,tables:after,indexes,
      table_fingerprint_sha256:createHash('sha256').update(JSON.stringify(after)).digest('hex'),
      health_statements:Array.isArray(health)?health.length:1,application_service_reads:'PASS',
      limitations:['Synthetic minimal CRM schema, not a full application backup','Same PostgreSQL binaries and machine','No deployed staging app, JWT/login, provider snapshot or production RTO verified']};
    await writeFile(path.join(cwd,'../STAGE7_RECOVERY_RESULTS.json'),JSON.stringify(report,null,2)+'\n');
    console.log('Local recovery rehearsal PASS:',JSON.stringify({tables:after.length,backup_ms:backupMs,recovery_ms:report.recovery_and_validation_ms}));
  } finally {if(pool)await pool.end();if(running)await cleanStop(restored,restoreDir);}
}
