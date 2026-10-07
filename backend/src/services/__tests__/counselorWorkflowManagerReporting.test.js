jest.mock('../../config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
jest.mock('../../middleware/rbac',()=>({getVisibleUserIds:jest.fn()}));
const {Pool}=require('pg');
const {randomUUID}=require('crypto');
const database=require('../../config/database');
const {getVisibleUserIds}=require('../../middleware/rbac');
const reporting=require('../managerWorkflowReporting');
const lifecycle=require('../lifecycleService');
const suite=process.env.COUNSELOR_WORKFLOW_TEST_URL?describe:describe.skip;
suite('manager workflow reporting PostgreSQL',()=>{
 let pool,admin,rm,otherRm,counselor,other,ids={};
 const daily={lead_view:'daily',from:'2026-09-25',to:'2026-09-25'};
 beforeAll(async()=>{
   const url=new URL(process.env.COUNSELOR_WORKFLOW_TEST_URL);
   if(url.hostname!=='127.0.0.1')throw new Error('Loopback fixture required');
   pool=new Pool({connectionString:url.toString(),max:1,options:'-c search_path=manager_workflow_test'});
   await pool.query('CREATE SCHEMA manager_workflow_test; SET search_path TO manager_workflow_test');
   database.query.mockImplementation((...args)=>pool.query(...args));
   await pool.query(`      CREATE TABLE workflow_settings(key text,value jsonb,label text,updated_at timestamptz);
      CREATE TABLE users(id uuid PRIMARY KEY,full_name text,role text,report_to_id uuid,team_name text,status text DEFAULT 'active',deleted_at timestamptz);
      CREATE TABLE leads(id uuid,full_name text,phone text,email text,source text,campaign_name text,campaign_label text,category text,
        pool_rm_id uuid,assigned_to_user_id uuid,assigned_at timestamptz,created_at timestamptz,updated_at timestamptz,last_call_at timestamptz,
        next_followup_at timestamptz,call_status text DEFAULT 'not_called',stage text DEFAULT 'new',deleted_at timestamptz);
      CREATE TABLE lead_lifecycle_state(lead_id uuid,journey_stage text,terminal_state text,last_call_result text,current_primary_action_id uuid);
      CREATE TABLE lead_actions(id uuid,action_type text,reason text,due_at timestamptz,status text);
      CREATE TABLE lead_call_attempt_sequences(id uuid,lead_id uuid,status text);
      CREATE TABLE lead_call_attempts(id uuid,lead_id uuid,sequence_id uuid,status text,scheduled_at timestamptz,attempted_at timestamptz,created_at timestamptz);
      CREATE TABLE lead_assignments(lead_id uuid,assigned_to_user_id uuid,user_id uuid,previous_user_id uuid,assigned_at timestamptz);
      CREATE TABLE lead_lifecycle_events(id uuid,lead_id uuid,event_type text,occurred_at timestamptz,metadata jsonb);
      CREATE TABLE lead_remarks(id uuid,lead_id uuid,workflow_step int,remark text,call_status text,created_at timestamptz);
      CREATE TABLE lead_call_logs(id uuid,lead_id uuid,created_at timestamptz);
      CREATE TABLE lead_labels(id uuid,name text,color text,deleted_at timestamptz);
      CREATE TABLE lead_label_assignments(lead_id uuid,label_id uuid,created_at timestamptz);
      CREATE TABLE counselor_workflow_state(lead_id uuid,assigned_to_user_id uuid,assignment_at timestamptz,primary_status text,
        queue text,journey_active boolean,awaiting_primary boolean DEFAULT false,move_to_old_at timestamptz,move_to_pending_at timestamptz,followup_override boolean);
      CREATE TABLE counselor_workflow_events(lead_id uuid,actor_id uuid,is_work boolean,work_source text,occurred_at timestamptz,id uuid DEFAULT gen_random_uuid(),event_type text,recorded_at timestamptz DEFAULT NOW(),primary_status text,new_state jsonb,previous_state jsonb,source text);
`);
   await pool.query(`
     ALTER TABLE leads ADD city text, ADD state text, ADD raw_payload jsonb, ADD meta_form_id text, ADD product_tag text,
       ADD manual_added_by_user_id uuid, ADD manual_added_at timestamptz, ADD created_by_user_id uuid,
       ADD category_source text, ADD category_rule_id uuid, ADD category_resolved_at timestamptz,
       ADD adset_name text, ADD ad_name text, ADD meta_campaign_id text, ADD meta_adset_id text, ADD meta_ad_id text,
       ADD call_attempts int, ADD locked_by_user_id uuid, ADD locked_until timestamptz, ADD stage_updated_at timestamptz;
     ALTER TABLE lead_remarks ADD call_statuses jsonb, ADD stage text, ADD next_followup_at timestamptz,
       ADD source text, ADD user_id uuid, ADD note_type text, ADD category text, ADD title text, ADD priority text,
       ADD customer_interest text, ADD next_followup timestamptz;
     CREATE TABLE lead_workflow(lead_id uuid,remark_status text,step_1_statuses jsonb,remark_saved_at timestamptz,
       updated_at timestamptz,created_at timestamptz,step_2_statuses jsonb,lead_level text,followup_completed boolean,conversion_completed boolean);
     ALTER TABLE lead_call_attempts ADD attempt_number int,ADD outcome text,ADD trigger_reason text,ADD is_final_attempt boolean;
     CREATE TABLE lead_workflow_history(lead_id uuid,new_value text,metadata jsonb,created_at timestamptz);
     CREATE TABLE lead_sessions(lead_id uuid,deleted_at timestamptz);
   `);
   admin={id:randomUUID(),role:'super_admin'};rm={id:randomUUID(),role:'rm'};otherRm={id:randomUUID(),role:'rm'};
   counselor={id:randomUUID(),role:'member'};other={id:randomUUID(),role:'partner'};
   for(const u of [admin,rm,otherRm,counselor,other])await pool.query('INSERT INTO users(id,full_name,role,report_to_id) VALUES($1,$2,$3,$4)',[u.id,u.role,u.role,u===counselor?rm.id:u===other?otherRm.id:null]);
   getVisibleUserIds.mockImplementation(async actor=>actor.role==='super_admin'?null:actor.role==='rm'?[actor.id,...(actor.id===rm.id?[counselor.id]:[other.id])]:[actor.id]);
   for(const [name,owner,status,queue,active,date] of [
     ['new',counselor.id,null,'new',false,'2026-09-25T10:00:00+05:30'],
     ['old',counselor.id,'communication_completed','old',true,'2026-09-25T10:00:00+05:30'],
     ['pending',counselor.id,'communication_completed','pending',false,'2026-09-25T10:00:00+05:30'],
     ['cnr',counselor.id,'cnr',null,true,'2026-09-25T10:00:00+05:30'],
     ['worked',counselor.id,'dim',null,true,'2026-09-20T10:00:00+05:30'],
     ['foreign',other.id,'dim',null,true,'2026-09-25T10:00:00+05:30'],
     ['unassigned',null,null,null,false,'2026-09-25T10:00:00+05:30'],
     ['midnight',counselor.id,'tte',null,true,'2026-09-25T00:00:00+05:30'],
     ['nextday',counselor.id,'dim',null,true,'2026-09-26T00:00:00+05:30']]){
       ids[name]=randomUUID();
       await pool.query('INSERT INTO leads(id,full_name,assigned_to_user_id,pool_rm_id,assigned_at,created_at) VALUES($1,$2,$3,$4,$5,$5)',[ids[name],name,owner,rm.id,date]);
       if(owner)await pool.query('INSERT INTO counselor_workflow_state(lead_id,assigned_to_user_id,assignment_at,primary_status,queue,journey_active) VALUES($1,$2,$3,$4,$5,$6)',[ids[name],owner,date,status,queue,active]);
   }
   await pool.query("INSERT INTO lead_lifecycle_state(lead_id,journey_stage) VALUES($1,'tte')",[ids.midnight]);
   for(const source of ['new','new','old'])await pool.query("INSERT INTO counselor_workflow_events(lead_id,actor_id,is_work,work_source,occurred_at) VALUES($1,$2,true,$3,'2026-09-25T12:00:00+05:30')",[ids.worked,counselor.id,source]);
 });
 afterAll(async()=>{await pool?.end();});
 test('every summary metric matches distinct paginated lists',async()=>{
   const input={...daily,counselor_id:counselor.id};
   const first=await reporting.report(admin,input);
   for(const metric of reporting.METRICS){
     const result=await reporting.report(admin,{...input,workflow_view:metric});
     expect(result.total).toBe(first.summary[metric]);
     expect(new Set(result.rows.map(r=>r.id)).size).toBe(result.total);
   }
   expect(first.summary).toMatchObject({received:5,new:1,old:1,pending:1,cc:1,worked:1,worked_n:1,worked_o:1});
   const empty=await reporting.report(admin,{...input,page:100});
   expect(empty.total).toBe(5);expect(empty.rows).toEqual([]);
 });
 test('counselor and both manager scopes agree on workflow membership',async()=>{
   const member=await lifecycle.workspace(counselor,{...daily,journey:'true',view:'received'},false);
   for(const actor of [admin,rm]){
     const result=await reporting.report(actor,{...daily,counselor_id:counselor.id});
     for(const key of ['new','old','pending','cc','dim','call_issues','tte','worked','worked_n','worked_o','worked_legacy'])expect(result.summary[key]).toBe(member.summary[key]);
   }
 });
 test('old overlaps CC, pending excludes CC, CNR and TTE remain separate',async()=>{
   const cc=await reporting.report(admin,{...daily,workflow_view:'cc'});
   expect(cc.rows.map(r=>r.id)).toEqual([ids.old]);
   const cnr=await reporting.report(rm,{...daily,workflow_view:'call_issues',call_issue_type:'cnr'});
   expect(cnr.rows.map(r=>r.id)).toEqual([ids.cnr]);
   expect(cnr.call_issue_buckets.cnr).toBe(1);
   const tte=await reporting.report(admin,{...daily,workflow_view:'tte'});
   expect(tte.rows.map(r=>r.id)).toEqual([ids.midnight]);
 });
 test('unassigned received totals and card aggregation are preserved',async()=>{
   const total=await reporting.report(admin,daily);
   expect(total.summary.received).toBe(7);
   const cards=await reporting.counselors(admin,rm.id,daily);
   expect(cards.counselors.find(c=>c.id===counselor.id).received).toBe(5);
   expect(cards.unassigned.received).toBe(1);
   expect((await reporting.report(rm,{...daily,assigned_to:'__unassigned'})).total).toBe(1);
   const all=await reporting.report(admin,{lead_view:'all_time'});expect(all.total).toBe(9);
 });
 test('invalid filters and foreign RM/counselor access are rejected',async()=>{
   for(const input of [{rm_id:otherRm.id},{counselor_id:other.id}])await expect(reporting.report(rm,input)).rejects.toMatchObject({status:expect.any(Number)});
   for(const input of [{workflow_view:'bad'},{work_source:'bad'},{call_issue_type:'bad'},{rm_id:'bad'}])await expect(reporting.report(admin,input)).rejects.toBeDefined();
   await expect(reporting.report(counselor,{})).rejects.toMatchObject({code:'FORBIDDEN'});
   expect((await reporting.report(rm,daily)).rows.map(r=>r.id)).not.toContain(ids.foreign);
 });
 test('reassignment preserves evidenced work attribution without leaking current queues',async()=>{
   await pool.query('BEGIN');
   try {
     await pool.query('INSERT INTO lead_assignments(lead_id,previous_user_id,assigned_to_user_id) VALUES($1,$2,$3)',[ids.worked,counselor.id,other.id]);
     await pool.query("UPDATE leads SET assigned_to_user_id=$2,assigned_at='2026-09-26' WHERE id=$1",[ids.worked,other.id]);
     const result=await reporting.report(rm,{...daily,counselor_id:counselor.id,workflow_view:'worked'});
     expect(result.total).toBe(1);expect(result.rows[0].read_only_access).toBe(true);
     expect(result.summary.dim).toBe(0);
     const member=await lifecycle.workspace(counselor,{...daily,journey:'true',view:'worked'},true);
     expect(result.total).toBe(member.total);
   } finally {await pool.query('ROLLBACK');}
 });
 test('created and assignment cohorts stay separate; deleted and search filters affect counts and rows',async()=>{
   await pool.query('BEGIN');
   try {
     await pool.query("UPDATE leads SET created_at='2026-08-01' WHERE id=$1",[ids.old]);
     let result=await reporting.report(admin,{...daily,counselor_id:counselor.id,q:'old',workflow_view:'old'});
     expect(result.summary.received).toBe(0);expect(result.total).toBe(1);
     await pool.query('UPDATE leads SET deleted_at=NOW() WHERE id=$1',[ids.old]);
     result=await reporting.report(admin,{...daily,q:'old',workflow_view:'old'});
     expect(result.total).toBe(0);expect(result.summary.old).toBe(0);
   } finally {await pool.query('ROLLBACK');}
 });
 test('range, empty results, aliases and work-source filtering are stable',async()=>{
   const ranged=await reporting.report(admin,{...daily,to:'2026-09-26'});expect(ranged.total).toBe(8);
   for(const work_source of ['new','old'])expect((await reporting.report(admin,{...daily,workflow_view:'worked',work_source})).total).toBe(1);
   expect((await reporting.report(admin,{...daily,workflow_view:'worked',work_source:'previous'})).total).toBe(0);
   expect((await reporting.report(admin,{...daily,q:'nonexistent'})).total).toBe(0);
   expect((await reporting.report(admin,{...daily,workflow_view:'session_9pm'})).metric).toBe('common_meeting');
 });
 test('aggregate execution plan uses one report query without per-counselor requests',async()=>{
   database.query.mockClear();await reporting.rms(admin,daily);
   const calls=database.query.mock.calls.filter(([sql])=>sql.includes('report_scope AS MATERIALIZED'));
   expect(calls).toHaveLength(1);
   const [sql,params]=calls[0];const result=await pool.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${sql}`,params);
   console.info('Manager report fixture plan:',result.rows[0]['QUERY PLAN'][0]['Execution Time'],'ms');
 });
});
