jest.mock('../../config/database', () => ({query: jest.fn()}));
jest.mock('../../middleware/rbac', () => ({getVisibleUserIds: jest.fn()}));
const {query} = require('../../config/database');
const {getVisibleUserIds} = require('../../middleware/rbac');
const {leadCosts, summarizeCosts} = require('../leadCostReporting');
const campaign = (count, cpl, currency = 'INR') => ({lead_count:count,cost_per_result:cpl,currency,spend:400,last_metrics_synced_at:'2026-10-07T10:00:00Z'});
beforeEach(() => jest.clearAllMocks());
test('20 leads at Meta CPL 20 cost 400, multiple campaign CPLs are weighted', () => {
  expect(summarizeCosts([campaign(20,20)],false).groups[0]).toMatchObject({allocated_cost:400,average_cpl:20,priced_leads:20});
  const result = summarizeCosts([campaign(20,20),campaign(10,50)],true);
  expect(result.groups[0]).toMatchObject({allocated_cost:900,average_cpl:30,campaign_spend:800});
});
test('unknown, failed, negative and currency-less costs are excluded, not zero-priced', () => {
  const rows = [campaign(2,null),campaign(3,-1),campaign(4,20,''),{...campaign(5,20),metrics_error:'failed'}, {...campaign(6,20),last_metrics_synced_at:null}];
  expect(summarizeCosts(rows,false)).toMatchObject({total_leads:20,missing_cost_leads:20,groups:[]});
});
test('currencies remain separate; real zero CPL works; dates show oldest sync', () => {
  const result = summarizeCosts([campaign(2,0),campaign(3,10,'USD'),{...campaign(2,20),last_metrics_synced_at:'2026-10-06T10:00:00Z'}],false);
  expect(result.groups).toHaveLength(2);
  expect(result.groups[0]).toMatchObject({allocated_cost:40,oldest_sync:'2026-10-06T10:00:00Z'});
  expect(result.groups[0]).not.toHaveProperty('campaign_spend');
  expect(summarizeCosts([],false)).toMatchObject({total_leads:0,groups:[]});
  expect(summarizeCosts([{...campaign(2,20),spend:null}],true).groups[0]).not.toHaveProperty('campaign_spend');
});
test.each(['member','partner'])('counselor %s is scoped to self regardless of supplied owner', async role => {
  query.mockResolvedValue({rows:[]});
  await leadCosts({id:'self',role,rm_id:'other'});
  expect(query.mock.calls[0][1]).toEqual([['self']]);
  expect(getVisibleUserIds).not.toHaveBeenCalled();
});
test('RM scope is server-derived and empty scope never becomes global', async () => {
  query.mockResolvedValue({rows:[]});getVisibleUserIds.mockResolvedValue([]);
  await leadCosts({id:'rm',role:'rm'});
  expect(query.mock.calls[0][1]).toEqual([[]]);
  expect(query.mock.calls[0][0]).toContain('l.deleted_at IS NULL');
});
test('Super Admin gets global scope and campaign spend, errors propagate', async () => {
  getVisibleUserIds.mockResolvedValue(null);query.mockResolvedValue({rows:[campaign(20,20)]});
  expect((await leadCosts({id:'admin',role:'super_admin'})).groups[0].campaign_spend).toBe(400);
  expect(query.mock.calls[0][1]).toEqual([null]);
  query.mockRejectedValue(new Error('database unavailable'));
  await expect(leadCosts({id:'admin',role:'super_admin'})).rejects.toThrow('database unavailable');
});
test('unapproved roles cannot access the report', async () => {
  await expect(leadCosts({id:'client',role:'client'})).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
});

test('generated aggregate SQL counts deleted/owned/unassigned leads correctly', async () => {
  const {newDb}=require('pg-mem');
  const db=newDb();
  db.public.none(`CREATE TABLE leads(id text, meta_campaign_id text, assigned_to_user_id uuid, deleted_at timestamp);
    CREATE TABLE meta_campaigns(campaign_id text UNIQUE,cost_per_result numeric,spend numeric,last_metrics_synced_at timestamp,metrics_error text,ad_account_id text);
    CREATE TABLE meta_ad_accounts(account_id text UNIQUE,currency text);
    INSERT INTO meta_ad_accounts VALUES ('account','INR');
    INSERT INTO meta_campaigns VALUES ('campaign',20,400,'2026-10-07',NULL,'account');
    INSERT INTO leads VALUES ('one','campaign','11111111-1111-1111-1111-111111111111',NULL),('two','campaign',NULL,NULL),('deleted','campaign',NULL,'2026-10-07');`);
  const adapter=db.adapters.createPg();const pool=new adapter.Pool();
  query.mockImplementation((sql,params)=>pool.query(sql,params));getVisibleUserIds.mockResolvedValue(null);
  const result=await leadCosts({id:'admin',role:'super_admin'});
  expect(result.total_leads).toBe(2);expect(result.groups[0].allocated_cost).toBe(40);expect(result.groups[0].campaign_spend).toBe(400);
  const member=await leadCosts({id:'11111111-1111-1111-1111-111111111111',role:'member'});
  expect(member.total_leads).toBe(1);expect(member.groups[0].allocated_cost).toBe(20);
  await pool.end();
});

test('Meta sync pairs CPL with the selected lead action and clears empty snapshots',async()=>{
  const fs=require('fs');const path=require('path');
  const source=fs.readFileSync(path.join(__dirname,'../metaSyncService.js'),'utf8');
  const start=source.indexOf('async function syncCampaignMetrics(');
  const end=source.indexOf('//',start);
  const graph=jest.fn();const write=jest.fn();
  const sync=new Function('graphGet','query','toBigIntOrNull','toNumberOrNull',source.slice(start,end)+'; return syncCampaignMetrics;')(graph,write,v=>v==null?null:Number(v),v=>v==null?null:Number(v));
  graph.mockResolvedValue({data:[{spend:'400',actions:[{action_type:'lead',value:'20'}],cost_per_action_type:[{action_type:'other_lead',value:'999'},{action_type:'lead',value:'20'}]}]});
  await sync('campaign');expect(write.mock.calls[0][1][5]).toBe(20);
  graph.mockResolvedValue({data:[]});await sync('campaign');expect(write.mock.calls[1][0]).toContain('cost_per_result = NULL');
});
