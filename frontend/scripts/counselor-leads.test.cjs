// Run with: node --test scripts/counselor-leads.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '../src');
function harness(query = '', result = {}, overrides = {}) {
  if (result.data) result = {...result, data: {enabled:true,worked:{n:0,o:0},status_options:[],summary:{},...result.data}};
  const calls = [];
  const cache = new Map();
  const mocks = {
    '@/lib/auth': {useAuth: () => ({user:{id:'counselor',full_name:'Counselor',role:'member'}})},
    '@/hooks/useCounselorWorkflow': {
      COUNSELOR_FILTER_KEYS: ['q','source','category','stage','call_status','remark_status','campaign','followup','assigned_to'],
      useCounselorWorkflowLeads: input => { calls.push(input); return {isFetching:false,...result}; },
      useCounselorWorkflowDetail: () => ({data:{enabled:true,read_only:false,state:null,events:[],status_options:['communication_completed','cnr']}}),
      useCounselorRemark: () => ({isPending:false}),
    },
    'next/navigation': { useRouter: () => ({ replace() {} }), useSearchParams: () => new URLSearchParams(query) },
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/hooks/useLifecycle': {
      useCounselorWorkspaceLeads: input => { calls.push(input); return { isFetching: false, ...result }; },
      useCounselorWorkspaceSummary: () => ({ data: { summary: { received: 17 } } }),
    },
    '@/hooks/useLeads': { useCampaignNames: () => ({ data: ['Example campaign'] }) },
    '@/hooks/useLeadLabels': { useLabels: () => ({ data: [] }) },
    '@/hooks/useDebouncedValue': { useDebouncedValue: value => value },
    ...overrides,
  };
  function load(name) {
    if (mocks[name]) return mocks[name];
    if (!name.startsWith('@/') && !path.isAbsolute(name)) return require(name);
    let filename = name.startsWith('@/') ? path.join(root, name.slice(2)) : name;
    if (!path.extname(filename)) filename += fs.existsSync(filename + '.tsx') ? '.tsx' : '.ts';
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', code)(id => load(id.startsWith('.') ? path.resolve(path.dirname(filename), id) : id), module, module.exports);
    return module.exports;
  }
  return { load, calls, render: () => renderToStaticMarkup(React.createElement(load('@/components/leads/CounselorLeadsWorkspace').CounselorLeadsWorkspace)) };
}

test('renders the exact 22-tab order and removes the old page chrome', () => {
  const h = harness();
  const tabs = h.load('@/components/leads/counselorLeadTabs').COUNSELOR_LEAD_TABS;
  assert.deepEqual(tabs.map(tab => tab.key), ['received', 'new', 'old', 'worked', 'pending', 'cc', 'responded', 'call_issues', 'common_meeting', 'dim', 'personal_meeting', 'follow_up', 'quotation', 'hot', 'warm', 'special_category', 'call_reminder', 'handover_rm', 'not_attended', 'converted', 'cold', 'process_incomplete']);
  const html = h.render();
  assert.equal((html.match(/role="tab"/g) || []).length, 22);
  assert.match(html, /Search leads/);
  assert.match(html, />Filter/);
  assert.match(html, />Actions/);
  assert.doesNotMatch(html, /Latest Notes|Personal Meetings|Lead journey and work queues|Every count uses/);
  assert.doesNotMatch(html, /<select/); // Filters are not permanently inline.
});

test('all 22 tabs use their own server view and real count', () => {
  const tabs = harness().load('@/components/leads/counselorLeadTabs').COUNSELOR_LEAD_TABS;
  for (const tab of tabs) {
    const h = harness(`workspace_view=${tab.key}`, {data:{summary:{[tab.key]:7},total:0,rows:[]}});
    const html = h.render();
    assert.equal(h.calls[0].view, tab.key);
    assert.match(html, />7<\/span>/);
    assert.doesNotMatch(html, /Unavailable|This view is not available yet/);
  }
});

test('passes URL search, filters, period and pagination to the existing query', () => {
  const h = harness('workspace_view=call_issues&q=Test&source=meta&category=trader&page=2&lead_view=all_time');
  h.render();
  assert.equal(h.calls[0].view, 'call_issues');
  assert.equal(h.calls[0].filters.q, 'Test');
  assert.equal(h.calls[0].filters.source, 'meta');
  assert.equal(h.calls[0].filters.category, 'trader');
  assert.equal(h.calls[0].scope.view, 'all_time');
  assert.equal(h.calls[0].page, 2);
});

test('shows real counts, Call/Open links, details and pagination', () => {
  const h = harness('', { data: { summary: { received: 26 }, total: 26, rows: [{ id: 'fixture-lead', full_name: 'Fixture lead', phone: '1234567890', labels: [], journey_stage: 'new' }] } });
  const html = h.render();
  assert.match(html, /26 Leads Received/);
  assert.match(html, /href="tel:1234567890"/);
  assert.match(html, /href="\/leads\/fixture-lead"/);
  assert.match(html, /More details/);
  assert.match(html, /Lead pagination/);
});

test('does not display previous-view rows as current results while transitioning', () => {
  const html = harness('workspace_view=pending', { isFetching: true, isPlaceholderData: true, data: { total: 1, rows: [{ id: 'old', full_name: 'Wrong queue' }] } }).render();
  assert.doesNotMatch(html, /Wrong queue|href="\/leads\/old"/);
  assert.match(html, /Loading/);
});

test('preserves empty and retry states without claiming errors are empty results', () => {
  assert.match(harness('', { data: { total: 0, rows: [], summary: { received: 0 } } }).render(), /No leads in Leads Received/);
  const html = harness('', { isError: true }).render();
  assert.match(html, /role="alert"/);
  assert.match(html, /Retry/);
  assert.doesNotMatch(html, /No leads in|0 Leads Received/);
});

test('keeps legacy Responses and TTE URLs available without mapping them to new tabs', () => {
  for (const view of ['responses', 'tte']) {
    const h = harness(`workspace_view=${view}`);
    h.render();
    assert.equal(h.calls[1].view, view);
  }
});

test('panel mode exposes existing filters; the default filter layout is retained', () => {
  const h = harness();
  const Filters = h.load('@/components/leads/LeadFilters').LeadFilters;
  const render = panel => renderToStaticMarkup(React.createElement(Filters, { value: {}, onChange() {}, simplifiedAdmin: true, panel }));
  const panel = render(true);
  assert.doesNotMatch(panel, /Search name, phone, email/);
  for (const label of ['Stage', 'Call status', 'Followup', 'Category', 'Source', 'Campaign', 'Label id', 'Remark status', 'Workflow status', 'Latest activity', 'Customer interest']) assert.ok(panel.includes(`aria-label="${label}"`), label);
  assert.match(render(false), /Search name, phone, email/);
});

test('Worked total is N plus O while each lead renders once with both source badges', () => {
  const html = harness('workspace_view=worked', {data:{summary:{worked:2},worked:{n:1,o:1},total:1,rows:[{id:'both',full_name:'Worked fixture',worked_n:true,worked_o:true,queue:'pending',generation:3,history:[]}]}}).render();
  assert.match(html, /Worked: 2 .* 1 leads/);
  assert.equal((html.match(/Worked fixture/g)||[]).length, 1);
  assert.match(html, /title="New worked">N/);
  assert.match(html, /title="Old worked">O/);
  assert.match(html, /Current: Pending/);
});

test('history does not make an expired primary status current', () => {
  const h = harness();
  const {currentWorkflowLabel,JourneySteps} = h.load('@/components/leads/CounselorJourneyTracker');
  assert.equal(currentWorkflowLabel({queue:'pending',primary_status:'communication_completed',journey_active:false}), 'Pending');
  const events = ['workflow_enrolled','remark_saved','entered_old','entered_pending'].map((event_type,index)=>({id:String(index),event_type,primary_status:'communication_completed',new_state:{queue:'new'},occurred_at:'2030-09-26T04:00:00Z'}));
  const html = renderToStaticMarkup(React.createElement(JourneySteps,{events}));
  for (const label of ['New','CC','OL','Pending']) assert.ok(html.includes(`>${label}</span>`));
});

test('reassigned leads expose reading without mutation actions', () => {
  const html = harness('workspace_view=worked', {data:{summary:{worked:1},total:1,rows:[{id:'past',full_name:'Past lead',phone:'123',read_only:true,worked_n:true}]}}).render();
  assert.match(html, /Current: Reassigned/);
  assert.match(html, /href="\/leads\/past"/);
  assert.doesNotMatch(html, /tel:123|Add remark/);
});

test('older disabled backend response does not fabricate zero counts or journey data', () => {
  const html = harness('', {data:{enabled:false,rows:[],total:0}}).render();
  assert.match(html, /workflow is not enabled yet/);
  assert.doesNotMatch(html, /0 Leads Received|No leads in/);
});

test('workspace shows real leads and existing remark entry when timer rollout is off',()=>{
  const html=harness('',{data:{remarks_enabled:false,summary:{received:1},total:1,rows:[{id:'existing',full_name:'Existing assigned lead',read_only:false,history:[]}]}}).render();
  assert.match(html,/Existing assigned lead/);
  assert.match(html,/1 Leads Received/);
  assert.match(html,/href="\/leads\/existing">Add remark<\/a>/);
  assert.doesNotMatch(html,/workflow is not enabled yet/);
});

test('emergency rollback restores both original counselor screens',()=>{
  const source=fs.readFileSync(path.join(root,'app/leads/page.tsx'),'utf8');
  assert.match(source,/<CounselorLifecycleWorkspace leadsPage \/>/);
  assert.doesNotMatch(source,/CounselorLeadsWorkspace/);
  const detail=fs.readFileSync(path.join(root,'app/leads/[id]/page.tsx'),'utf8');
  assert.match(detail,/const counselorEnabled = false/);
  assert.match(detail,/const legacyWorkflowReady = true/);
  assert.ok(detail.includes("useCounselorWorkflowDetail(id,1,Boolean(user && ['member','partner'].includes(user.role)))"));
});

test('remark form requires an explicit primary and offers follow-up preservation', () => {
  const h = harness();
  const html = renderToStaticMarkup(React.createElement(h.load('@/components/leads/CounselorRemarkForm').CounselorRemarkForm,{leadId:'lead'}));
  assert.match(html, /select required/);
  assert.match(html, /value="" selected="">Select one primary status/);
  assert.match(html, /Keep existing schedule/);
  assert.match(html, /Clear schedule/);
  assert.match(html, /disabled="">Save remark/);
});

test('workflow caches and previous results stay within the current counselor', () => {
  const h=harness('',{}, {'@tanstack/react-query':{useQuery:options=>options},'@/lib/api':{apiGet:url=>url}});
  const hooks=h.load(path.join(root,'hooks/useCounselorWorkflow.ts'));
  const config=hooks.useCounselorWorkflowConfig(true);
  assert.deepEqual(config.queryKey,['counselor-workflow','config','counselor']);
  assert.equal(config.queryFn(),'/counselor-workflow/v1/config');
  assert.equal(hooks.useCounselorWorkflowConfig(false).enabled,false);
  const list=hooks.useCounselorWorkflowLeads({view:'worked',scope:{view:'all_time'},filters:{},page:1});
  const data={rows:[{id:'private'}]};
  assert.equal(list.placeholderData(data,{queryKey:['counselor-workflow','list','other']}),undefined);
  assert.equal(list.placeholderData(data,{queryKey:['counselor-workflow','list','counselor']}),data);
  assert.equal(hooks.useCounselorWorkflowDetail('lead').queryKey[2],'counselor');
});

test('CRM Guide restricts page roles, filters codes and renders accurate explanatory sections',()=>{
  const h=harness('',{}, {'@/components/layout/AppShell':{AppShell:()=>null},'@tanstack/react-query':{},'@/lib/api':{}});
  const page=h.load('@/components/leads/CrmGuide');
  assert.deepEqual(page.default().props.roles,['member','partner']);
  const cards=[{status:'communication_completed',code:'CC',label:'Communication Completed',meaning:'Completed communication',category:'Journey',automaticAging:true,first:'1 hours after the remark.',second:'20 more hours after entering Old.',steps:['CC','CC + Old Leads','Pending'],special:null},
    {status:'special_category',code:'SC',label:'Special Category',meaning:'Special lead',category:'Special',automaticAging:false,first:'No automatic Old/Pending timer',second:'No automatic Old/Pending timer',steps:['Special Category'],special:null}];
  assert.equal(page.filterGuide(cards,'cc','All').length,1);
  assert.equal(page.filterGuide(cards,'COMMUNICATION','Journey').length,1);
  assert.equal(page.filterGuide(cards,'cc','Special').length,0);
  assert.equal(page.filterGuide(cards,'missing','All').length,0);
  const html=renderToStaticMarkup(React.createElement(page.WorkflowGuideCard,{card:cards[0]}));
  assert.match(html,/CC \+ Old Leads/);assert.match(html,/20 more hours/);
  assert.match(renderToStaticMarkup(React.createElement(page.WorkflowGuideCard,{card:cards[1]})),/No automatic Old\/Pending timer/);
  const notes=renderToStaticMarkup(React.createElement(page.GuideReferenceNotes));
  for(const phrase of ['Custom Follow-Up Overrides Automatic Timers','Worked = N + O','even after','unless you explicitly clear','outside those queues','history stays visible'])assert.ok(notes.includes(phrase),phrase);
});


test('original Leads layout gains requested boxes, chips and Worked badges without replacing rows',()=>{
  const h=harness('workspace_view=worked',{data:{summary:{received:4,new:1,old:1,worked:2,worked_n:1,worked_o:1,pending:1},total:1,rows:[{id:'both',full_name:'Original row',phone:'123',worked_n:true,worked_o:true,labels:[]}]}});
  const Component=h.load('@/components/dashboard/CounselorLifecycleWorkspace').CounselorLifecycleWorkspace;
  const html=renderToStaticMarkup(React.createElement(Component,{leadsPage:true}));
  for(const label of ['Assigned Leads','New Leads','Old Leads','Worked Leads','Pending','Journey / Last result','Next required action','Original row']) assert.ok(html.includes(label),label);
  for(const key of ['cc','responded','call_issues','common_meeting','dim','personal_meeting','hot','warm','special_category','call_reminder','handover_rm','not_attended','process_incomplete','responses','tte']) assert.ok(html.includes(`workspace-tab-${key}`),key);
  assert.match(html,/Worked while New/);assert.match(html,/Worked while Old/);
  assert.equal(h.calls[0].journey,true);
  assert.equal((html.match(/Original row/g)||[]).length,1);
  assert.match(html,/tel:123/);assert.match(html,/All stages/);
  assert.doesNotMatch(html,/Latest Notes|Personal Meetings|Add remark/);
  const dashboard=renderToStaticMarkup(React.createElement(Component));
  assert.match(dashboard,/Leads Received/);assert.doesNotMatch(dashboard,/Old Leads|workspace-tab-dim/);
});

test('existing remark cards send selected primary for counselors only',async()=>{
  for(const role of ['member','partner','rm']) {
    const calls=[];
    const h=harness('',{}, {'@/lib/auth':{useAuth:()=>({user:{id:'actor',role}})},
      '@tanstack/react-query':{useQueryClient:()=>({}),useMutation:value=>value},
      '@/lib/api':{apiPost:(...args)=>{calls.push(args);return Promise.resolve({});}}});
    const hook=h.load(path.join(root,'hooks/useWorkflow.ts')).useSaveRemark();
    await hook.mutationFn({leadId:'lead',remark_status:'dim',remark_statuses:['dim','cnr']});
    assert.equal(calls[0][0],'/leads/lead/workflow/remark');
    assert.equal(calls[0][1].primary_status,role==='rm'?undefined:'dim');
  }
});


test('existing lead rows show the recorded journey through Pending',()=>{
  const history=['workflow_enrolled','remark_saved','entered_old','entered_pending'].map((event_type,index)=>({id:String(index),event_type,primary_status:'communication_completed',new_state:{queue:index===0?'new':'pending'},occurred_at:'2026-09-25T10:00:00Z'}));
  const h=harness('workspace_view=pending',{data:{summary:{pending:1},total:1,rows:[{id:'journey',full_name:'Tracked lead',workflow_managed:true,workflow_queue:'pending',history,history_total:4}]}});
  const html=renderToStaticMarkup(React.createElement(h.load('@/components/dashboard/CounselorLifecycleWorkspace').CounselorLifecycleWorkspace,{leadsPage:true}));
  for(const label of ['New','CC','OL','Pending'])assert.ok(html.includes(`>${label}</span>`));
  assert.match(html,/Recent journey history/);assert.match(html,/Open/);
});


test('dashboard uses the same journey classification and legacy work stays visible in original rows',()=>{
  const h=harness('workspace_view=worked',{data:{summary:{worked:3,worked_n:1,worked_o:1,worked_legacy:1},total:1,rows:[{id:'previous',full_name:'Previous lead',legacy_worked:true,labels:[]}]}});
  const Component=h.load('@/components/dashboard/CounselorLifecycleWorkspace').CounselorLifecycleWorkspace;
  const html=renderToStaticMarkup(React.createElement(Component,{leadsPage:true}));
  assert.match(html,/Previous 1/);assert.match(html,/Previous work/);assert.match(html,/Previous lead/);
  const dashboard=renderToStaticMarkup(React.createElement(Component));
  assert.equal(h.calls.at(-1).journey,true);
  assert.match(dashboard,/Today&#x27;s work|Today&#39;s work/);
});


test('lead links carry date, tab, page and filters through a safe return URL',()=>{
  for(const tab of ['worked','common_meeting']) {
    const h=harness(`workspace_view=${tab}&lead_view=daily&from=2026-09-25&to=2026-09-25&page=3&q=Example`,{data:{summary:{},total:80,rows:[{id:'lead',full_name:'Example'}]}});
    const Component=h.load('@/components/dashboard/CounselorLifecycleWorkspace').CounselorLifecycleWorkspace;
    const html=renderToStaticMarkup(React.createElement(Component,{leadsPage:true}));
    const href=html.match(/href="(\/leads\/lead\?returnTo=[^"]+)"/)[1];
    const back=new URL(href,'https://example.test').searchParams.get('returnTo');
    const params=new URL(back,'https://example.test').searchParams;
    assert.equal(params.get('workspace_view'),tab);assert.equal(params.get('from'),'2026-09-25');
    assert.equal(params.get('page'),'3');assert.equal(params.get('q'),'Example');assert.equal(h.calls[0].page,3);
    const restored=harness(params.toString(),{data:{rows:[],summary:{}}});
    renderToStaticMarkup(React.createElement(restored.load('@/components/dashboard/CounselorLifecycleWorkspace').CounselorLifecycleWorkspace,{leadsPage:true}));
    assert.equal(restored.calls[0].view,tab);assert.equal(restored.calls[0].scope.from,'2026-09-25');
    const safe=h.load('@/lib/leadReturnPath').leadReturnPath;
    assert.equal(safe(back),back);
    for(const invalid of ['https://evil.test','//evil.test','/leads/123','/leads/../admin','javascript:alert(1)'])assert.equal(safe(invalid),'/leads');
  }
});

test('clean rows show latest primary once and the actual next queue, respecting follow-up overrides',()=>{
  for(const [next,override,label] of [['old',false,'Moves to Old Leads'],['pending',false,'Moves to Pending'],['old',true,'Custom follow-up']]) {
    const h=harness('',{data:{summary:{},rows:[{id:'lead',workflow_managed:true,workflow_primary_status:'communication_completed',last_call_result:'communication_completed',workflow_deadline:'2026-09-28T10:00:00Z',workflow_next_queue:next,followup_override:override,next_followup_at:'2026-10-01T10:00:00Z',history:[]}]}});
    const html=renderToStaticMarkup(React.createElement(h.load('@/components/dashboard/CounselorLifecycleWorkspace').CounselorLifecycleWorkspace,{leadsPage:true}));
    assert.match(html,new RegExp(label));assert.equal((html.match(/<article[\s\S]*?<\/article>/)[0].match(/Communication Completed/g)||[]).length,1);
    assert.doesNotMatch(html,/More details|View history details|Category:|Campaign:|Latest interaction:/);
    if(override)assert.doesNotMatch(html,/Moves to Old Leads|Moves to Pending/);
  }
  const h=harness('',{data:{summary:{},rows:[{id:'legacy',journey_stage:'common_meeting',last_call_result:'communication_completed'}]}});
  const html=renderToStaticMarkup(React.createElement(h.load('@/components/dashboard/CounselorLifecycleWorkspace').CounselorLifecycleWorkspace,{leadsPage:true}));
  assert.equal((html.match(/<article[\s\S]*?<\/article>/)[0].match(/Communication Completed/g)||[]).length,1);
  assert.doesNotMatch(html,/Common Meeting<\/div>/);
});


test('parent URL effect preserves counselor state and waits for auth',()=>{
  const source=fs.readFileSync(path.join(root,'app/leads/page.tsx'),'utf8');
  const body=source.match(/useEffect\(\(\) => \{(\s*if \(!user \|\| isCounselorLeadsView\)[\s\S]*?)\}, \[filters,/)[1];
  const run=new Function('user','isCounselorLeadsView','isSuperAdminLeadsView','filters','router','selectedLeadView','restoringUrl={current:false}','syncedUrl={current:null}',body);
  const calls=[];
  for(const [user,counselor] of [[null,false],[{role:'member'},true],[{role:'partner'},true]])run(user,counselor,false,{}, {replace:url=>calls.push(url)},'daily');
  assert.equal(calls.length,0);
  run({role:'rm'},false,false,{q:'kept'}, {replace:url=>calls.push(url)},'daily');
  assert.deepEqual(calls,['/leads?q=kept']);
});


test('classic workspace distinguishes initial load, tab transition and background refresh',()=>{
  const render=result=>{
    const h=harness('workspace_view=cc',result);
    return renderToStaticMarkup(React.createElement(h.load('@/components/dashboard/CounselorLifecycleWorkspace').CounselorLifecycleWorkspace,{leadsPage:true}));
  };
  const data={summary:{cc:1},total:1,rows:[{id:'current',full_name:'Current lead',phone:'123'}]};
  const initial=render({isLoading:true,isFetching:true});
  assert.match(initial,/Loading Communication Completed/);assert.doesNotMatch(initial,/No leads in/);
  const transition=render({isFetching:true,isPlaceholderData:true,data});
  assert.match(transition,/Loading Communication Completed/);assert.doesNotMatch(transition,/Current lead|No leads in/);
  const background=render({isFetching:true,isPlaceholderData:false,data});
  assert.match(background,/1 Communication Completed/);assert.match(background,/Current lead/);
  assert.doesNotMatch(background,/Loading CC|Updating results|opacity-45|inert=""/);
  assert.match(background,/aria-label="Refreshing leads"/);assert.match(background,/h-4 w-4 animate-spin/);
  const cached=render({isFetching:false,isPlaceholderData:false,data});
  assert.match(cached,/1 Communication Completed/);assert.doesNotMatch(cached,/Loading CC|opacity-45/);
  assert.match(cached,/aria-label="Refresh leads"/);
  const error=render({isError:true,isFetching:false,data});
  assert.match(error,/could not be loaded/);assert.match(error,/Retry/);assert.match(error,/Current lead/);
});

test('workspace cache reuses fresh tabs and still refetches on invalidation',async()=>{
  const {QueryClient}=require('@tanstack/react-query');
  let requests=0;
  const h=harness('',{}, {'@tanstack/react-query':{...require('@tanstack/react-query'),useQuery:options=>options},
    '@/lib/api':{apiGet:async()=>{requests++;return {rows:[],summary:{},total:0};}}});
  const hook=h.load(path.join(root,'hooks/useLifecycle.ts')).useCounselorWorkspaceLeads;
  const args={view:'received',scope:{view:'all_time'},page:1,journey:true};
  const assigned=hook(args),cc=hook({...args,view:'cc'});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  try {
    assert.equal(assigned.refetchInterval,60000);
    await client.fetchQuery(assigned);await client.fetchQuery(cc);await client.fetchQuery(assigned);
    assert.equal(requests,2,'returning to a fresh tab must not refetch');
    await client.invalidateQueries({queryKey:['counselor-workspace']});
    await client.fetchQuery(assigned);assert.equal(requests,3,'remark-save invalidation must still refresh');
    await client.fetchQuery(hook({...args,page:2}));assert.equal(requests,4);
    await client.fetchQuery(hook({...args,filters:{q:'different'}}));assert.equal(requests,5);
  } finally {client.clear();}
});


test('remark remains open and conversion defaults to a closed native disclosure',()=>{
  for(const current_step of [1,2,3,4,5]) {
    const h=harness('',{}, {
      '@/hooks/useWorkflow':{useLeadWorkflow:()=>({data:{current_step,workflow:{},remark_options:['communication_completed'],workflow_step_1_statuses:[],lead_category:'trader'}}),
        useSaveRemark:()=>({}),useSaveConversion:()=>({}),useWorkflowHistory:()=>({data:[]})},
      '@/hooks/useLeads':{useAddRemark:()=>({})},
      '@/components/leads/CallAttemptTracker':{CallAttemptTracker:()=>null}});
    const html=renderToStaticMarkup(React.createElement(h.load('@/components/leads/WorkflowPanel').WorkflowPanel,{leadId:'lead'}));
    assert.match(html,/Step 1: Remark/);assert.match(html,/Communication Completed/);
    const remarkSection=html.match(/<section[^>]*aria-label="Step 1: Remark"/)[0];
    assert.equal((remarkSection.match(/\bborder\b(?!-)/g)||[]).length,1);
    assert.doesNotMatch(remarkSection,/shadow|ring-|border-2/);
    assert.match(html,/Step 2: Conversion/);assert.match(html,/Transaction/);
    const conversionSection=html.match(/<details[^>]*aria-label="Step 2: Conversion"/)[0];
    assert.equal((conversionSection.match(/\bborder\b(?!-)/g)||[]).length,1);
    assert.doesNotMatch(conversionSection,/shadow|ring-|border-2|\sopen(?:[\s=>])/);
    assert.match(html,/<summary[^>]*>/);
    assert.doesNotMatch(html,/Step 2: Lead Category|Step 3|Step 4: Conversion|Follow-up Tracker|Complete Step|Locked|of 4|border-green-300/);
    assert.doesNotMatch(html,/<button[^>]*>[^<]*Step 1/);
  }
});


test('workspace headings cover every tab with short titles and clear descriptions',()=>{
  const tabs=harness().load('@/components/leads/counselorLeadTabs');
  for(const tab of [...tabs.COUNSELOR_LEAD_TABS,...tabs.LEGACY_COUNSELOR_VIEWS]) {
    const heading=tabs.counselorWorkspaceHeading(tab.key);
    assert.ok(heading.title);assert.ok(heading.subtitle);assert.doesNotMatch(heading.subtitle,/Browse, filter/);
  }
  assert.deepEqual(tabs.counselorWorkspaceHeading('cc'),{title:'CC',subtitle:'Communication Completed'});
  assert.deepEqual(tabs.counselorWorkspaceHeading('common_meeting'),{title:'CM',subtitle:'Common Meeting'});
  for(const invalid of ['bad','constructor','__proto__'])assert.equal(tabs.counselorWorkspaceHeading(invalid).title,'Assigned Leads');
});

test('mobile summary fills the sixth slot with the actual CC query and count',()=>{
  const h=harness('workspace_view=cc',{data:{summary:{cc:7},total:7,rows:[]}});
  const html=renderToStaticMarkup(React.createElement(h.load('@/components/dashboard/CounselorLifecycleWorkspace').CounselorLifecycleWorkspace,{leadsPage:true}));
  assert.equal(h.calls[0].view,'cc');
  const tile=html.match(/<button[^>]*title="Communication Completed"[\s\S]*?<\/button>/)[0];
  assert.match(tile,/lg:hidden/);assert.match(tile,/>7<\/div>/);assert.match(tile,/Communication Completed/);
  assert.match(tile,/shadow-\[inset/);
});


test('relocated journey preserves history and empty/loading/unavailable states',()=>{
  const render=result=>{
    const h=harness('',{}, {'@/hooks/useLifecycle':{useLeadLifecycle:()=>result}});
    return renderToStaticMarkup(React.createElement(h.load('@/components/leads/LeadLifecyclePanel').LeadJourneyCard,{leadId:'lead'}));
  };
  assert.match(render({data:{enabled:true,state:{},events:[]}}),/No lifecycle activity recorded yet/);
  const history=render({data:{enabled:true,state:{},events:[{id:'event',event_type:'communication_completed',occurred_at:'2026-09-28T10:00:00Z',user_name:'Counselor'}]}});
  assert.match(history,/Lead Journey/);assert.match(history,/Communication Completed/);assert.match(history,/Counselor/);
  assert.equal(render({isError:true}),'');
  assert.equal(render({data:{enabled:false}}),'');
  assert.match(render({isLoading:true}),/skeleton-shimmer/);
});


test('profile removes embedded communication while preserving chat and remark history',()=>{
  const source=fs.readFileSync(path.join(root,'app/leads/[id]/page.tsx'),'utf8');
  assert.doesNotMatch(source,/LeadCommunicationPanel/);
  assert.match(source,/router.push\(`\/chat\?leadId=\$\{id\}`\)/);
  assert.match(source,/<LeadRemarkTimeline/);
});


test('sidebar remarks distinguish notes and status remarks without General labels',()=>{
 const h=harness(); const Component=h.load('@/components/leads/LeadRemarkTimeline').LeadRemarkTimeline;
 const html=renderToStaticMarkup(React.createElement(Component,{canAdd:false,onAdd(){},remarks:[
 {id:'note',remark:'Customer wants a meeting',note_type:'general',created_at:'2026-09-28T10:00:00Z'},
 {id:'status',remark:'Status: Communication Completed',note_type:'general',call_status:'interested',created_at:'2026-09-28T10:00:00Z'}]}));
 assert.match(html,/bg-amber-50/);assert.match(html,/bg-sky-50/);assert.match(html,/>Note</);assert.match(html,/>Remark</);
 assert.doesNotMatch(html,/>General<|>Interested</);
 const source=fs.readFileSync(path.join(root,'app/leads/[id]/page.tsx'),'utf8');
 assert.doesNotMatch(source,/LeadJourneyCard/);
 assert.ok(source.indexOf('<LeadRemarkTimeline')>source.indexOf('<aside'));
});

test('current remark uses server queue deadlines and respects pending and overrides',()=>{
 const Component=harness().load('@/components/leads/CurrentRemarkStatus').CurrentRemarkStatus;
 const render=(state,extra={})=>renderToStaticMarkup(React.createElement(Component,{enabled:true,latestStatus:'interested',nextFollowup:'2026-10-02T10:00:00Z',query:{data:{enabled:true,managed:true,assignment_current:true,state,...extra},isLoading:false,isError:false,refetch(){}}}));
 assert.match(render({primary_status:'communication_completed',move_to_old_at:'2026-10-01T10:00:00Z'}),/Communication Completed[\s\S]*Moves to Old Leads/);
 assert.match(render({queue:'old',move_to_pending_at:'2026-10-01T10:00:00Z'}),/Moves to Pending/);
 const pending=render({queue:'pending',move_to_old_at:'2026-10-01T10:00:00Z'});
 assert.match(pending,/Pending . add next remark/);assert.doesNotMatch(pending,/Moves to Old Leads/);
 const override=render({followup_override:true,move_to_old_at:'2026-10-01T10:00:00Z'});
 assert.match(override,/Custom follow-up/);assert.doesNotMatch(override,/Moves to Old Leads/);
 assert.doesNotMatch(render({move_to_old_at:'2026-10-01T10:00:00Z'},{assignment_current:false}),/Moves to Old Leads/);
});


test('row journey is bounded and highlights only latest current occurrence',()=>{
 const C=harness().load('@/components/leads/LeadRowProgress');
 const events=Array.from({length:9},(_,i)=>({id:String(i),event_type:'remark_saved',primary_status:i%2?'nracm':'communication_completed',occurred_at:'2026-09-28T10:00:00Z'}));
 const html=renderToStaticMarkup(React.createElement(C.LeadRowJourney,{events,currentStatus:'communication_completed',href:'/leads/one?returnTo=%2Fleads'}));
 assert.equal((html.match(/<li /g)||[]).length,5);assert.equal((html.match(/aria-current="step"/g)||[]).length,1);
 assert.match(html,/bg-emerald-100/);assert.match(html,/View timeline/);assert.match(html,/href="\/leads\/one\?returnTo=%2Fleads"/);
 const pending=renderToStaticMarkup(React.createElement(C.LeadRowJourney,{events,currentStatus:null,href:'/leads/one'}));
 assert.doesNotMatch(pending,/aria-current/);
});

test('countdown includes seconds and handles expiry and invalid deadlines',()=>{
 const {countdownText}=harness().load('@/components/leads/LeadRowProgress');const now=Date.parse('2026-09-28T10:00:00Z');
 assert.equal(countdownText('2026-09-28T10:45:09Z',now),'45m 09s remaining');
 assert.equal(countdownText('2026-09-28T10:00:00Z',now),'Due now \u2014 awaiting update');
 assert.equal(countdownText('bad',now),'Deadline unavailable');
});


test('manager reports render workflow tabs, distinct total and labelled scoped drill-down links', () => {
  const h=harness('view=daily&from=2026-09-25&to=2026-09-25&source=meta',{}, {
    'next/navigation': {useSearchParams:()=>new URLSearchParams('view=daily&from=2026-09-25&to=2026-09-25&source=meta'),useParams:()=>({rmId:'rm-id',counselorId:'counselor-id'})}
  });
  const {DistributionSummaryGrid}=h.load('@/components/leads/LeadDistributionUi');
  const html=renderToStaticMarkup(React.createElement(DistributionSummaryGrid,{summary:{received:7,worked:1,worked_n:1,worked_o:1},activeMetric:'worked',onMetricChange(){}}));
  for(const text of ['Assigned Leads','New Leads','Old Leads','Worked Leads','Pending','Communication Completed','Discussed in Meeting','Process Incomplete'])assert.ok(html.includes(text));
  assert.match(html,/aria-label="Open Assigned Leads"/);
  assert.match(html,/workflow_view=cc/);assert.match(html,/counselor_id=counselor-id/);assert.match(html,/rm_id=rm-id/);
  assert.match(html,/source=meta/);assert.match(html,/from=2026-09-25/);assert.match(html,/work_source=old/);
  assert.match(html,/overflow-x-auto/);
});
test('manager link builder preserves filters and aliases while clearing stale pagination',()=>{
  const {managerLeadHref}=harness().load('@/lib/managerWorkflow');
  const href=managerLeadHref(new URLSearchParams('view=daily&from=2026-09-25&to=2026-09-26&q=Smith&page=7&call_issue_type=cnr'),'session_9pm','rm','counselor');
  const params=new URL(href,'https://example.test').searchParams;
  assert.equal(params.get('workflow_view'),'common_meeting');assert.equal(params.get('lead_view'),'daily');
  assert.equal(params.get('q'),'Smith');assert.equal(params.get('page'),null);assert.equal(params.get('call_issue_type'),null);
});
test('distribution return URLs are internal and preserve the profile scope',()=>{
  const safe=harness().load('@/lib/leadReturnPath').leadReturnPath;
  const path='/leads/distribution/rm/11111111-1111-1111-1111-111111111111/counselor/22222222-2222-2222-2222-222222222222?metric=cc&view=all_time';
  assert.equal(safe(path),path);assert.equal(safe('//evil.test/leads'),'/leads');assert.equal(safe('/leads/distribution/../../admin'),'/leads');
});
