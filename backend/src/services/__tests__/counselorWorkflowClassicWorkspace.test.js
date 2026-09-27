jest.mock('../../config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
jest.mock('../../middleware/rbac',()=>({getVisibleUserIds:jest.fn(async user=>[user.id])}));
const {Pool}=require('pg');
const {randomUUID}=require('crypto');
const database=require('../../config/database');
const lifecycle=require('../lifecycleService');
const suite=process.env.COUNSELOR_WORKFLOW_TEST_URL?describe:describe.skip;
suite('original workspace with counselor journey views (PostgreSQL)',()=>{
  let pool,user,other,ids;
  const input={journey:'true',lead_view:'daily',from:'2026-09-25',to:'2026-09-25'};
  beforeAll(async()=>{
    const url=new URL(process.env.COUNSELOR_WORKFLOW_TEST_URL);
    if(url.hostname!=='127.0.0.1')throw new Error('Isolated loopback database required');
    pool=new Pool({connectionString:url.toString(),max:1,options:'-c search_path=classic_workspace_test'});
    await pool.query('CREATE SCHEMA classic_workspace_test; SET search_path TO classic_workspace_test');
    database.query.mockImplementation((...args)=>pool.query(...args));
    await pool.query(`
      CREATE TABLE workflow_settings(key text,value jsonb,label text,updated_at timestamptz);
      CREATE TABLE users(id uuid,full_name text);
      CREATE TABLE leads(id uuid,full_name text,phone text,email text,source text,campaign_name text,campaign_label text,category text,
        assigned_to_user_id uuid,assigned_at timestamptz,created_at timestamptz,updated_at timestamptz,last_call_at timestamptz,
        next_followup_at timestamptz,call_status text DEFAULT 'not_called',stage text DEFAULT 'new',deleted_at timestamptz);
      CREATE TABLE lead_lifecycle_state(lead_id uuid,journey_stage text,terminal_state text,last_call_result text,current_primary_action_id uuid);
      CREATE TABLE lead_actions(id uuid,action_type text,reason text,due_at timestamptz,status text);
      CREATE TABLE lead_call_attempt_sequences(id uuid,lead_id uuid,status text);
      CREATE TABLE lead_call_attempts(id uuid,lead_id uuid,sequence_id uuid,status text,scheduled_at timestamptz,attempted_at timestamptz,created_at timestamptz);
      CREATE TABLE lead_assignments(lead_id uuid,assigned_to_user_id uuid,user_id uuid,previous_user_id uuid,assigned_at timestamptz);
      CREATE TABLE lead_lifecycle_events(id uuid,lead_id uuid,event_type text,occurred_at timestamptz,metadata jsonb);
      CREATE TABLE lead_remarks(id uuid,lead_id uuid,workflow_step int,created_at timestamptz);
      CREATE TABLE lead_call_logs(id uuid,lead_id uuid,created_at timestamptz);
      CREATE TABLE lead_labels(id uuid,name text,color text,deleted_at timestamptz);
      CREATE TABLE lead_label_assignments(lead_id uuid,label_id uuid,created_at timestamptz);
      CREATE TABLE counselor_workflow_state(lead_id uuid,assigned_to_user_id uuid,assignment_at timestamptz,primary_status text,
        queue text,journey_active boolean,awaiting_primary boolean DEFAULT false,move_to_old_at timestamptz,move_to_pending_at timestamptz,followup_override boolean);
      CREATE TABLE counselor_workflow_events(lead_id uuid,actor_id uuid,is_work boolean,work_source text,occurred_at timestamptz,id uuid DEFAULT gen_random_uuid(),event_type text,recorded_at timestamptz DEFAULT NOW(),primary_status text,new_state jsonb,source text);
    `);
    user={id:randomUUID(),role:'member'};other={id:randomUUID(),role:'partner'};
    await pool.query('INSERT INTO users VALUES ($1,\'Counselor\'),($2,\'Other\')',[user.id,other.id]);
    ids={};
    for(const [name,owner,date,status,queue,active] of [
      ['new',user.id,'2026-09-25',null,'new',false],['old',user.id,'2026-09-25','communication_completed','old',true],
      ['pending',user.id,'2026-09-25','communication_completed','pending',false],
      ['worked',user.id,'2026-09-20','dim',null,true],['foreign',other.id,'2026-09-25','dim',null,true],
      ['reassigned',other.id,'2026-09-25','dim',null,true]]) {
      const id=randomUUID();ids[name]=id;
      await pool.query(`INSERT INTO leads(id,full_name,phone,source,assigned_to_user_id,assigned_at,created_at) VALUES($1,$2,'123','manual',$3,$4,$4)`,[id,name,owner,`${date}T10:00:00+05:30`]);
      await pool.query('INSERT INTO counselor_workflow_state(lead_id,assigned_to_user_id,assignment_at,primary_status,queue,journey_active) VALUES($1,$2,$3,$4,$5,$6)',[id,owner,`${date}T10:00:00+05:30`,status,queue,active]);
    }
    await pool.query('INSERT INTO lead_assignments(lead_id,previous_user_id) VALUES($1,$2)',[ids.reassigned,user.id]);
    for(const [lead,actor,source,date] of [
      ['worked',user.id,'new','2026-09-25'],['worked',user.id,'new','2026-09-25'],['worked',user.id,'old','2026-09-25'],
      ['reassigned',user.id,'old','2026-09-25'],['foreign',other.id,'new','2026-09-25'],['new',user.id,'new','2026-09-24']]) {
      await pool.query('INSERT INTO counselor_workflow_events(lead_id,actor_id,is_work,work_source,occurred_at) VALUES($1,$2,true,$3,$4)',[ids[lead],actor,source,`${date}T12:00:00+05:30`]);
    }
  });
  afterAll(async()=>{if(pool)await pool.end();});
  test('assigned leads and queue counts exclude other owners and preserve original row fields',async()=>{
    const result=await lifecycle.workspace(user,{...input,view:'received'},true);
    expect(result.total).toBe(3);
    expect(result.summary).toMatchObject({received:3,new:1,old:1,pending:1,cc:1,worked:3,worked_n:1,worked_o:2});
    expect(result.rows[0]).toEqual(expect.objectContaining({labels:[],phone:'123'}));
    const [sql,params]=database.query.mock.calls.find(([sql])=>sql.includes('counselor_work AS MATERIALIZED'));
    const plan=await pool.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${sql}`,params);
    const execution=plan.rows[0]['QUERY PLAN'][0];
    expect(execution.Plan).toBeDefined();
    console.info('Original workspace fixture query plan, execution ms:',execution['Execution Time']);
  });
  test('Old overlaps CC; Pending ends active remark membership',async()=>{
    for(const [view,id] of [['old',ids.old],['cc',ids.old],['pending',ids.pending]]){
      const result=await lifecycle.workspace(user,{...input,view},true);
      expect(result.rows.map(row=>row.id)).toEqual([id]);
    }
  });
  test('Worked uses work date, deduplicates each bucket and retains read-only reassigned work',async()=>{
    const result=await lifecycle.workspace(user,{...input,view:'worked'},true);
    expect(result.total).toBe(2);
    expect(result.summary.worked).toBe(3);
    expect(result.rows.find(row=>row.id===ids.worked)).toMatchObject({worked_n:true,worked_o:true,read_only:false});
    expect(result.rows.find(row=>row.id===ids.reassigned)).toMatchObject({worked_n:false,worked_o:true,read_only:true});
  });
  test('search and pagination apply to both counters and rows',async()=>{
    const result=await lifecycle.workspace(user,{...input,view:'received',q:'old',page_size:1},true);
    expect(result.total).toBe(1);expect(result.summary.received).toBe(1);
    expect(result.rows.map(row=>row.id)).toEqual([ids.old]);
    expect((await lifecycle.workspace(user,{...input,view:'received',q:'old',page_size:1,page:2},true)).rows).toEqual([]);
  });
  test('assignment identity prevents a stale queue from appearing after reassignment',async()=>{
    await pool.query("UPDATE counselor_workflow_state SET assignment_at=assignment_at-INTERVAL '1 day' WHERE lead_id=$1",[ids.new]);
    expect((await lifecycle.workspace(user,{...input,view:'new'},true)).total).toBe(0);
  });
  test('Pending preserves recorded journey and due follow-ups appear without Old aging',async()=>{
    for(const [index,type] of ['workflow_enrolled','remark_saved','entered_old','entered_pending'].entries()) {
      await pool.query("INSERT INTO counselor_workflow_events(lead_id,event_type,primary_status,new_state,occurred_at,recorded_at) VALUES($1,$2,'communication_completed',$3,$4,$4)",
        [ids.pending,type,JSON.stringify({queue:index===0?'new':'pending'}),`2026-09-25T${10+index}:00:00Z`]);
    }
    const result=await lifecycle.workspace(user,{...input,view:'pending'},true);
    expect(result.rows.find(row=>row.id===ids.pending).history.map(event=>event.event_type)).toEqual(['workflow_enrolled','remark_saved','entered_old','entered_pending']);
    await pool.query("UPDATE counselor_workflow_state SET followup_override=true WHERE lead_id=$1",[ids.worked]);
    await pool.query("UPDATE leads SET next_followup_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[ids.worked]);
    const followup=await lifecycle.workspace(user,{...input,view:'follow_up'},true);
    expect(followup.rows.map(row=>row.id)).toContain(ids.worked);
  });
  test('unknown views and noncounselor requests cannot opt into counselor-only tabs',async()=>{
    await expect(lifecycle.workspace(user,{...input,view:'bad'},true)).rejects.toMatchObject({code:'INVALID_WORKSPACE_VIEW'});
    await expect(lifecycle.workspace({...user,role:'rm'},{...input,view:'old'},true)).rejects.toMatchObject({code:'INVALID_WORKSPACE_VIEW'});
  });
  test('legacy carry-forward preserves Pending and Worked, ages untouched leads and hands off to explicit workflow',async()=>{
    await pool.query('BEGIN');
    try {
      const add=async(name,{worked=false,terminal=false,future=false,owner=user.id}={})=>{
        const id=randomUUID();
        await pool.query(`INSERT INTO leads(id,full_name,phone,source,assigned_to_user_id,assigned_at,created_at,next_followup_at,stage)
          VALUES($1,$2,'123','manual',$3,'2026-08-01T10:00:00+05:30','2026-07-01',CASE WHEN $4 THEN NOW()+INTERVAL '4 days' ELSE NULL END,$5)`,
          [id,`carry-${name}`,owner,future,terminal?'won':'new']);
        if(worked)await pool.query("INSERT INTO lead_remarks(id,lead_id,workflow_step,created_at) VALUES($1,$2,1,'2026-08-02')",[randomUUID(),id]);
        return id;
      };
      const pending=await add('pending',{worked:true});
      const untouched=await add('untouched');
      const awaiting=await add('awaiting');
      await pool.query(`INSERT INTO counselor_workflow_state(lead_id,assigned_to_user_id,assignment_at,awaiting_primary)
        SELECT id,assigned_to_user_id,assigned_at,true FROM leads WHERE id=$1`,[awaiting]);
      await add('closed',{terminal:true});await add('future',{future:true});await add('foreign',{owner:other.id});
      const fresh=await add('fresh');
      await pool.query('UPDATE leads SET assigned_at=NOW() WHERE id=$1',[fresh]);
      const args={journey:'true',lead_view:'all_time',q:'carry-',view:'pending'};
      let result=await lifecycle.workspace(user,args,true);
      expect(result.rows.map(row=>row.id).sort()).toEqual([pending,untouched,awaiting].sort());
      expect(result.summary).toMatchObject({received:6,new:1,pending:3,worked:1,worked_legacy:1,worked_n:0,worked_o:0,converted:1});
      const summary=await lifecycle.workspace(user,args,false);
      expect(summary.summary).toEqual(result.summary);
      expect((await lifecycle.workspace(user,{...args,view:'new'},true)).rows.map(row=>row.id)).toEqual([fresh]);
      expect((await lifecycle.workspace(user,{...args,view:'worked'},true)).rows.map(row=>row.id)).toEqual([pending]);
      expect(result.rows.every(row=>row.history.length===0)).toBe(true);
      // A saved explicit remark takes over from legacy Pending immediately.
      await pool.query(`INSERT INTO counselor_workflow_state(lead_id,assigned_to_user_id,assignment_at,primary_status,journey_active,awaiting_primary)
        SELECT id,assigned_to_user_id,assigned_at,'communication_completed',true,false FROM leads WHERE id=$1`,[pending]);
      result=await lifecycle.workspace(user,args,true);
      expect(result.summary).toMatchObject({pending:2,cc:1,worked:1,worked_legacy:1});
      expect(result.rows.map(row=>row.id)).not.toContain(pending);
      await pool.query("INSERT INTO counselor_workflow_events(lead_id,actor_id,is_work,work_source,occurred_at) VALUES($1,$2,true,'old',NOW())",[pending,user.id]);
      expect((await lifecycle.workspace(user,args,false)).summary).toMatchObject({worked:1,worked_legacy:0,worked_o:1});
    } finally {await pool.query('ROLLBACK');}
  });
  test('legacy New deadline matches the existing IST policy at office-hour boundaries',async()=>{
    const {newAssignmentDeadlines}=require('../counselorWorkflowPolicies');
    await pool.query('BEGIN');
    try {
      for(const time of ['08:59:59','09:00:00','17:00:00','17:00:01','23:00:00']) {
        const id=randomUUID(),at=`2026-09-25T${time}+05:30`;
        await pool.query("INSERT INTO leads(id,full_name,assigned_to_user_id,assigned_at,created_at) VALUES($1,'boundary-lead',$2,$3,$3)",[id,user.id,at]);
        const result=await lifecycle.workspace(user,{journey:'true',lead_view:'all_time',q:'boundary-lead',view:'received'},true);
        const row=result.rows.find(row=>row.id===id);
        expect(new Date(row.first_contact_deadline).toISOString()).toBe(newAssignmentDeadlines(at).move_to_pending_at.toISOString());
        expect(result.summary.new).toBe(0);
      }
    } finally {await pool.query('ROLLBACK');}
  });

  test('the first new remark transaction is not misreported as previous work',async()=>{
    await pool.query('BEGIN');
    try {
      const id=randomUUID();
      await pool.query("INSERT INTO leads(id,full_name,assigned_to_user_id,assigned_at,created_at) VALUES($1,'atomic-primary',$2,NOW()-INTERVAL '1 day',NOW()-INTERVAL '1 day')",[id,user.id]);
      await pool.query('INSERT INTO lead_remarks(id,lead_id,workflow_step,created_at) VALUES($1,$2,1,NOW())',[randomUUID(),id]);
      await pool.query("INSERT INTO counselor_workflow_events(lead_id,event_type,occurred_at) VALUES($1,'remark_saved',NOW()+INTERVAL '50 milliseconds')",[id]);
      const result=await lifecycle.workspace(user,{journey:'true',lead_view:'all_time',q:'atomic-primary',view:'worked'},true);
      expect(result.summary).toMatchObject({worked:0,worked_legacy:0});
      expect(result.total).toBe(0);
    } finally {await pool.query('ROLLBACK');}
  });

  test('next queue is taken from the authoritative deadline and suppressed for custom follow-ups',async()=>{
    await pool.query('BEGIN');
    try {
      for(const [oldAt,pendingAt,override,next] of [
        ['2026-09-28','2026-09-29',false,'old'],[null,'2026-09-29',false,'pending'],
        ['2026-09-28','2026-09-29',true,null],[null,null,false,null]]) {
        await pool.query('UPDATE counselor_workflow_state SET move_to_old_at=$2,move_to_pending_at=$3,followup_override=$4 WHERE lead_id=$1',[ids.old,oldAt ? `${oldAt}T00:00:00Z` : null,pendingAt ? `${pendingAt}T00:00:00Z` : null,override]);
        const result=await lifecycle.workspace(user,{...input,view:'received',q:'old'},true);
        expect(result.rows[0].workflow_next_queue).toBe(next);
        expect(result.rows[0].workflow_deadline ? new Date(result.rows[0].workflow_deadline).toISOString().slice(0,10) : null).toBe(oldAt||pendingAt);
      }
    } finally {await pool.query('ROLLBACK');}
  });

});
