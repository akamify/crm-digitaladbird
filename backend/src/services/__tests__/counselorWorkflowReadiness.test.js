jest.mock('../../config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
const fs=require('fs');
const path=require('path');
const {Pool}=require('pg');
const {workspace}=require('../counselorWorkspaceService');
const {membership,createService}=require('../counselorWorkflowService');
const integration=process.env.COUNSELOR_WORKFLOW_TEST_URL?describe:describe.skip;

integration('Stage 6 synthetic scale and migration readiness',()=>{
  let pool,user,migrationMs;
  const query=(...args)=>pool.query(...args);
  beforeAll(async()=>{
    const url=new URL(process.env.COUNSELOR_WORKFLOW_TEST_URL);
    if(url.hostname!=='127.0.0.1') throw new Error('Isolated loopback database required.');
    pool=new Pool({connectionString:url.toString(),options:'-c search_path=readiness -c timezone=UTC',max:2});
    await query(`CREATE SCHEMA readiness;
      CREATE TABLE users(id uuid PRIMARY KEY,role text);
      CREATE TABLE leads(id uuid PRIMARY KEY,assigned_to_user_id uuid,assigned_at timestamptz,deleted_at timestamptz,
        full_name text,phone text,email text,source text,category text,stage text,campaign_name text,campaign_label text,next_followup_at timestamptz);
      CREATE TABLE lead_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid,user_id uuid,assigned_to_user_id uuid,previous_user_id uuid,assigned_at timestamptz);
      CREATE INDEX idx_leads_assigned ON leads(assigned_to_user_id) WHERE deleted_at IS NULL;
      CREATE INDEX idx_lead_assignments_lead ON lead_assignments(lead_id);
      CREATE INDEX idx_assignment_owner_date ON lead_assignments(COALESCE(assigned_to_user_id,user_id),assigned_at DESC,lead_id);
      INSERT INTO users SELECT gen_random_uuid(),'member' FROM generate_series(1,50);
      CREATE TABLE fixture_users AS SELECT id,row_number() OVER() AS n FROM users;
      INSERT INTO leads SELECT gen_random_uuid(),u.id,NOW()-INTERVAL '1 day',NULL,'Test lead '||g.n,NULL,NULL,'manual','trader','new',NULL,NULL,NULL
        FROM generate_series(1,50000) g(n) JOIN fixture_users u ON u.n=(g.n%50)+1;
      INSERT INTO lead_assignments(lead_id,user_id,assigned_to_user_id,assigned_at) SELECT id,assigned_to_user_id,assigned_to_user_id,assigned_at FROM leads;`);
    const start=Date.now();
    const migration=fs.readFileSync(path.join(__dirname,'../../db/migrations/074_counselor_workflow_foundation.sql'),'utf8');
    await query(migration); await query(migration);
    migrationMs=Date.now()-start;
    console.info('Readiness migration on 50000 existing leads (two applications), ms:',migrationMs);
    expect((await query('SELECT COUNT(*)::int AS n FROM counselor_workflow_state')).rows[0].n).toBe(0);
    await query(`INSERT INTO counselor_workflow_state(lead_id,primary_status,journey_active,queue,generation,assigned_to_user_id,assignment_at,enrolled_at,workflow_started_at,move_to_pending_at)
      SELECT id,'cnr',TRUE,'old',1,assigned_to_user_id,assigned_at,NOW(),NOW(),NOW()+INTERVAL '1 hour' FROM leads;
      INSERT INTO counselor_workflow_events(lead_id,event_type,actor_id,source,occurred_at,primary_status,generation,idempotency_key,work_source,is_work,new_state)
      SELECT l.id,'remark_saved',l.assigned_to_user_id,'synthetic_test',NOW()-n*INTERVAL '1 minute','cnr',1,'test-'||n,
        CASE WHEN n%2=0 THEN 'new' ELSE 'old' END,TRUE,'{}'::jsonb FROM leads l CROSS JOIN generate_series(1,10) n;
      ANALYZE leads; ANALYZE lead_assignments; ANALYZE counselor_workflow_state; ANALYZE counselor_workflow_events;`);
    user={id:(await query('SELECT id FROM users LIMIT 1')).rows[0].id,role:'member'};
  },120000);
  afterAll(async()=>{if(pool)await pool.end();});
  test('50k leads / 500k events: summary, work-date, search, pagination and bounded history plans',async()=>{
    const plans=[];
    const db={query:async(sql,params)=>{
      const plan=(await query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,params)).rows[0]['QUERY PLAN'][0];
      const scans=[];
      const walk=node=>{if(/Scan/.test(node['Node Type']))scans.push({type:node['Node Type'],relation:node['Relation Name'],index:node['Index Name'],rows:node['Actual Rows'],loops:node['Actual Loops']});(node.Plans||[]).forEach(walk);};
      walk(plan.Plan);
      const kind=sql.includes('classified AS')?'classification':sql.includes('ROW_NUMBER()')?'compact_history':sql.includes('LIMIT 51')?'full_history':sql.includes('SELECT l.id')?'worker_enrollment':'worker_deadlines';
      plans.push({kind,ms:plan['Execution Time'],scans});
      return query(sql,params);
    }};
    for(const view of ['worked','old','pending','call_issues','received']){
      const result=await workspace(db,user,{view,lead_view:'all_time'},membership);
      expect(result.total).toBe(view==='pending'?0:1000);
      expect(result.summary.worked).toBe(2000);
      expect(result.worked).toEqual({n:1000,o:1000});
      if(result.rows.length) expect(result.rows[0].history).toHaveLength(8);
    }
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const page=await workspace(db,user,{view:'worked',lead_view:'daily',from:today,to:today,q:'Test lead',source:'manual',page:2},membership);
    expect(page.rows).toHaveLength(25);
    expect(page.rows.every(row=>row.assigned_to_user_id===user.id)).toBe(true);
    const worker=createService({query:async(sql,params)=>{await db.query(sql,params);return {rows:[]};},withTransaction:async fn=>{
      const client=await pool.connect();
      try {await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
      catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    }},{logger:false,rolloutMode:'pilot',rolloutAt:'2020-01-01T00:00:00Z',pilotStarts:{[user.id]:'2020-01-01T00:00:00Z'}});
    await worker.tick();
    await db.query('SELECT * FROM counselor_workflow_events WHERE lead_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 51 OFFSET 50',[page.rows[0].id]);
    fs.writeFileSync(path.resolve(__dirname,process.env.COUNSELOR_WORKFLOW_PLAN_REPORT || '../../../../STAGE6_QUERY_PLANS.json'),JSON.stringify({
      synthetic:true,leads:50000,events:500000,counselors:50,migration_twice_ms:migrationMs,plans,
    },null,2)+'\n');
    console.info('Readiness synthetic query timings:',JSON.stringify(plans.map(({kind,ms})=>({kind,ms}))));
    expect(plans.every(p=>p.ms<5000)).toBe(true);
  },120000);
});
