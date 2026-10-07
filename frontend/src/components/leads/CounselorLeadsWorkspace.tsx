'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Modal, Skeleton } from '@/components/ui/Modal';
import { CounselorLeadsToolbar } from './CounselorLeadsToolbar';
import { COUNSELOR_LEAD_TABS, counselorLeadTab } from './counselorLeadTabs';
import { useCounselorWorkflowLeads, COUNSELOR_FILTER_KEYS } from '@/hooks/useCounselorWorkflow';
import { useCounselorWorkspaceLeads } from '@/hooks/useLifecycle';
import { CounselorJourneyTracker, currentWorkflowLabel } from './CounselorJourneyTracker';
import { CounselorRemarkForm } from './CounselorRemarkForm';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { fmtDate, humanize } from '@/lib/format';
import { analyticsScopeParams, normalizeAnalyticsScope, formatAnalyticsPeriod } from '@/lib/leadAnalytics';
import type { LeadAnalyticsScope, LeadFilters } from '@/types';

function LegacyView({view,scope,filters,page,onPage}:{view:'responses'|'tte';scope:LeadAnalyticsScope;filters:LeadFilters;page:number;onPage:(page:number)=>void}) {
  const query = useCounselorWorkspaceLeads({view,scope,filters,page});
  if (query.isError) return <p role="alert">Legacy leads could not be loaded. <button className="underline" onClick={()=>query.refetch()}>Retry</button></p>;
  if (!query.data||query.isPlaceholderData) return <p role="status">Loading legacy view…</p>;
  return <div className="space-y-3"><h2 className="font-semibold">Legacy {humanize(view)} · {query.data.total}</h2>
    {!query.data.rows.length && <p>No leads in this legacy view.</p>}
    {query.data.rows.map(lead=><article key={lead.id} className="card break-words p-3"><Link href={`/leads/${lead.id}`} className="font-semibold text-brand-700">{lead.full_name||'Unnamed lead'}</Link><p className="text-xs">{lead.phone} · {humanize(lead.journey_stage)}</p></article>)}
    <Pagination page={page} total={query.data.total} busy={query.isFetching} onPage={onPage}/>
  </div>;
}
function Pagination({page,total,busy,onPage}:{page:number;total:number;busy:boolean;onPage:(page:number)=>void}) {
  if (total<=25&&page===1) return null;
  return <nav aria-label="Lead pagination" className="flex flex-wrap items-center justify-end gap-2"><span className="text-xs">Page {page} of {Math.max(1,Math.ceil(total/25))}</span><button className="btn-secondary" disabled={page<=1||busy} onClick={()=>onPage(page-1)}>Previous</button><button className="btn-secondary" disabled={page*25>=total||busy} onClick={()=>onPage(page+1)}>Next</button></nav>;
}
export function CounselorLeadsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scope = normalizeAnalyticsScope(searchParams.get('lead_view')==='all_time'?'all_time':'daily',searchParams.get('from')||searchParams.get('selected_date'),searchParams.get('to')||searchParams.get('selected_date'));
  const activeTab = counselorLeadTab(searchParams.get('workspace_view'));
  const legacy = activeTab.key==='responses'||activeTab.key==='tte';
  const page = Math.max(1,Math.min(100000,Number.parseInt(searchParams.get('page')||'1',10)||1));
  const filters = Object.fromEntries(COUNSELOR_FILTER_KEYS.map(key=>[key,searchParams.get(key)||''])) as LeadFilters;
  const [search,setSearch] = useState(filters.q||'');
  const [remarkLead,setRemarkLead] = useState<string|null>(null);
  const debouncedSearch = useDebouncedValue(search,300);
  const tabRefs = useRef<Array<HTMLButtonElement|null>>([]);
  const tabStrip = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const scrolledView = useRef<string|null>(null);
  const currentParams = useRef(searchParams);
  currentParams.current = searchParams;
  const leads = useCounselorWorkflowLeads({view:legacy?'received':activeTab.key,scope,filters,page:legacy?1:page});
  const data = !leads.isPlaceholderData ? leads.data : undefined;
  const rows = data?.enabled ? data.rows : [];
  const activeIndex = COUNSELOR_LEAD_TABS.findIndex(tab=>tab.key===activeTab.key);
  const navigate = (params:URLSearchParams)=>router.replace(`/leads?${params}`,{scroll:false});
  function scrollToResults() {
    window.requestAnimationFrame(()=>resultsRef.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}));
  }
  function selectView(key:string) { const params=new URLSearchParams(currentParams.current.toString());params.set('workspace_view',key);params.delete('page');navigate(params);scrollToResults(); }
  function changePage(next:number) { const params=new URLSearchParams(currentParams.current.toString());params.set('page',String(next));navigate(params); }
  function changeFilters(next:LeadFilters) {
    setSearch(next.q||''); const params=new URLSearchParams(currentParams.current.toString());
    COUNSELOR_FILTER_KEYS.forEach(key=>{const value=next[key];if(value)params.set(key,String(value));else params.delete(key);});
    params.delete('page');navigate(params);
  }
  useEffect(()=>{setSearch(filters.q||'');},[filters.q]);
  useEffect(()=>{
    const selectedView=searchParams.get('workspace_view');
    if(!selectedView||selectedView!==activeTab.key||!data||scrolledView.current===selectedView)return;
    scrolledView.current=selectedView;
    const frame=window.requestAnimationFrame(()=>resultsRef.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}));
    return ()=>window.cancelAnimationFrame(frame);
  },[activeTab.key,data,searchParams]);
  useEffect(()=>{
    if(debouncedSearch===(currentParams.current.get('q')||''))return;
    const params=new URLSearchParams(currentParams.current.toString());if(debouncedSearch)params.set('q',debouncedSearch);else params.delete('q');params.delete('page');router.replace(`/leads?${params}`,{scroll:false});
  },[debouncedSearch,router]);
  useEffect(()=>{
    const button=tabRefs.current[activeIndex];const strip=tabStrip.current;if(!button||!strip)return;
    const b=button.getBoundingClientRect();const s=strip.getBoundingClientRect();
    if(b.left<s.left)strip.scrollLeft-=s.left-b.left;else if(b.right>s.right)strip.scrollLeft+=b.right-s.right;
  },[activeIndex]);
  function tabKey(event:KeyboardEvent<HTMLButtonElement>,index:number) {
    const count=COUNSELOR_LEAD_TABS.length;
    const next=event.key==='ArrowRight'?(index+1)%count:event.key==='ArrowLeft'?(index-1+count)%count:event.key==='Home'?0:event.key==='End'?count-1:null;
    if(next===null)return;event.preventDefault();tabRefs.current[next]?.focus({preventScroll:true});selectView(COUNSELOR_LEAD_TABS[next].key);
  }
  return <section aria-label="Counselor leads" className="min-w-0 max-w-full space-y-3">
    <CounselorLeadsToolbar filters={{...filters,q:search}} onFilters={changeFilters} onSearch={setSearch} scope={scope} rows={rows} statuses={data?.status_options||[]} onView={selectView} onScope={next=>{
      const params=new URLSearchParams(currentParams.current.toString());['from','to','selected_date','page'].forEach(key=>params.delete(key));analyticsScopeParams(next).forEach((value,key)=>{if(key!=='view')params.set(key,value);});params.set('lead_view',next.view);navigate(params);
    }}/>
    <p className="text-xs text-slate-500">{formatAnalyticsPeriod(scope)} · Worked uses work date; other tabs use assignment date.</p>
    <div ref={tabStrip} role="tablist" aria-label="Lead views" className="scroll-thin flex w-full min-w-0 max-w-full gap-1.5 overflow-x-auto overscroll-x-contain pb-2">
      {COUNSELOR_LEAD_TABS.map((tab,index)=><button key={tab.key} ref={node=>{tabRefs.current[index]=node;}} id={`counselor-tab-${tab.key}`} type="button" role="tab" aria-selected={tab.key===activeTab.key} aria-controls="counselor-results" tabIndex={index===activeIndex||(activeIndex<0&&index===0)?0:-1} onClick={()=>selectView(tab.key)} onKeyDown={event=>tabKey(event,index)} className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold ${tab.key===activeTab.key?'border-brand-600 bg-brand-600 text-white':'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
        <span>{tab.label}{tab.key==='worked'&&data?.enabled&&<span className="block text-[10px] font-normal" title="N = New worked; O = Old worked">N {data.worked.n} · O {data.worked.o}</span>}</span><span className="rounded-md bg-black/5 px-1.5 py-0.5 tabular-nums">{data?.enabled?data.summary[tab.key]??'—':'—'}</span>
      </button>)}
    </div>
    <div id="counselor-results" ref={resultsRef} role="tabpanel" aria-labelledby={activeIndex>=0?`counselor-tab-${activeTab.key}`:undefined} aria-label={activeIndex<0?activeTab.label:undefined} aria-busy={leads.isFetching} className="min-w-0 scroll-mt-36 space-y-3">
      {leads.isError&&<div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm">Leads could not be loaded. <button className="min-h-10 underline" onClick={()=>leads.refetch()}>Retry</button></div>}
      {!data&&leads.isFetching&&<div role="status" className="space-y-2"><span className="text-xs">Loading…</span>{[1,2,3].map(key=><Skeleton key={key} className="h-36"/>)}</div>}
      {data&&!data.enabled&&<p role="status" className="card p-4 text-sm">The counselor workflow is not enabled yet. No workflow counts are available.</p>}
      {legacy?<LegacyView view={activeTab.key as 'responses'|'tte'} scope={scope} filters={filters} page={page} onPage={changePage}/>:data?.enabled&&<>
        <h2 className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-bold text-slate-950 shadow-sm">{activeTab.key==='worked'?`Worked: ${data.summary.worked} · ${data.total} leads`:`${data.total.toLocaleString()} ${activeTab.label}`}</h2>
        {activeTab.key==='worked'&&<p className="text-xs text-slate-600">N {data.worked.n} · O {data.worked.o} — New worked + Old worked. A lead can count once in each bucket.</p>}
        {!rows.length?<p className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">No leads in {activeTab.label}.</p>:<div className="min-w-0 space-y-3">{rows.map(lead=><article key={lead.id} className="min-w-0 break-words rounded-xl border border-slate-200 bg-white p-3 [overflow-wrap:anywhere]">
          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="min-w-0"><h3 className="font-semibold">{lead.full_name||'Unnamed lead'}</h3><p className="text-xs text-slate-500">{lead.phone||'No phone'} · {humanize(lead.source||'manual')}</p>{activeTab.key==='worked'&&<p className="mt-1 text-xs">Worked from: {lead.worked_n&&<span className="mr-1 rounded bg-blue-50 px-2 py-1" title="New worked">N</span>}{lead.worked_o&&<span className="rounded bg-amber-50 px-2 py-1" title="Old worked">O</span>}</p>}</div>
            <div className="text-xs"><p className="font-semibold">Current: {lead.read_only?'Reassigned':lead.generation?currentWorkflowLabel(lead):'Legacy / not enrolled'}</p>{lead.next_followup_at?<p>Follow-up: {fmtDate(lead.next_followup_at,'d MMM, h:mm a')}</p>:(lead.move_to_old_at||lead.move_to_pending_at)&&<p>Next transition: {fmtDate(lead.move_to_old_at||lead.move_to_pending_at,'d MMM, h:mm a')}</p>}{lead.followup_override&&<p>Custom follow-up active</p>}</div>
            <div className="flex flex-wrap items-start gap-2">{!lead.read_only&&lead.phone&&<a href={`tel:${lead.phone}`} className="btn-secondary">Call</a>}<Link className="btn-secondary" href={`/leads/${lead.id}`}>Open</Link>{!lead.read_only&&(data.remarks_enabled===false?<Link className="btn-primary" href={`/leads/${lead.id}`}>Add remark</Link>:<button className="btn-primary" onClick={()=>setRemarkLead(lead.id)}>Add remark</button>)}</div>
          </div>
          <div className="mt-3 border-t border-slate-100 pt-2"><CounselorJourneyTracker leadId={lead.id} events={lead.history||[]} total={lead.history_total||0}/></div>
          <details className="mt-1 text-xs text-slate-500"><summary className="min-h-9 cursor-pointer py-2">More details</summary><p>Category: {humanize(lead.category||'unknown')} · Campaign: {lead.campaign_name||lead.campaign_label||'—'}</p></details>
        </article>)}</div>}
        <Pagination page={page} total={data.total} busy={leads.isFetching} onPage={changePage}/>
      </>}
    </div>
    <Modal open={Boolean(remarkLead)} onClose={()=>setRemarkLead(null)} title="Add counselor remark">{remarkLead&&<CounselorRemarkForm key={remarkLead} leadId={remarkLead} onSaved={()=>setRemarkLead(null)}/>}</Modal>
  </section>;
}
