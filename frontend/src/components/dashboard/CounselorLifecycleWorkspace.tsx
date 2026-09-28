'use client';

import Link from 'next/link';
import { useDeferredValue, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Clock3, Loader2, Phone, RefreshCw, Search } from 'lucide-react';
import { JourneySteps } from '@/components/leads/CounselorJourneyTracker';
import { Skeleton } from '@/components/ui/Modal';
import { LeadAnalyticsPeriodControl } from '@/components/leads/LeadAnalyticsPeriodControl';
import { LeadFilters } from '@/components/leads/LeadFilters';
import { useCounselorWorkspaceLeads, type WorkspaceSummary, type WorkspaceView } from '@/hooks/useLifecycle';
import { fmtDate, fmtRelative, humanize } from '@/lib/format';
import { analyticsScopeParams, DISTRIBUTION_FILTER_KEYS, normalizeAnalyticsScope } from '@/lib/leadAnalytics';
import type { LeadFilters as LeadFilterState } from '@/types';

const METRICS: Array<{ key: keyof WorkspaceSummary; label: string; hint: string }> = [
  { key: 'received', label: 'Leads Received', hint: 'Leads received during the selected period.' },
  { key: 'new', label: 'New Leads', hint: 'Received leads with no qualifying work since assignment.' },
  { key: 'worked', label: 'Worked', hint: 'Received leads with qualifying work since assignment.' },
  { key: 'pending', label: 'Pending', hint: 'Received leads whose required action is currently overdue.' },
  { key: 'common_meeting', label: 'Common Meeting', hint: 'Received leads currently in the Common Meeting journey.' },
  { key: 'personal_meeting', label: 'Personal Meeting', hint: 'Received leads currently in the Personal Meeting journey.' },
];

const ANALYTICS_VIEWS: Array<[WorkspaceView, string]> = [
  ['call_issues', 'Call Issues'], ['responses', 'Responses'], ['tte', 'TTE'], ['quotation', 'Quotation'],
  ['follow_up', 'Follow-up'], ['converted', 'Converted'], ['cold', 'Cold'],
];

const LEADS_METRICS: typeof METRICS = [
  {key:'received',label:'Assigned Leads',hint:'Leads assigned during the selected period.'},
  {key:'new',label:'New Leads',hint:'Untouched leads in the New queue.'},
  {key:'old',label:'Old Leads',hint:'Leads aged into Old; the remark tab can overlap.'},
  {key:'worked',label:'Worked Leads',hint:'Recorded N/O work plus previous work carried forward without guessed attribution.'},
  {key:'pending',label:'Pending',hint:'Leads whose workflow has moved to Pending.'},
  {key:'cc',label:'CC',hint:'Communication Completed'},
];
const LEADS_VIEWS: typeof ANALYTICS_VIEWS = [
  ['cc','CC'],['responded','R'],['call_issues','CI'],['common_meeting','CM'],['dim','DIM'],['personal_meeting','PM'],
  ['follow_up','Follow-up'],['quotation','Quotation'],['hot','Hot'],['warm','Warm'],
  ['special_category','SC'],['call_reminder','CR'],['handover_rm','RM'],['not_attended','NT'],
  ['converted','Converted'],['cold','Cold'],['process_incomplete','PI'],['responses','Responses'],['tte','TTE'],
];
const SELECTABLE_VIEWS = new Set<WorkspaceView>([
  ...METRICS.map(metric => metric.key as WorkspaceView),
  ...ANALYTICS_VIEWS.map(([key]) => key),
]);

function istDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function nextActionLabel(actionType?: string | null, reason?: string | null, hasCallIssue?: boolean) {
  if (!actionType) return hasCallIssue ? 'Call retry' : 'No next action';
  if (['common_meeting', 'common_meeting_outcome'].includes(actionType)) return 'Update Common Meeting outcome';
  if (actionType === 'lifecycle_review' && reason?.startsWith('lead_category_')) {
    return `Follow up ${humanize(reason.replace('lead_category_', ''))}`;
  }
  if (actionType === 'lifecycle_review') return 'Select next action';
  return humanize(actionType);
}

export function CounselorLifecycleWorkspace({ leadsPage = false }: { leadsPage?: boolean }) {
  const metrics = leadsPage ? LEADS_METRICS : METRICS;
  const analyticsViews = leadsPage ? LEADS_VIEWS : ANALYTICS_VIEWS;
  const selectable = leadsPage ? new Set([...LEADS_METRICS.map(metric=>metric.key),...LEADS_VIEWS.map(([key])=>key)]) : SELECTABLE_VIEWS;
  const today = istDate();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get('workspace_view') as WorkspaceView | null;
  const initialView = requestedView && selectable.has(requestedView) ? requestedView : 'received';
  const [scope, setScope] = useState(() => (leadsPage || searchParams.has('lead_view'))
    ? normalizeAnalyticsScope(searchParams.get('lead_view') === 'all_time' ? 'all_time' : 'daily', searchParams.get('from') || searchParams.get('selected_date'), searchParams.get('to') || searchParams.get('selected_date'))
    : { view: 'daily' as const, from: today, to: today });
  const [view, setView] = useState<WorkspaceView>(initialView);
  const [page, setPage] = useState(() => Math.max(1, Math.min(100000, Math.trunc(Number(searchParams.get('page')) || 1))));
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [dashboardSearch, setDashboardSearch] = useState(searchParams.get('q') || '');
  const [filters, setFilters] = useState<LeadFilterState>(() => ({
    q: searchParams.get('q') || '', category: (searchParams.get('category') as LeadFilterState['category']) || '',
    stage: (searchParams.get('stage') as LeadFilterState['stage']) || '', call_status: (searchParams.get('call_status') as LeadFilterState['call_status']) || '',
    followup: (searchParams.get('followup') as LeadFilterState['followup']) || '', source: searchParams.get('source') || '',
    campaign: searchParams.get('campaign') || '', label_id: searchParams.get('label_id') || '',
    remark_status: (searchParams.get('remark_status') as LeadFilterState['remark_status']) || '',
    workflow_status: (searchParams.get('workflow_status') as LeadFilterState['workflow_status']) || '',
    latest_activity: (searchParams.get('latest_activity') as LeadFilterState['latest_activity']) || '',
    customer_interest: (searchParams.get('customer_interest') as LeadFilterState['customer_interest']) || '',
  }));
  const deferredFilters = useDeferredValue(leadsPage ? filters : { ...filters, q: dashboardSearch });
  const leads = useCounselorWorkspaceLeads({ view, scope, filters: deferredFilters, page, journey:true });
  const activeViewIndex = analyticsViews.findIndex(([key]) => key === view);
  const activeViewLabel = analyticsViews.find(([key]) => key === view)?.[1]
    || metrics.find(metric => metric.key === view)?.label
    || humanize(view);
  useEffect(()=>{
    const tab=tabRefs.current[activeViewIndex];
    const strip=tab?.parentElement;
    if(tab&&strip){
      const left=tab.offsetLeft-strip.offsetLeft;
      if(left<strip.scrollLeft)strip.scrollLeft=left;
      else if(left+tab.offsetWidth>strip.scrollLeft+strip.clientWidth)strip.scrollLeft=left+tab.offsetWidth-strip.clientWidth;
    }
  },[activeViewIndex]);
  const isInitialLoading = leads.isLoading && !leads.data;
  // Previous-query rows are not results for the newly selected tab/filter.
  // Same-query polling can keep the current rows and actions fully usable.
  const isTransitioning = Boolean(leads.isPlaceholderData);

  const returnParams = analyticsScopeParams(scope);
  returnParams.delete('view');
  returnParams.set('lead_view', scope.view);
  returnParams.set('workspace_view', view);
  returnParams.set('page', String(page));
  DISTRIBUTION_FILTER_KEYS.forEach(key => {
    const value = (leadsPage ? filters : {...filters, q: dashboardSearch})[key as keyof LeadFilterState];
    if (value !== undefined && value !== null && value !== '') returnParams.set(key, String(value));
  });
  const returnTo = `${leadsPage ? '/leads' : '/dashboard/member'}?${returnParams.toString()}`;
  useEffect(() => {
    router.replace(returnTo, { scroll: false });
  }, [returnTo, router]);

  function selectView(next: WorkspaceView) {
    if (next === view) return;
    setView(next);
    setPage(1);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % analyticsViews.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + analyticsViews.length) % analyticsViews.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = analyticsViews.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    tabRefs.current[nextIndex]?.focus();
  }

  function selectScope(next: typeof scope) {
    setScope(next);
    setPage(1);
  }

  return (
    <section className="min-w-0 max-w-full overflow-visible rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-amber-50 shadow-sm">
      <div className={`flex flex-col gap-4 border-b border-sky-100 lg:flex-row lg:items-center lg:justify-between ${leadsPage ? 'px-3 py-3 sm:px-4' : 'px-5 py-4'}`}>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">{leadsPage ? 'Lead Analytics' : 'Counselor Workspace'}</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">{leadsPage ? 'Lead journey and work queues' : "Today's work, one clear queue"}</h2>
          <p className="text-xs text-slate-500">{leadsPage ? 'Assigned and queue tabs use assignment date; Worked uses work date. Old and remark tabs can overlap.' : 'Assigned and queue tabs use assignment date; N/O uses work date. Previous work is retained.'}</p>
        </div>
        <LeadAnalyticsPeriodControl scope={scope} onChange={selectScope} />
      </div>

      <div className={`grid grid-cols-2 gap-px bg-slate-200/70 ${leadsPage ? 'lg:grid-cols-5' : 'lg:grid-cols-6'}`}>
        {metrics.map(metric => (
          <button key={metric.key} type="button" title={metric.hint} onClick={() => selectView(metric.key as WorkspaceView)} className={`${leadsPage && metric.key === 'cc' ? 'lg:hidden ' : ''}min-h-24 bg-white px-4 py-3 text-left transition hover:bg-sky-50 ${view === metric.key ? 'shadow-[inset_0_-3px_0_#0284c7]' : ''}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{metric.label}</div>
            {leads.isLoading && !leads.data ? <Skeleton className="mt-3 h-7 w-14" /> : <div className="mt-2 text-2xl font-bold tabular-nums text-slate-950">{Number(leads.data?.summary?.[metric.key] || 0).toLocaleString()}</div>}
            <div className="mt-1 line-clamp-1 text-[10px] text-slate-400">{leadsPage&&metric.key==='worked'?`N ${leads.data?.summary?.worked_n ?? 0} / O ${leads.data?.summary?.worked_o ?? 0} / Previous ${leads.data?.summary?.worked_legacy ?? 0}`:leadsPage&&metric.key==='cc'?'Communication Completed':'Selected period'}</div>
          </button>
        ))}
      </div>

      <div className={`bg-white/75 ${leadsPage ? 'space-y-3 p-3 sm:p-4' : 'space-y-4 p-4 sm:p-5'}`}>
        <div className="scroll-thin flex min-w-0 max-w-full gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Lead analytics views">
          {analyticsViews.map(([key, label], index) => {
            const active = view === key;
            return <button ref={node => { tabRefs.current[index] = node; }} id={`workspace-tab-${key}`} key={key} type="button" role="tab" aria-selected={active} aria-controls="workspace-results" tabIndex={active || (activeViewIndex < 0 && index === 0) ? 0 : -1} onKeyDown={event => handleTabKeyDown(event, index)} onClick={() => selectView(key)} className={`${active ? 'chip-blue' : 'chip-slate'} min-h-10 shrink-0`}>{active && isTransitioning && <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />}{label} <span className="ml-1 tabular-nums">{leads.data?.summary?.[key] ?? 0}</span></button>;
          })}
        </div>
        {leadsPage ? <LeadFilters value={filters} onChange={next => { setFilters(next); setPage(1); }} simplifiedAdmin /> : <label className="relative block max-w-md"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className="input pl-9" value={dashboardSearch} onChange={event => { setDashboardSearch(event.target.value); setPage(1); }} placeholder="Search this queue..." /></label>}

        <div id="workspace-results" role="tabpanel" aria-labelledby={activeViewIndex >= 0 ? `workspace-tab-${view}` : undefined} aria-label={activeViewIndex < 0 ? `${activeViewLabel} results` : undefined} aria-busy={isInitialLoading || isTransitioning} className="space-y-3 outline-none">
          <div className="flex min-h-6 items-center justify-between gap-3" role="status" aria-live="polite">
            <p className="text-sm font-semibold text-slate-800">{isInitialLoading || isTransitioning ? `Loading ${activeViewLabel}...` : `${Number(leads.data?.total || 0).toLocaleString()} ${activeViewLabel}`}</p>
            <button type="button" onClick={() => { void leads.refetch(); }} disabled={leads.isFetching} aria-label={leads.isFetching ? 'Refreshing leads' : 'Refresh leads'} title={leads.isFetching ? 'Refreshing leads' : 'Refresh leads'} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-wait">
              <RefreshCw className={`h-4 w-4 ${leads.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
            </button>
          </div>
          {leads.isError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-4 text-center text-sm text-rose-800"><div>Leads in this view could not be loaded. Previous results have been kept where available.</div><button type="button" onClick={() => leads.refetch()} className="mt-2 font-semibold underline underline-offset-2">Retry</button></div>}
          {isInitialLoading || isTransitioning ? <div className="space-y-2">{[1, 2, 3].map(key => <Skeleton key={key} className="h-16" />)}</div> : !leads.data && leads.isError ? null : !leads.data?.rows.length ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">No leads in {activeViewLabel}.</div>
          ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {leads.data.rows.map(lead => {
              const managed=lead.workflow_managed;
              const due=managed?(lead.followup_override?lead.next_followup_at:lead.workflow_deadline):(lead.next_retry_at || lead.current_action_due_at || lead.next_followup_at);
              return (
              <article key={lead.id} className="px-4 py-3 transition hover:bg-slate-50/80">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_0.8fr_1fr_auto] lg:items-center">
                  <div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-900">{lead.full_name || 'Unnamed lead'}</div><div className="mt-0.5 text-xs text-slate-500">{lead.phone || 'No phone'} / {humanize(lead.source || 'manual')}</div><div className="mt-1 flex flex-wrap gap-1">{leadsPage&&view==='worked'&&<>{lead.legacy_worked&&!lead.worked_n&&!lead.worked_o&&<span className="chip-slate">Previous work</span>}{lead.worked_n&&<span className="chip-blue" title="Worked while New">N</span>}{lead.worked_o&&<span className="chip-slate" title="Worked while Old or Pending">O</span>}</>}{lead.labels?.slice(0, 3).map(label => <span key={label.id} className="rounded-full border px-1.5 py-0.5 text-[9px] font-semibold" style={{ borderColor: label.color || '#cbd5e1', color: label.color || '#475569' }}>{label.name}</span>)}</div></div>
                  <div className="text-xs text-slate-600"><div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Journey / Last result</div><div className="mt-1 font-semibold text-slate-800">{humanize((managed && lead.workflow_primary_status) || lead.last_call_result || lead.terminal_state || lead.journey_stage)}</div></div>
                  <div className="text-xs text-slate-600"><div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Next required action</div><div className="mt-1 font-semibold text-slate-800">{managed?(lead.followup_override?'Custom follow-up':lead.workflow_queue==='pending'?'Add next remark':due?(lead.workflow_next_queue==='old'?'Moves to Old Leads':lead.workflow_next_queue==='pending'?'Moves to Pending':'Workflow deadline'):'Add next remark'):nextActionLabel(lead.current_action_type, lead.current_action_reason, lead.has_call_issue)}</div>{due && <div className={`mt-0.5 flex items-center gap-1 ${(managed?lead.workflow_queue==='pending':lead.is_pending) ? 'font-semibold text-rose-600' : ''}`}><Clock3 className="h-3 w-3" />{fmtDate(due, 'd MMM, h:mm a')} | {fmtRelative(due)}</div>}{(managed?lead.workflow_queue==='pending':lead.is_pending) && <span className="mt-1 inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">{managed?'Pending':`Pending cycle ${lead.pending_occurrences || 1}`}</span>}</div>
                  <div className="flex items-center gap-2 lg:justify-end">{!lead.read_only && lead.phone && <a href={`tel:${lead.phone}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-emerald-200 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"><Phone className="h-3.5 w-3.5" />Call</a>}<Link href={`/leads/${lead.id}?returnTo=${encodeURIComponent(returnTo)}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-brand-200 px-3 text-xs font-semibold text-brand-700 hover:bg-brand-50">Open<ArrowRight className="h-3.5 w-3.5" /></Link></div>
                </div>
                {leadsPage&&Boolean(lead.history?.length)&&<div className="mt-2"><JourneySteps events={lead.history||[]}/></div>}

              </article>
            );})}
          </div>
          )}
          {(leads.data?.total || 0) > 25 && <div className="flex items-center justify-end gap-2"><span className="text-xs text-slate-500">Page {page} of {Math.ceil((leads.data?.total || 0) / 25)}</span><button className="btn-secondary" disabled={page <= 1 || isTransitioning} onClick={() => setPage(value => value - 1)}>Previous</button><button className="btn-secondary" disabled={isTransitioning || page * 25 >= (leads.data?.total || 0)} onClick={() => setPage(value => value + 1)}>Next</button></div>}
        </div>
      </div>
    </section>
  );
}
