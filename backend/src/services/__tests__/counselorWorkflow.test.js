jest.mock('../../config/database', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { Pool } = require('pg');
const { createService, validateStatuses, membership } = require('../counselorWorkflowService');
const { RETRYABLE_ISSUES, NR_STATUSES } = require('../counselorWorkflowPolicies');

describe('counselor workflow validation', () => {
  test.each([undefined, '', 'hot'])('requires explicit primary within statuses: %s', primary => {
    expect(() => validateStatuses(['communication_completed','cnr'], primary)).toThrow('primary_status');
  });
  test('preserves secondary statuses without using array order', () => {
    expect(validateStatuses(['cnr','communication_completed'], 'communication_completed')).toEqual(['cnr','communication_completed']);
  });
  test.each([null, [], ['bogus'], [123]])('rejects malformed statuses: %j', statuses => {
    expect(() => validateStatuses(statuses, 'cnr')).toThrow();
  });
  test('count/list predicates are allowlisted and separate journey from queue', () => {
    expect(membership('old')).toBe("s.queue = 'old'");
    expect(membership('cnr')).toBe("s.journey_active AND s.primary_status = 'cnr'");
    expect(() => membership("old' OR TRUE")).toThrow();
  });
  test('disabled rollout never touches database for legacy activity or worker', async () => {
    const db = { query: jest.fn(), withTransaction: jest.fn() };
    const service = createService(db, { logger:false, rolloutMode:'all', rolloutAt: null });
    expect(await service.tick()).toEqual({ skipped:true });
    expect(await service.observeRemark({})).toEqual({ enabled:false });
    expect(db.query).not.toHaveBeenCalled();
  });
});

const integration = process.env.COUNSELOR_WORKFLOW_TEST_URL ? describe : describe.skip;
integration('counselor workflow PostgreSQL transactions', () => {
  let pool, db, service, user, other, leadId;
  const cutoff = new Date(Date.now() - 60000).toISOString();
  const oldAt = new Date(Date.now() - 2000).toISOString();
  const pendingAt = new Date(Date.now() - 1000).toISOString();
  const migration = fs.readFileSync(path.join(__dirname,'../../db/migrations/074_counselor_workflow_foundation.sql'),'utf8');
  const query = (...args) => pool.query(...args);
  const input = (generation = 0, key = randomUUID(), primary = 'communication_completed') => ({
    statuses: ['cnr',primary], primary_status:primary, expected_generation:generation, idempotency_key:key, remark:'Test remark',
  });
  const state = async () => (await query('SELECT * FROM counselor_workflow_state WHERE lead_id=$1',[leadId])).rows[0];
  const events = async () => (await query('SELECT * FROM counselor_workflow_events WHERE lead_id=$1 ORDER BY recorded_at,id',[leadId])).rows;
  async function schedule(generation, overrides = {}) {
    return db.withTransaction(client => service.schedule(client, { leadId, expectedGeneration:generation,
      policyVersion:'test_fixture', idempotencyKey:randomUUID(), moveToOldAt:oldAt, moveToPendingAt:pendingAt, ...overrides }));
  }
  const processOld = generation => service.processDeadline({ leadId,generation,kind:'old',dueAt:oldAt });
  beforeAll(async () => {
    const url = new URL(process.env.COUNSELOR_WORKFLOW_TEST_URL);
    if (url.hostname !== '127.0.0.1') throw new Error('Tests require an isolated loopback database.');
    pool = new Pool({ connectionString:url.toString(), max:8 });
    // Only the columns used by the new foundation; production migration is
    // executed verbatim twice to verify additive/reentrant DDL.
    await query(`CREATE TABLE users(id uuid PRIMARY KEY,role text);
      CREATE TABLE leads(id uuid PRIMARY KEY,assigned_to_user_id uuid REFERENCES users(id),assigned_at timestamptz,
        stage text DEFAULT 'new',call_status text DEFAULT 'not_called',next_followup_at timestamptz,deleted_at timestamptz,updated_at timestamptz,
        full_name text,phone text,email text,source text,category text,campaign_name text,campaign_label text);
      CREATE TABLE lead_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid,user_id uuid,assigned_to_user_id uuid,
        assigned_at timestamptz DEFAULT NOW(),unassigned_at timestamptz,previous_user_id uuid);
      CREATE TABLE lead_remarks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid,user_id uuid,remark text,
        next_followup_at timestamptz,call_statuses jsonb,source text,created_at timestamptz DEFAULT NOW());`);
    await query(migration);
    await query(migration);
    db = { query, withTransaction: async fn => {
      const client = await pool.connect();
      try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    } };
    service = createService(db,{ logger:false, rolloutMode:'all', rolloutAt:cutoff });
  });
  afterAll(async () => { if (pool) await pool.end(); });
  beforeEach(async () => {
    user = { id:randomUUID(),role:'member' }; other = { id:randomUUID(),role:'partner' }; leadId = randomUUID();
    await query('INSERT INTO users VALUES ($1,$2),($3,$4)',[user.id,user.role,other.id,other.role]);
    await query('INSERT INTO leads(id,assigned_to_user_id,assigned_at) VALUES ($1,$2,NOW())',[leadId,user.id]);
    await query('INSERT INTO lead_assignments(lead_id,user_id,assigned_to_user_id) VALUES ($1,$2,$2)',[leadId,user.id]);
  });
  test('explicitly enabled workflow opens and saves an existing lead',async()=>{
    const current=createService(db,{logger:false,rolloutMode:'all'});
    await query("UPDATE leads SET assigned_at='2020-01-01T00:00:00Z' WHERE id=$1",[leadId]);
    expect(current.configuration(user)).toEqual({enabled:true});
    expect(await current.read(user,leadId)).toMatchObject({enabled:true,managed:false});
    const saved=await current.recordRemark(user,leadId,input());
    expect(saved.state).toMatchObject({primary_status:'communication_completed',journey_active:true,queue:null});
    expect(new Date(saved.state.move_to_pending_at)-new Date(saved.state.move_to_old_at)).toBe(20*3600000);
    expect((await events()).filter(event=>event.is_work).map(event=>event.work_source)).toEqual([null]);
    expect(await current.workspace(user,{view:'cc'})).toMatchObject({enabled:true,remarks_enabled:true,total:1});
    const retry=await current.processDeadline({leadId,generation:saved.state.generation,kind:'old',dueAt:saved.state.move_to_old_at});
    expect(retry.transitioned).not.toBe(true); // Future deadlines are not run early.
  });

  test('pilot gates API, legacy adapters, enrollment, and disables without deleting history', async () => {
    const options={logger:false,rolloutMode:'pilot',rolloutAt:cutoff,pilotStarts:{[user.id]:cutoff}};
    const pilot=createService(db,options);
    expect(pilot.configuration(user)).toEqual({enabled:true});
    expect(pilot.configuration(other)).toEqual({enabled:false});
    await expect(pilot.recordRemark(other,leadId,input())).rejects.toMatchObject({code:'WORKFLOW_DISABLED'});
    expect(await pilot.workspace(other)).toMatchObject({enabled:true,remarks_enabled:false});
    await pilot.tick();
    expect((await state()).queue).toBe('new');
    const saved=await pilot.recordRemark(user,leadId,input((await state()).generation));
    const before=await events();
    options.rolloutMode='off';
    expect(await pilot.tick()).toEqual({skipped:true});
    expect(await pilot.processDeadline({leadId,generation:saved.state.generation,kind:'old',dueAt:saved.state.move_to_old_at})).toEqual({skipped:true});
    expect(await pilot.read(user,leadId)).toMatchObject({enabled:false});
    expect(await events()).toEqual(before);
  });
  test('pilot activation never enrolls assignments preceding that counselor start',async()=>{
    const pilot=createService(db,{logger:false,rolloutMode:'pilot',rolloutAt:cutoff,pilotStarts:{[user.id]:new Date().toISOString()}});
    await query('UPDATE leads SET assigned_at=$2::timestamptz-INTERVAL \'1 second\' WHERE id=$1',[leadId,cutoff]);
    await pilot.tick();
    expect(await state()).toBeUndefined();
    const saved=await pilot.recordRemark(user,leadId,input());
    expect(saved.event.work_source).toBeNull();
  });
  test('nonpilot assignment and legacy save do not create workflow data',async()=>{
    const pilot=createService(db,{logger:false,rolloutMode:'pilot',rolloutAt:cutoff,pilotStarts:{[other.id]:cutoff}});
    await pilot.tick();
    expect(await state()).toBeUndefined();
    const observed=await db.withTransaction(client=>pilot.observeRemark({client,leadId,user,remarkId:randomUUID()}));
    expect(observed).toEqual({enabled:false});
    expect(await events()).toHaveLength(0);
  });
  test('coordinator lock prevents a second worker batch',async()=>{
    const client=await pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(74001,1)');
      expect(await service.tick()).toEqual({skipped:true});
      expect(await state()).toBeUndefined();
    } finally {await client.query('ROLLBACK');client.release();}
    await service.tick();
    expect((await state()).queue).toBe('new');
  });
  test('API-only process can disable its worker while preserving counselor availability',async()=>{
    const apiOnly=createService(db,{logger:false,rolloutMode:'all',rolloutAt:cutoff,workerEnabled:false});
    expect(apiOnly.configuration(user)).toEqual({enabled:true});
    expect(await apiOnly.tick()).toEqual({skipped:true});
    expect(await state()).toBeUndefined();
  });
  test('legacy lifecycle invalidates deadlines without manufacturing work; retry is idempotent',async()=>{
    const saved=await service.recordRemark(user,leadId,input());
    const origin=randomUUID();
    const invalidate=()=>db.withTransaction(client=>service.invalidateLegacy({client,leadId,user,origin}));
    expect(await invalidate()).toEqual({invalidated:true});
    expect(await invalidate()).toEqual({duplicate:true});
    expect(await state()).toMatchObject({queue:null,journey_active:false,awaiting_primary:true,move_to_old_at:null,move_to_pending_at:null});
    expect((await events()).filter(e=>e.is_work)).toHaveLength(1);
    expect(await processOld(saved.state.generation)).toEqual({stale:true});
  });
  test('worker isolates a failed lead and retries its transaction next tick',async()=>{
    await service.recordRemark(user,leadId,input());
    const scheduled=await schedule((await state()).generation);
    let fail=true;
    const logger={info:jest.fn(),error:jest.fn()};
    const faulty={...db,withTransaction:fn=>db.withTransaction(client=>fn({query:async(sql,params)=>{
      if(fail&&sql.startsWith('INSERT INTO counselor_workflow_state')&&params[0]===leadId) throw Object.assign(new Error('private data'),{code:'TEST_FAILURE'});
      return client.query(sql,params);
    }}))};
    const worker=createService(faulty,{logger,rolloutMode:'pilot',rolloutAt:cutoff,pilotStarts:{[user.id]:cutoff}});
    expect((await worker.tick()).failed).toBe(1);
    expect((await state()).queue).toBeNull();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private data');
    fail=false;
    expect((await worker.tick()).transitioned).toBe(1);
    expect((await state()).queue).toBe('old');
    expect((await state()).generation).toBe(scheduled.state.generation);
  });
  test('migration never enrolls existing data or creates history on reads', async () => {
    await query("UPDATE leads SET assigned_at=NOW()-INTERVAL '1 year' WHERE id=$1",[leadId]);
    await service.tick();
    const result = await service.read(user,leadId);
    expect(result.managed).toBe(false); expect(result.events).toEqual([]);
  });
  test('new assignment is durable and schedules Pending without an Old deadline', async () => {
    await service.tick();
    expect(await state()).toMatchObject({ queue:'new',primary_status:null,move_to_old_at:null,policy_version:'new_assignment_v1' });
    expect((await state()).move_to_pending_at).toBeInstanceOf(Date);
    const restarted = createService(db,{ logger:false, rolloutMode:'all', rolloutAt:cutoff });
    expect((await restarted.read(user,leadId)).state.queue).toBe('new');
  });
  test('explicit primary wins over secondaries and stores one journey', async () => {
    const result = await service.recordRemark(user,leadId,input());
    expect(result.state).toMatchObject({ primary_status:'communication_completed',journey_active:true,queue:null,policy_version:'main_journey_v1' });
    expect(result.state.move_to_old_at).toBeInstanceOf(Date);
    expect(result.event).toMatchObject({ work_source:'new',is_work:true,statuses:['cnr','communication_completed'] });
  });
  test('assignment identity preserves microseconds across enrollment and polling', async () => {
    await query("UPDATE leads SET assigned_at=date_trunc('second',NOW())+INTERVAL '0.123456 seconds' WHERE id=$1",[leadId]);
    await service.tick();
    const before = await state();
    await service.tick();
    expect((await state()).generation).toBe(before.generation);
    expect((await service.workspace(user,{view:'new'})).total).toBe(1);
    expect((await events()).filter(e => e.event_type === 'workflow_enrolled')).toHaveLength(1);
  });
  test('an assignment with earlier work is never fabricated as New', async () => {
    await query('INSERT INTO lead_remarks(lead_id,user_id,remark) VALUES ($1,$2,$3)',[leadId,user.id,'Already worked']);
    await service.tick();
    expect(await state()).toMatchObject({queue:null,awaiting_primary:true});
  });
  test('duplicate requests cannot duplicate remarks, work events or history', async () => {
    const request = input();
    const results = await Promise.all([service.recordRemark(user,leadId,request),service.recordRemark(user,leadId,request)]);
    expect(results.filter(r => r.duplicate)).toHaveLength(1);
    expect((await events()).filter(e => e.is_work)).toHaveLength(1);
    expect((await query('SELECT * FROM lead_remarks WHERE lead_id=$1',[leadId])).rows).toHaveLength(1);
    await expect(service.recordRemark(user,leadId,{ ...request,remark:'Changed' })).rejects.toMatchObject({ code:'IDEMPOTENCY_CONFLICT' });
  });
  test('Old overlaps journey; Pending hides active journey without erasing history', async () => {
    const saved = await service.recordRemark(user,leadId,input());
    const scheduled = await schedule(saved.state.generation);
    const generation = scheduled.state.generation;
    await Promise.all([processOld(generation),processOld(generation)]);
    expect(await state()).toMatchObject({ queue:'old',journey_active:true,primary_status:'communication_completed' });
    for (const view of ['old','communication_completed']) {
      const result = await service.workspace(user,{view});
      expect(result.total).toBe(1); expect(result.rows).toHaveLength(1);
    }
    await service.processDeadline({leadId,generation,kind:'pending',dueAt:pendingAt});
    expect(await state()).toMatchObject({queue:'pending',journey_active:false,primary_status:'communication_completed'});
    expect((await service.workspace(user,{view:'communication_completed'})).total).toBe(0);
    expect((await events()).filter(e => e.event_type === 'entered_old')).toHaveLength(1);
    expect((await events()).filter(e => e.event_type === 'entered_pending')).toHaveLength(1);
  });
  test('newest remark wins when a worker races with a counselor', async () => {
    const saved = await service.recordRemark(user,leadId,input());
    const scheduled = await schedule(saved.state.generation);
    await Promise.all([processOld(scheduled.state.generation),service.recordRemark(user,leadId,input(scheduled.state.generation,randomUUID(),'quotation'))]);
    expect(await state()).toMatchObject({ primary_status:'quotation',queue:null,policy_version:'main_journey_v1' });
    expect((await state()).move_to_old_at.getTime()).toBeGreaterThan(Date.parse(oldAt));
    expect(await processOld(scheduled.state.generation)).toEqual({ stale:true });
  });
  test('deadline replacement bumps generation and stale jobs cannot apply', async () => {
    const saved = await service.recordRemark(user,leadId,input());
    const first = await schedule(saved.state.generation);
    const second = await schedule(first.state.generation);
    expect(second.state.generation).toBe(first.state.generation+1);
    expect(await processOld(first.state.generation)).toEqual({stale:true});
  });
  test('a restarted processor drains overdue Old then Pending exactly once', async () => {
    const saved = await service.recordRemark(user,leadId,input());
    await schedule(saved.state.generation);
    const restarted = createService(db,{logger:false, rolloutMode:'all', rolloutAt:cutoff});
    await restarted.tick();
    expect((await state()).queue).toBe('old');
    await restarted.tick();
    await restarted.tick();
    expect((await state()).queue).toBe('pending');
    expect((await events()).filter(e => e.event_type === 'entered_pending')).toHaveLength(1);
  });
  test('future deadlines do not fire early and reject inverted ordering', async () => {
    const saved = await service.recordRemark(user,leadId,input());
    await expect(schedule(saved.state.generation,{moveToOldAt:pendingAt,moveToPendingAt:oldAt})).rejects.toMatchObject({code:'INVALID_DEADLINES'});
    const future = new Date(Date.now()+60000).toISOString();
    const scheduled = await schedule(saved.state.generation,{moveToOldAt:future,moveToPendingAt:null});
    expect(await service.processDeadline({leadId,generation:scheduled.state.generation,kind:'old',dueAt:future})).toEqual({stale:true});
  });
  test('same lead records N then O and repeated O events remain independently attributable', async () => {
    let saved = await service.recordRemark(user,leadId,input());
    for (let i=0;i<2;i++) {
      const scheduled = await schedule(saved.state.generation);
      await processOld(scheduled.state.generation);
      saved = await service.recordRemark(user,leadId,input(scheduled.state.generation));
    }
    expect((await events()).filter(e => e.is_work).map(e => e.work_source).sort()).toEqual(['new','old','old']);
    const result = await query(`SELECT work_source,COUNT(DISTINCT lead_id)::int AS count
      FROM counselor_workflow_events WHERE actor_id=$1 AND is_work GROUP BY work_source`,[user.id]);
    expect(result.rows).toEqual(expect.arrayContaining([{work_source:'new',count:1},{work_source:'old',count:1}]));
  });
  test('custom follow-up is reused, preserved on omission, and blocks default deadlines', async () => {
    const next = new Date(Date.now()+86400000).toISOString();
    let saved = await service.recordRemark(user,leadId,{...input(),next_followup_at:next});
    saved = await service.recordRemark(user,leadId,input(saved.state.generation));
    expect(saved.state.followup_override).toBe(true);
    const scheduled = await schedule(saved.state.generation);
    expect(await processOld(scheduled.state.generation)).toEqual({stale:true});
    expect(new Date((await query('SELECT next_followup_at FROM leads WHERE id=$1',[leadId])).rows[0].next_followup_at).toISOString()).toBe(next);
  });
  test('legacy activity invalidates deadlines but never chooses a primary from statuses', async () => {
    const saved = await service.recordRemark(user,leadId,input());
    await schedule(saved.state.generation);
    await db.withTransaction(client => service.observeRemark({ client,user,leadId,remarkId:randomUUID(),statuses:['quotation','hot'] }));
    expect(await state()).toMatchObject({ primary_status:'communication_completed',awaiting_primary:true,journey_active:false,queue:null,move_to_old_at:null });
  });
  test('legacy activity origin deduplicates and explicit primary follows the same transition', async () => {
    const activity = {user,leadId,remarkId:randomUUID(),statuses:['cnr','hot'],primaryStatus:'hot'};
    await db.withTransaction(client => service.observeRemark({...activity,client}));
    const result = await db.withTransaction(client => service.observeRemark({...activity,client}));
    expect(result.duplicate).toBe(true);
    expect((await state()).primary_status).toBe('hot');
    expect((await events()).filter(e => e.is_work)).toHaveLength(1);
  });
  test('source remains null for work first performed outside New or Old', async () => {
    await query("UPDATE leads SET assigned_at=NOW()-INTERVAL '1 year' WHERE id=$1",[leadId]);
    const result = await service.recordRemark(user,leadId,input());
    expect(result.event.work_source).toBeNull();
    expect(result.event.previous_state.queue).toBeNull();
  });
  test('unworked New cannot schedule an Old transition', async () => {
    await service.tick();
    await expect(schedule((await state()).generation)).rejects.toMatchObject({ code:'INVALID_OLD_TRANSITION' });
  });
  test('unauthorized counselor and manager cannot write the versioned workflow', async () => {
    await expect(service.recordRemark(other,leadId,input())).rejects.toMatchObject({status:403});
    await expect(service.recordRemark({...user,role:'admin'},leadId,input())).rejects.toMatchObject({status:403});
    expect(await state()).toBeUndefined();
  });
  test('stale expected generation rolls back without inserting a remark', async () => {
    await service.recordRemark(user,leadId,input());
    await expect(service.recordRemark(user,leadId,input())).rejects.toMatchObject({code:'WORKFLOW_GENERATION_CONFLICT'});
    expect((await query('SELECT id FROM lead_remarks WHERE lead_id=$1',[leadId])).rows).toHaveLength(1);
  });
  test('reassignment prevents an old worker from touching the new owner', async () => {
    const saved = await service.recordRemark(user,leadId,input());
    const scheduled = await schedule(saved.state.generation);
    await query('UPDATE leads SET assigned_to_user_id=$2,assigned_at=NOW() WHERE id=$1',[leadId,other.id]);
    expect(await processOld(scheduled.state.generation)).toEqual({stale:true});
    expect((await service.workspace(user)).total).toBe(0);
    await service.tick();
    expect(await state()).toMatchObject({assigned_to_user_id:other.id,awaiting_primary:true,queue:null});
  });
  test('failure recording history rolls the entire transition back', async () => {
    const failingDb = { ...db, withTransaction: fn => db.withTransaction(client => fn({ query: (sql, params) => {
      if (sql.includes('INSERT INTO counselor_workflow_events')) throw new Error('Injected event failure');
      return client.query(sql,params);
    } })) };
    await expect(createService(failingDb,{logger:false, rolloutMode:'all', rolloutAt:cutoff}).recordRemark(user,leadId,input())).rejects.toThrow('Injected');
    expect(await state()).toBeUndefined();
    expect((await query('SELECT id FROM lead_remarks WHERE lead_id=$1',[leadId])).rows).toHaveLength(0);
  });

  describe('Stage 5 counselor workspace integration', () => {
    let clock;
    const daily = {lead_view:'daily',from:'2030-09-26',to:'2030-09-26'};
    const hour = 3600000;
    const workspace = (view,extra={}) => service.workspace(user,{...daily,view,...extra});
    const process = (saved,kind) => service.processDeadline({leadId,generation:saved.generation,kind,
      dueAt:kind==='old'?saved.move_to_old_at:saved.move_to_pending_at},kind==='old'?saved.move_to_old_at:saved.move_to_pending_at);
    beforeEach(async () => {
      clock = new Date('2030-09-26T09:10:00+05:30');
      await query("UPDATE leads SET assigned_at='2030-09-26T09:00:00+05:30',full_name='Counselor fixture',phone='919999111111',email='fixture@example.test',source='meta',category='trader',campaign_name='September' WHERE id=$1",[leadId]);
      await query("UPDATE lead_assignments SET assigned_at='2030-09-26T09:00:00+05:30' WHERE lead_id=$1",[leadId]);
      service=createService(db,{logger:false, rolloutMode:'all', rolloutAt:cutoff,now:()=>clock});
    });
    afterEach(()=>{service=createService(db,{logger:false, rolloutMode:'all', rolloutAt:cutoff});});

    test('New work then Old work yields total 2, N 1, O 1 and one list card', async () => {
      await service.tick();
      const initial = await state();
      expect((await workspace('received')).total).toBe(1);
      expect((await workspace('new')).total).toBe(1);
      let saved=(await service.recordRemark(user,leadId,input(initial.generation))).state;
      let worked=await workspace('worked');
      expect(worked.worked).toEqual({n:1,o:0}); expect(worked.summary.worked).toBe(1);
      expect((await workspace('new')).total).toBe(0); expect((await workspace('cc')).total).toBe(1);
      await process(saved,'old');
      expect((await workspace('old')).total).toBe(1); expect((await workspace('cc')).total).toBe(1);
      clock=new Date(saved.move_to_old_at.getTime()+60000);
      saved=(await service.recordRemark(user,leadId,input(saved.generation,randomUUID(),'personal_meeting'))).state;
      worked=await workspace('worked');
      expect(worked.worked).toEqual({n:1,o:1}); expect(worked.summary.worked).toBe(2);
      expect(worked.total).toBe(1); expect(worked.rows).toHaveLength(1);
      expect(worked.rows[0]).toMatchObject({worked_n:true,worked_o:true,primary_status:'personal_meeting'});
      await process(saved,'old'); clock=new Date(saved.move_to_old_at.getTime()+60000);
      await service.recordRemark(user,leadId,input(saved.generation,randomUUID(),'quotation'));
      expect((await workspace('worked')).worked).toEqual({n:1,o:1});
    });

    test('repeated New-source work and intervening negative remarks deduplicate within N', async () => {
      let saved=(await service.recordRemark(user,leadId,input())).state;
      saved=(await service.recordRemark(user,leadId,input(saved.generation,randomUUID(),'cnr'))).state;
      saved=(await service.recordRemark(user,leadId,input(saved.generation))).state;
      clock=new Date(clock.getTime()+hour);
      await db.withTransaction(async client=>{
        await client.query('UPDATE lead_assignments SET unassigned_at=$2 WHERE lead_id=$1',[leadId,clock]);
        await client.query('UPDATE leads SET assigned_at=$2 WHERE id=$1',[leadId,clock]);
        await client.query('INSERT INTO lead_assignments(lead_id,user_id,assigned_to_user_id,assigned_at,previous_user_id) VALUES($1,$2,$2,$3,$2)',[leadId,user.id,clock]);
      });
      await service.tick();
      await service.recordRemark(user,leadId,input((await state()).generation,randomUUID(),'cnr'));
      expect((await events()).filter(e=>e.work_source==='new')).toHaveLength(2);
      expect((await workspace('worked')).worked).toEqual({n:1,o:0});
    });

    test.each(['cnr','busy','call_cut_busy','so','nrac','custom_remark','not_interested'])('any real %s remark counts as New work',async primary=>{
      await service.recordRemark(user,leadId,input(0,randomUUID(),primary));
      expect((await workspace('worked')).worked).toEqual({n:1,o:0});
    });

    test('legacy free-text counselor remark also contributes once from New',async()=>{
      await service.tick();
      const activity={user,leadId,remarkId:randomUUID(),statuses:[]};
      await db.withTransaction(client=>service.observeRemark({...activity,client}));
      await db.withTransaction(client=>service.observeRemark({...activity,client}));
      expect((await workspace('worked')).worked).toEqual({n:1,o:0});
    });

    test('untouched New to Pending creates no Worked count',async()=>{
      await service.tick(); await process(await state(),'pending');
      expect((await workspace('worked')).worked).toEqual({n:0,o:0});
      expect((await workspace('worked')).total).toBe(0);
      expect((await workspace('pending')).total).toBe(1);
    });

    test('work date differs from received date and honors Kolkata midnight boundaries',async()=>{
      await query("UPDATE leads SET assigned_at='2030-09-25T18:00:00+05:30' WHERE id=$1",[leadId]);
      await query("UPDATE lead_assignments SET assigned_at='2030-09-25T18:00:00+05:30' WHERE lead_id=$1",[leadId]);
      clock=new Date('2030-09-26T00:00:00+05:30');
      let saved=(await service.recordRemark(user,leadId,input())).state;
      expect((await workspace('received')).total).toBe(0);
      expect((await workspace('received',{from:'2030-09-25',to:'2030-09-25'})).total).toBe(1);
      expect((await workspace('worked')).worked).toEqual({n:1,o:0});
      expect((await workspace('worked',{from:'2030-09-25',to:'2030-09-25'})).total).toBe(0);
      await process(saved,'old');clock=new Date('2030-09-27T00:00:00+05:30');
      await service.recordRemark(user,leadId,input(saved.generation,randomUUID(),'quotation'));
      expect((await workspace('worked')).worked).toEqual({n:1,o:0});
      expect((await workspace('worked',{from:'2030-09-27',to:'2030-09-27'})).worked).toEqual({n:0,o:1});
      expect((await workspace('worked',{to:'2030-09-27'})).summary.worked).toBe(2);
    });

    test('current Pending and complete journey history remain separate',async()=>{
      const saved=(await service.recordRemark(user,leadId,input())).state;
      await process(saved,'old');await process(saved,'pending');
      const result=await workspace('pending');
      expect(result.rows[0]).toMatchObject({queue:'pending',journey_active:false,primary_status:'communication_completed'});
      expect(result.rows[0].history.map(e=>e.event_type)).toEqual(['workflow_enrolled','remark_saved','entered_old','entered_pending']);
      expect((await workspace('cc')).total).toBe(0);expect((await workspace('old')).total).toBe(0);
    });

    test.each([
      ['communication_completed','cc'],['respond_hi','responded'],['common_meeting','common_meeting'],['dim','dim'],
      ['personal_meeting','personal_meeting'],['follow_up','follow_up'],['quotation','quotation'],['hot','hot'],['warm','warm'],
      ['special_category','special_category'],['call_reminder','call_reminder'],['handover_rm','handover_rm'],
      ['not_attended','not_attended'],['converted','converted'],['cold','cold'],['process_incomplete','process_incomplete'],['cnr','call_issues'],
    ])('%s row and %s summary share classification with all 22 counts',async(primary,view)=>{
      await service.recordRemark(user,leadId,input(0,randomUUID(),primary));
      const result=await workspace(view);
      expect(Object.keys(result.summary)).toHaveLength(22);
      expect(result.total).toBe(1);expect(result.summary[view]).toBe(result.total);
      expect(result.rows[0].primary_status).toBe(primary);
      for(const key of Object.keys(result.summary)) {
        const list=await workspace(key);
        expect(list.summary[key]).toBe(key==='worked'?list.worked.n+list.worked.o:list.total);
      }
    });

    test.each([{q:'Counselor'},{q:'919999'},{q:'fixture@example.test'},{source:'meta'},{category:'trader'},{campaign:'Sept'},{call_status:'cnr'},{remark_status:'cnr'}])('shared filters retain count/list parity: %j',async filters=>{
      await service.recordRemark(user,leadId,input(0,randomUUID(),'cnr'));
      const result=await workspace('call_issues',filters);
      expect(result.total).toBe(1);expect(result.summary.call_issues).toBe(1);expect(result.summary.worked).toBe(1);
    });

    test('search is parameterized, wildcard literals are escaped, and invalid dates/scope fail',async()=>{
      await service.recordRemark(user,leadId,input());
      for(const q of ['%','nonexistent',"' OR 1=1 --"]) expect((await workspace('worked',{q})).total).toBe(0);
      await expect(workspace('worked',{from:'2030-02-30'})).rejects.toMatchObject({code:'INVALID_DATE_RANGE'});
      await expect(workspace('worked',{assigned_to:other.id})).rejects.toMatchObject({status:403});
      await expect(service.workspace({...user,role:'rm'},daily)).rejects.toMatchObject({status:403});
      await expect(workspace("old' OR TRUE --")).rejects.toMatchObject({status:400});
    });

    test('custom follow-up records work but cannot age, and explicit clear restarts policy',async()=>{
      const saved=(await service.recordRemark(user,leadId,{...input(),next_followup_at:'2030-09-28T10:00:00+05:30'})).state;
      expect((await workspace('worked')).worked).toEqual({n:1,o:0});
      expect(await process(saved,'old')).toEqual({stale:true});
      clock=new Date(clock.getTime()+hour);
      const next=await service.recordRemark(user,leadId,{...input(saved.generation,randomUUID(),'respond_hi'),next_followup_at:null});
      expect(next.state.followup_override).toBe(false);
      expect(next.state.move_to_old_at.toISOString()).toBe('2030-09-26T16:00:00.000Z');
    });

    test('historical work survives an approved reassignment with read-only access',async()=>{
      const saved=(await service.recordRemark(user,leadId,input())).state;
      await db.withTransaction(async client=>{
        await client.query('UPDATE leads SET assigned_to_user_id=$2,assigned_at=$3 WHERE id=$1',[leadId,other.id,clock]);
        await client.query('INSERT INTO lead_assignments(lead_id,user_id,assigned_to_user_id,assigned_at,previous_user_id) VALUES($1,$2,$2,$3,$4)',[leadId,other.id,clock,user.id]);
      });
      const result=await workspace('worked');
      expect(result.worked).toEqual({n:1,o:0});expect(result.rows[0].read_only).toBe(true);
      expect((await service.read(user,leadId)).read_only).toBe(true);
      await expect(service.recordRemark(user,leadId,input(saved.generation))).rejects.toMatchObject({status:403});
      expect((await service.workspace(other,{...daily,view:'worked'})).total).toBe(0);
    });

    test('legacy rows stay readable in Received without invented work or journey',async()=>{
      const before=await events();
      const received=await workspace('received');
      expect(received.total).toBe(1);expect(received.rows[0].generation).toBeNull();
      expect(received.rows[0].history).toEqual([]);expect(received.summary.worked).toBe(0);
      expect(await events()).toEqual(before);
    });

    test('list history is bounded and full paginated history remains available',async()=>{
      let saved=(await service.recordRemark(user,leadId,input())).state;
      for(let i=0;i<54;i++) saved=(await service.recordRemark(user,leadId,input(saved.generation))).state;
      const list=await workspace('cc');
      expect(list.rows[0].history).toHaveLength(8);expect(list.rows[0].history_total).toBe(56);
      const first=await service.read(user,leadId,{page:1});const second=await service.read(user,leadId,{page:2});
      expect(first.events).toHaveLength(50);expect(first.has_more).toBe(true);
      expect(second.events).toHaveLength(6);expect(second.has_more).toBe(false);
      expect(new Set([...first.events,...second.events].map(e=>e.id)).size).toBe(56);
      expect((await workspace('worked')).worked).toEqual({n:1,o:0});
    });
  });

  describe('Stage 4 New and Call Issue workflows', () => {
    let clock;
    const hour = 3600000;
    const job = (saved,kind) => ({leadId,generation:saved.generation,kind,
      dueAt:kind === 'old' ? saved.move_to_old_at : saved.move_to_pending_at});
    async function assign(at, owner = user, previous = null) {
      await db.withTransaction(async client => {
        await client.query('UPDATE lead_assignments SET unassigned_at=$2 WHERE lead_id=$1 AND unassigned_at IS NULL',[leadId,at]);
        await client.query('UPDATE leads SET assigned_to_user_id=$2,assigned_at=$3 WHERE id=$1',[leadId,owner.id,at]);
        await client.query('INSERT INTO lead_assignments(lead_id,user_id,assigned_to_user_id,assigned_at,previous_user_id) VALUES ($1,$2,$2,$3,$4)',[leadId,owner.id,at,previous?.id || null]);
      });
      await service.tick();
      return state();
    }
    beforeEach(() => {
      clock = new Date('2030-09-26T09:00:00+05:30');
      service = createService(db,{logger:false, rolloutMode:'all', rolloutAt:cutoff,now:() => clock});
    });
    afterEach(() => { service = createService(db,{logger:false, rolloutMode:'all', rolloutAt:cutoff}); });

    test.each([
      ['2030-09-26T09:00:00+05:30','2030-09-26T11:00:00+05:30'],
      ['2030-09-26T15:30:00+05:30','2030-09-26T17:30:00+05:30'],
      ['2030-09-26T17:00:00+05:30','2030-09-26T19:00:00+05:30'],
      ['2030-09-26T17:00:00.001+05:30','2030-09-27T10:00:00+05:30'],
      ['2030-09-26T18:00:00+05:30','2030-09-27T10:00:00+05:30'],
      ['2030-09-26T23:30:00+05:30','2030-09-27T10:00:00+05:30'],
      ['2030-09-26T07:30:00+05:30','2030-09-26T10:00:00+05:30'],
    ])('assignment at %s persists a direct Pending deadline at %s', async (at,expected) => {
      const saved = await assign(at);
      expect(saved.move_to_old_at).toBeNull();
      expect(saved.move_to_pending_at).toEqual(new Date(expected));
      for (const view of ['received','new']) expect((await service.workspace(user,{view})).rows.map(r => r.lead_id)).toEqual([leadId]);
      const deadline = job(saved,'pending');
      expect(await service.processDeadline(deadline,new Date(Date.parse(expected)-1))).toEqual({stale:true});
      await Promise.all([service.processDeadline(deadline,new Date(expected)),service.processDeadline(deadline,new Date(expected))]);
      expect(await state()).toMatchObject({queue:'pending',journey_active:false,primary_status:null});
      for (const view of ['new','old','call_issues']) expect(await service.workspace(user,{view})).toMatchObject({total:0,rows:[]});
      expect((await service.workspace(user,{view:'pending'})).total).toBe(1);
      expect((await service.workspace(user,{view:'received'})).total).toBe(1);
      const history = await events();
      expect(history.map(e => e.event_type)).toEqual(['workflow_enrolled','entered_pending']);
      expect(history[0].occurred_at).toEqual(new Date(at));
      expect(history[1].occurred_at).toEqual(new Date(expected));
      expect(history.some(e => e.is_work)).toBe(false);
    });

    test.each([true,false])('any counselor remark interrupts New one minute before timeout (explicit=%s)', async explicit => {
      const saved = await assign(clock.toISOString());
      clock = new Date(saved.move_to_pending_at.getTime()-60000);
      if (explicit) await service.recordRemark(user,leadId,input(saved.generation));
      else await db.withTransaction(client => service.observeRemark({client,user,leadId,remarkId:randomUUID(),statuses:[]}));
      expect(await service.processDeadline(job(saved,'pending'),saved.move_to_pending_at)).toEqual({stale:true});
      expect((await state()).queue).toBeNull();
      if (explicit) expect((await state()).move_to_old_at.getTime()).toBe(clock.getTime()+hour);
      else expect((await state()).awaiting_primary).toBe(true);
      expect((await events()).filter(e => e.is_work).map(e => e.work_source)).toEqual(['new']);
    });

    test('New worker rechecks counselor notes written outside a workflow adapter', async () => {
      const saved = await assign(clock.toISOString());
      await query('INSERT INTO lead_remarks(lead_id,user_id,remark,created_at) VALUES ($1,$2,$3,$4)',[leadId,user.id,'Legacy note',clock]);
      expect(await service.processDeadline(job(saved,'pending'),saved.move_to_pending_at)).toEqual({stale:true});
      expect(await state()).toMatchObject({queue:null,awaiting_primary:true,move_to_pending_at:null});
      expect((await events()).filter(e => e.event_type === 'entered_pending')).toHaveLength(0);
    });

    test('manager notes do not count as a counselor working a New assignment', async () => {
      await query('INSERT INTO lead_remarks(lead_id,user_id,remark,created_at) VALUES ($1,$2,$3,$4)',[leadId,other.id,'Assignment context',clock]);
      const saved = await assign(clock.toISOString());
      expect(saved.queue).toBe('new');
      await db.withTransaction(client => service.observeRemark({client,user:{...other,role:'rm'},leadId,remarkId:randomUUID(),statuses:[]}));
      expect((await state()).generation).toBe(saved.generation);
      expect((await service.processDeadline(job(saved,'pending'),saved.move_to_pending_at)).transitioned).toBe(true);
    });

    test('new remark wins a concurrent race with the New Pending deadline', async () => {
      const saved = await assign(clock.toISOString());
      clock = new Date(saved.move_to_pending_at.getTime()-60000);
      await Promise.all([service.processDeadline(job(saved,'pending'),saved.move_to_pending_at),service.recordRemark(user,leadId,input(saved.generation))]);
      expect(await state()).toMatchObject({primary_status:'communication_completed',queue:null,journey_active:true});
      expect(await service.processDeadline(job(saved,'pending'),saved.move_to_pending_at)).toEqual({stale:true});
    });

    test('stale assignment audit rows cannot authorize a fresh New timeout', async () => {
      await assign(clock.toISOString());
      clock = new Date(clock.getTime()+hour);
      await query('UPDATE leads SET assigned_at=$2 WHERE id=$1',[leadId,clock]);
      await service.tick();
      expect(await state()).toMatchObject({queue:null,awaiting_primary:true,move_to_pending_at:null});
    });

    test('approved reassignment starts a fresh New timeout and preserves prior journey history', async () => {
      let saved = await assign(clock.toISOString());
      saved = (await service.recordRemark(user,leadId,input(saved.generation,randomUUID(),'cnr'))).state;
      clock = new Date(clock.getTime()+hour);
      const next = await assign(clock.toISOString(),other,user);
      expect(next).toMatchObject({queue:'new',primary_status:null,assigned_to_user_id:other.id});
      expect(next.move_to_pending_at.getTime()).toBe(clock.getTime()+2*hour);
      expect(await service.processDeadline(job(saved,'old'),saved.move_to_old_at)).toEqual({stale:true});
      expect((await service.workspace(user,{view:'received'})).total).toBe(1);
      expect((await service.workspace(user,{view:'received'})).rows[0].read_only).toBe(true);
      expect((await service.workspace(other,{view:'new'})).total).toBe(1);
      expect((await events()).filter(e => e.event_type === 'remark_saved')).toHaveLength(1);
      expect((await events()).find(e => e.event_type === 'assignment_changed').previous_state.primary_status).toBe('cnr');
    });

    test('custom follow-up blocks unworked New aging', async () => {
      await query('UPDATE leads SET next_followup_at=$2 WHERE id=$1',[leadId,new Date(clock.getTime()+24*hour)]);
      const saved = await assign(clock.toISOString());
      expect(await service.processDeadline(job(saved,'pending'),new Date(clock.getTime()+48*hour))).toEqual({stale:true});
      expect((await state()).queue).toBe('new');
    });

    const policies = [
      ...RETRYABLE_ISSUES.map(primary => [primary,'2030-09-26T23:30:00+05:30','2030-09-27T01:30:00+05:30',22]),
      ...NR_STATUSES.flatMap(primary => [
        [primary,'2030-09-26T15:30:00+05:30','2030-09-26T17:30:00+05:30',14],
        [primary,'2030-09-26T18:00:00+05:30','2030-09-27T10:00:00+05:30',14],
        [primary,'2030-09-26T07:00:00+05:30','2030-09-26T10:00:00+05:30',14],
      ]),
    ];
    test.each(policies)('%s at %s overlaps CI/Old at %s and becomes Pending +%ih', async (primary,at,old,additional) => {
      clock = new Date(at);
      const saved = (await service.recordRemark(user,leadId,input(0,randomUUID(),primary))).state;
      expect(saved.move_to_old_at).toEqual(new Date(old));
      expect(saved.move_to_pending_at.getTime()).toBe(Date.parse(old)+additional*hour);
      expect(await service.processDeadline(job(saved,'old'),new Date(Date.parse(old)-60000))).toEqual({stale:true});
      expect((await service.workspace(user,{view:'call_issues'})).total).toBe(1);
      expect((await service.workspace(user,{view:'old'})).total).toBe(0);
      await Promise.all([service.processDeadline(job(saved,'old'),new Date(old)),service.processDeadline(job(saved,'old'),new Date(old))]);
      for (const view of [primary,'call_issues','old']) {
        const list = await service.workspace(user,{view});
        expect(list.total).toBe(1); expect(list.rows.map(r => r.lead_id)).toEqual([leadId]);
        expect(list.rows[0].primary_status).toBe(primary);
      }
      await service.processDeadline(job(saved,'pending'),saved.move_to_pending_at);
      for (const view of [primary,'call_issues','old']) expect(await service.workspace(user,{view})).toMatchObject({total:0,rows:[]});
      const pending = await service.workspace(user,{view:'pending'});
      expect(pending.total).toBe(1); expect(pending.rows.map(r => r.lead_id)).toEqual([leadId]);
      const history = await events();
      expect(history.map(e => e.event_type)).toEqual(['workflow_enrolled','remark_saved','entered_old','entered_pending']);
      expect(history.find(e => e.event_type === 'entered_old').occurred_at).toEqual(new Date(old));
      expect(history.find(e => e.event_type === 'entered_pending').occurred_at).toEqual(saved.move_to_pending_at);
    });

    test.each(['cnr','nrac','nracm','nrapm','nraf','nraq'])('%s interruption cancels both queued deadlines and preserves N/O work', async primary => {
      let saved = (await service.recordRemark(user,leadId,input(0,randomUUID(),primary))).state;
      clock = new Date(clock.getTime()+hour);
      let next = await service.recordRemark(user,leadId,input(saved.generation));
      expect(await service.processDeadline(job(saved,'old'),saved.move_to_old_at)).toEqual({stale:true});
      expect(next.state.primary_status).toBe('communication_completed');
      saved = (await service.recordRemark(user,leadId,input(next.state.generation,randomUUID(),primary))).state;
      await service.processDeadline(job(saved,'old'),saved.move_to_old_at);
      clock = new Date(saved.move_to_pending_at.getTime()-60000);
      next = await service.recordRemark(user,leadId,input(saved.generation,randomUUID(),'personal_meeting'));
      expect(await service.processDeadline(job(saved,'pending'),saved.move_to_pending_at)).toEqual({stale:true});
      expect(next.state.move_to_old_at.getTime()).toBe(clock.getTime()+hour);
      expect((await events()).filter(e => e.is_work).map(e => e.work_source)).toEqual(['new',null,null,'old']);
    });

    test.each([...RETRYABLE_ISSUES,...NR_STATUSES])('custom follow-up suspends %s without competing timers', async primary => {
      const saved = (await service.recordRemark(user,leadId,{...input(0,randomUUID(),primary),next_followup_at:new Date(clock.getTime()+48*hour).toISOString()})).state;
      const late = new Date(clock.getTime()+72*hour);
      expect(await service.processDeadline(job(saved,'old'),late)).toEqual({stale:true});
      expect(await service.processDeadline(job(saved,'pending'),late)).toEqual({stale:true});
      expect(await state()).toMatchObject({queue:null,journey_active:true});
    });

    test('a custom follow-up added after entering Old also blocks Pending', async () => {
      const saved = (await service.recordRemark(user,leadId,input(0,randomUUID(),'cnr'))).state;
      await service.processDeadline(job(saved,'old'),saved.move_to_old_at);
      await query('UPDATE leads SET next_followup_at=$2 WHERE id=$1',[leadId,new Date(clock.getTime()+48*hour)]);
      expect(await service.processDeadline(job(saved,'pending'),saved.move_to_pending_at)).toEqual({stale:true});
      expect((await state()).queue).toBe('old');
    });

    test.each(['in','invalid_number','wrong_number','ni','language_barrier'])('%s remains an untimed active CI subtype', async primary => {
      const saved = (await service.recordRemark(user,leadId,input(0,randomUUID(),primary))).state;
      expect(saved).toMatchObject({move_to_old_at:null,move_to_pending_at:null});
      const list = await service.workspace(user,{view:'call_issues'});
      expect(list.total).toBe(1); expect(list.rows[0].primary_status).toBe(primary);
    });

    test('secondary call issues do not put a main journey into CI', async () => {
      await service.recordRemark(user,leadId,{...input(),statuses:['cnr','nrac','communication_completed']});
      expect(await service.workspace(user,{view:'call_issues'})).toMatchObject({total:0,rows:[]});
    });

    test('CI count and paginated rows use the same classification beyond one page', async () => {
      const saved = (await service.recordRemark(user,leadId,input(0,randomUUID(),'cnr'))).state;
      await query(`WITH fixtures AS (
        INSERT INTO leads(id,assigned_to_user_id,assigned_at)
        SELECT gen_random_uuid(),$1::uuid,$2::timestamptz FROM generate_series(1,26) RETURNING id
      ) INSERT INTO counselor_workflow_state(lead_id,primary_status,journey_active,assigned_to_user_id,
        assignment_at,enrolled_at,workflow_started_at)
        SELECT id,'cnr',TRUE,$1::uuid,$2::timestamptz,NOW(),NOW() FROM fixtures`,[user.id,saved.assignment_at]);
      let classificationQuery;
      const inspected = createService({...db,query:async (sql,params) => {
        if (sql.includes('classified AS MATERIALIZED')) classificationQuery = {sql,params};
        return query(sql,params);
      }},{logger:false, rolloutMode:'all', rolloutAt:cutoff});
      const first = await inspected.workspace(user,{view:'call_issues'});
      const second = await inspected.workspace(user,{view:'call_issues',page:2});
      expect(first.total).toBe(27); expect(second.total).toBe(27);
      expect(first.rows).toHaveLength(25); expect(second.rows).toHaveLength(2);
      expect(new Set([...first.rows,...second.rows].map(row => row.lead_id)).size).toBe(27);
      const plan = await query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${classificationQuery.sql}`,classificationQuery.params);
      const diagnostic = plan.rows[0]['QUERY PLAN'][0];
      const nodes = [];
      const visit = node => { nodes.push({type:node['Node Type'],rows:node['Actual Rows'],index:node['Index Name']}); (node.Plans || []).forEach(visit); };
      visit(diagnostic.Plan);
      console.info('CI fixture query plan:',JSON.stringify({execution_ms:diagnostic['Execution Time'],nodes}));
    });

    test('old assignments remain unmanaged; a new NR remark starts only its prospective policy', async () => {
      await query("UPDATE leads SET assigned_at=NOW()-INTERVAL '1 year' WHERE id=$1",[leadId]);
      await service.tick();
      expect(await state()).toBeUndefined();
      const saved = await service.recordRemark(user,leadId,input(0,randomUUID(),'nrac'));
      expect(saved.event.work_source).toBeNull();
      expect(saved.state.move_to_old_at.getTime()).toBe(clock.getTime()+2*hour);
      expect((await events()).some(e => ['entered_old','entered_pending'].includes(e.event_type))).toBe(false);
    });
  });

  describe('Stage 3 automatic main journey policies', () => {
    let clock;
    const start = '2030-09-26T09:30:00.000Z'; // 3 PM Asia/Kolkata
    const hour = 3600000;
    const job = (saved, kind) => ({leadId,generation:saved.generation,kind,
      dueAt:kind === 'old' ? saved.move_to_old_at : saved.move_to_pending_at});
    beforeEach(() => {
      clock = new Date(start);
      service = createService(db,{logger:false, rolloutMode:'all', rolloutAt:cutoff,now:() => clock});
    });
    afterEach(() => { service = createService(db,{logger:false, rolloutMode:'all', rolloutAt:cutoff}); });

    test.each([
      ['communication_completed','cc',1,20], ['respond_hi','responded',6.5,20],
      ['common_meeting','common_meeting',15,20], ['dim','dim',15,20],
      ['personal_meeting','personal_meeting',1,5], ['quotation','quotation',1,5],
      ['follow_up','follow_up',18,6], ['hot','hot',6,18], ['warm','warm',6,18],
      ['process_incomplete','process_incomplete',6,18],
    ])('%s persists both deadlines and correct tab membership at every boundary', async (primary,view,first,second) => {
      const result = await service.recordRemark(user,leadId,input(0,randomUUID(),primary));
      const saved = result.state;
      const old = new Date(Date.parse(start)+first*hour);
      const pending = new Date(old.getTime()+second*hour);
      expect(saved.move_to_old_at).toEqual(old);
      expect(saved.move_to_pending_at).toEqual(pending);
      expect(result.event.new_state.policy_version).toBe('main_journey_v1');
      expect((await service.workspace(user,{view:'new'})).total).toBe(0);
      expect(await service.processDeadline(job(saved,'old'),new Date(old.getTime()-60000))).toEqual({stale:true});
      expect((await state()).queue).toBeNull();
      expect((await service.workspace(user,{view})).total).toBe(1);
      await Promise.all([service.processDeadline(job(saved,'old'),old),service.processDeadline(job(saved,'old'),old)]);
      for (const tab of [view,'old']) {
        const list = await service.workspace(user,{view:tab});
        expect(list.total).toBe(1);
        expect(list.rows.map(row => row.lead_id)).toEqual([leadId]);
      }
      expect(await service.processDeadline(job(saved,'pending'),new Date(pending.getTime()-1))).toEqual({stale:true});
      await Promise.all([service.processDeadline(job(saved,'pending'),pending),service.processDeadline(job(saved,'pending'),pending)]);
      expect(await state()).toMatchObject({queue:'pending',journey_active:false,primary_status:primary});
      for (const tab of [view,'old']) {
        expect(await service.workspace(user,{view:tab})).toMatchObject({total:0,rows:[]});
      }
      expect((await service.workspace(user,{view:'pending'})).rows.map(row => row.lead_id)).toEqual([leadId]);
      const history = await events();
      expect(history.map(e => e.event_type)).toEqual(['workflow_enrolled','remark_saved','entered_old','entered_pending']);
      expect(history.find(e => e.event_type === 'entered_old').occurred_at).toEqual(old);
      expect(history.find(e => e.event_type === 'entered_pending').occurred_at).toEqual(pending);
    });

    test.each([
      ['2030-09-26T21:29:00+05:30','2030-09-26T16:00:00.000Z'],
      ['2030-09-26T21:30:00+05:30','2030-09-26T16:00:00.000Z'],
      ['2030-09-26T21:32:00+05:30','2030-09-27T16:00:00.000Z'],
    ])('Responded save at %s persists the cutoff and +20h Pending', async (at,expected) => {
      clock = new Date(at);
      const saved = (await service.recordRemark(user,leadId,input(0,randomUUID(),'respond_hi'))).state;
      expect(saved.move_to_old_at.toISOString()).toBe(expected);
      expect(saved.move_to_pending_at.getTime()).toBe(Date.parse(expected)+20*hour);
    });

    test.each(['old','pending'])('new primary one minute before %s cancels the previous generation', async kind => {
      const saved = (await service.recordRemark(user,leadId,input())).state;
      if (kind === 'pending') await service.processDeadline(job(saved,'old'),saved.move_to_old_at);
      const staleJob = job(saved,kind);
      clock = new Date(staleJob.dueAt.getTime()-60000);
      const next = await service.recordRemark(user,leadId,input(saved.generation,randomUUID(),'hot'));
      expect(next.state.generation).toBeGreaterThan(saved.generation);
      expect(next.state.move_to_old_at.getTime()).toBe(clock.getTime()+6*hour);
      expect(await service.processDeadline(staleJob,staleJob.dueAt)).toEqual({stale:true});
      expect(await state()).toMatchObject({primary_status:'hot',journey_active:true,queue:null});
      expect((await events()).filter(e => e.event_type === 'remark_saved')).toHaveLength(2);
    });

    test('secondary timed statuses never select a policy, and legacy input cancels it', async () => {
      let saved = await service.recordRemark(user,leadId,{...input(),statuses:['hot','communication_completed','quotation']});
      expect(saved.state.move_to_old_at.getTime()).toBe(clock.getTime()+hour);
      saved = await service.recordRemark(user,leadId,{...input(saved.state.generation,randomUUID(),'special_category'),statuses:['hot','special_category']});
      expect(saved.state).toMatchObject({primary_status:'special_category',move_to_old_at:null,move_to_pending_at:null});
      await db.withTransaction(client => service.observeRemark({client,user,leadId,remarkId:randomUUID(),statuses:['hot','quotation']}));
      expect(await state()).toMatchObject({awaiting_primary:true,move_to_old_at:null,move_to_pending_at:null});
    });

    test('an explicit legacy adapter primary receives the same automatic policy', async () => {
      const saved = await db.withTransaction(client => service.observeRemark({client,user,leadId,
        remarkId:randomUUID(),primaryStatus:'dim',statuses:['hot','dim']}));
      expect(saved.state.move_to_old_at.getTime()).toBe(clock.getTime()+15*hour);
      expect(saved.state.move_to_pending_at.getTime()).toBe(clock.getTime()+35*hour);
    });

    test('custom follow-up blocks both default transitions, including after its timestamp passes', async () => {
      const saved = (await service.recordRemark(user,leadId,{...input(),next_followup_at:new Date(clock.getTime()+hour).toISOString()})).state;
      expect(saved.followup_override).toBe(true);
      const later = new Date(clock.getTime()+48*hour);
      expect(await service.processDeadline(job(saved,'old'),later)).toEqual({stale:true});
      expect(await service.processDeadline(job(saved,'pending'),later)).toEqual({stale:true});
      expect(await state()).toMatchObject({queue:null,journey_active:true});
      clock = later;
      const restarted = await service.recordRemark(user,leadId,input(saved.generation));
      expect(restarted.state.followup_override).toBe(false);
      expect(restarted.state.move_to_old_at.getTime()).toBe(later.getTime()+hour);
    });

    test('late workers retain logical history times across a service restart', async () => {
      const saved = (await service.recordRemark(user,leadId,input())).state;
      const restarted = createService(db,{logger:false, rolloutMode:'all', rolloutAt:cutoff});
      const late = new Date(saved.move_to_pending_at.getTime()+48*hour);
      expect(await restarted.processDeadline(job(saved,'pending'),late)).toEqual({deferred:true});
      await restarted.processDeadline(job(saved,'old'),late);
      await restarted.processDeadline(job(saved,'pending'),late);
      const history = await events();
      expect(history.find(e => e.event_type === 'entered_old').occurred_at).toEqual(saved.move_to_old_at);
      expect(history.find(e => e.event_type === 'entered_pending').occurred_at).toEqual(saved.move_to_pending_at);
    });

    test('existing Stage 2 journeys are not retrospectively scheduled by reads or ticks', async () => {
      await service.recordRemark(user,leadId,input());
      await query("UPDATE counselor_workflow_state SET policy_version='foundation_v1',move_to_old_at=NULL,move_to_pending_at=NULL WHERE lead_id=$1",[leadId]);
      const before = await events();
      await service.read(user,leadId);
      await service.tick();
      expect(await state()).toMatchObject({policy_version:'foundation_v1',move_to_old_at:null,move_to_pending_at:null});
      expect(await events()).toEqual(before);
    });

    test.each(['special_category','call_reminder','handover_rm','not_attended','converted','cold'])('%s cancels prior aging without starting another timer', async primary => {
      const saved = (await service.recordRemark(user,leadId,input())).state;
      const next = await service.recordRemark(user,leadId,input(saved.generation,randomUUID(),primary));
      expect(next.state).toMatchObject({primary_status:primary,move_to_old_at:null,move_to_pending_at:null,assigned_to_user_id:user.id});
      expect(await service.processDeadline(job(saved,'old'),saved.move_to_old_at)).toEqual({stale:true});
    });
  });
});
