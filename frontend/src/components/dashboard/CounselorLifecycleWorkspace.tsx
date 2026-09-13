'use client';

import Link from 'next/link';
import { useDeferredValue, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Clock3, Phone, Search } from 'lucide-react';
import { Skeleton } from '@/components/ui/Modal';
import { LeadAnalyticsPeriodControl } from '@/components/leads/LeadAnalyticsPeriodControl';
import { LeadFilters } from '@/components/leads/LeadFilters';
import { useCounselorWorkspaceLeads, type WorkspaceSummary, type WorkspaceView } from '@/hooks/useLifecycle';
import { fmtDate, fmtRelative, humanize } from '@/lib/format';
import { analyticsScopeParams, DISTRIBUTION_FILTER_KEYS, normalizeAnalyticsScope } from '@/lib/leadAnalytics';
import type { LeadFilters as LeadFilterState } from '@/types';

const METRICS: Array<{ key: keyof WorkspaceSummary; label: string; hint: string }> = [
  { key: 'received', label: 'Leads Received', hint: 'Currently assigned active leads (live now).' },
  { key: 'new', label: 'New Leads', hint: 'Newly assigned in the selected period.' },
  { key: 'worked', label: 'Worked', hint: 'Unique leads with qualifying human activity in the selected period.' },
  { key: 'pending', label: 'Pending', hint: 'Active leads with an overdue required action (live now).' },
  { key: 'unworked', label: 'Unworked', hint: 'Assigned leads with no qualifying activity (live now).' },
  { key: 'reassigned', label: 'Reassigned To Me', hint: 'Received from another counselor in the selected period.' },
];

const ANALYTICS_VIEWS: Array<[WorkspaceView, string]> = [
  ['worked', 'Worked'], ['call_issues', 'Call Issues'], ['pending', 'Pending'],
  ['responses', 'Responses'], ['common_meeting', 'Common Meeting'], ['tte', 'TTE'],
  ['personal_meeting', 'Personal Meeting'], ['quotation', 'Quotation'], ['follow_up', 'Follow-up'],
  ['converted', 'Converted'], ['cold', 'Cold'],
];

function istDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function CounselorLifecycleWorkspace({ leadsPage = false }: { leadsPage?: boolean }) {
  const today = istDate();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get('workspace_view') as WorkspaceView | null;
  const initialView = leadsPage && ANALYTICS_VIEWS.some(([key]) => key === requestedView) ? requestedView as WorkspaceView : leadsPage ? 'worked' : 'received';
  const [scope, setScope] = useState(() => leadsPage
    ? normalizeAnalyticsScope(searchParams.get('lead_view'), searchParams.get('from') || searchParams.get('selected_date'), searchParams.get('to') || searchParams.get('selected_date'))
    : { view: 'daily' as const, from: today, to: today });
  const [view, setView] = useState<WorkspaceView>(initialView);
  const [page, setPage] = useState(1);
  const [dashboardSearch, setDashboardSearch] = useState('');
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
  const leads = useCounselorWorkspaceLeads({ view, scope, filters: deferredFilters, page });

  useEffect(() => {
    if (!leadsPage) return;
    const next = analyticsScopeParams(scope);
    next.delete('view');
    next.set('lead_view', scope.view);
    next.set('workspace_view', view);
    DISTRIBUTION_FILTER_KEYS.forEach(key => {
      const value = filters[key as keyof LeadFilterState];
      if (value !== undefined && value !== null && value !== '') next.set(key, String(value));
    });
    router.replace(`/leads?${next.toString()}`, { scroll: false });
  }, [filters, leadsPage, router, scope, view]);

  function selectView(next: WorkspaceView) {
    setView(next);
    setPage(1);
  }

  function selectScope(next: typeof scope) {
    setScope(next);
    setPage(1);
  }

  return (
    <section className="overflow-visible rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-amber-50 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-sky-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">{leadsPage ? 'Lead Analytics' : 'Counselor Workspace'}</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">{leadsPage ? 'Lead journey and work queues' : 'Today&apos;s work, one clear queue'}</h2>
          <p className="text-xs text-slate-500">Live workload stays current; activity metrics follow the selected period.</p>
        </div>
        <LeadAnalyticsPeriodControl scope={scope} onChange={selectScope} />
      </div>

      <div className="grid grid-cols-2 gap-px bg-slate-200/70 lg:grid-cols-6">
        {METRICS.map(metric => (
          <button key={metric.key} type="button" title={metric.hint} onClick={() => selectView(metric.key as WorkspaceView)} className={`min-h-24 bg-white px-4 py-3 text-left transition hover:bg-sky-50 ${view === metric.key ? 'shadow-[inset_0_-3px_0_#0284c7]' : ''}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{metric.label}</div>
            {leads.isLoading && !leads.data ? <Skeleton className="mt-3 h-7 w-14" /> : <div className="mt-2 text-2xl font-bold tabular-nums text-slate-950">{Number(leads.data?.summary?.[metric.key] || 0).toLocaleString()}</div>}
            <div className="mt-1 line-clamp-1 text-[10px] text-slate-400">{metric.key === 'received' || metric.key === 'pending' || metric.key === 'unworked' ? 'Live now' : 'Selected period'}</div>
          </button>
        ))}
      </div>

      <div className="space-y-4 bg-white/75 p-4 sm:p-5">
        <div className="scroll-thin flex gap-2 overflow-x-auto pb-1" aria-label="Lead analytics views">
          {ANALYTICS_VIEWS.map(([key, label]) => <button key={key} type="button" onClick={() => selectView(key)} className={`${view === key ? 'chip-blue' : 'chip-slate'} min-h-10 shrink-0`}>{label} <span className="ml-1 tabular-nums">{leads.data?.summary?.[key] ?? 0}</span></button>)}
        </div>
        {leadsPage ? <LeadFilters value={filters} onChange={next => { setFilters(next); setPage(1); }} simplifiedAdmin /> : <label className="relative block max-w-md"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className="input pl-9" value={dashboardSearch} onChange={event => { setDashboardSearch(event.target.value); setPage(1); }} placeholder="Search this queue..." /></label>}

        {leads.isLoading ? <div className="space-y-2">{[1, 2, 3].map(key => <Skeleton key={key} className="h-16" />)}</div> : leads.isError ? (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-8 text-center text-sm text-rose-800"><div>Leads in this view could not be loaded.</div><button type="button" onClick={() => leads.refetch()} className="mt-2 font-semibold underline underline-offset-2">Retry</button></div>
        ) : !leads.data?.rows.length ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">No leads in this view.</div>
        ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {leads.data.rows.map(lead => (
              <article key={lead.id} className="px-4 py-3 transition hover:bg-slate-50/80">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_0.8fr_1fr_auto] lg:items-center">
                  <div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-900">{lead.full_name || 'Unnamed lead'}</div><div className="mt-0.5 text-xs text-slate-500">{lead.phone || 'No phone'} / {humanize(lead.source || 'manual')}</div><div className="mt-1 flex flex-wrap gap-1">{lead.labels?.slice(0, 3).map(label => <span key={label.id} className="rounded-full border px-1.5 py-0.5 text-[9px] font-semibold" style={{ borderColor: label.color || '#cbd5e1', color: label.color || '#475569' }}>{label.name}</span>)}</div></div>
                  <div className="text-xs text-slate-600"><div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Journey / Last result</div><div className="mt-1 font-semibold text-slate-800">{humanize(lead.terminal_state || lead.journey_stage)}</div><div>{humanize(lead.last_call_result || 'not called')}</div></div>
                  <div className="text-xs text-slate-600"><div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Next required action</div><div className="mt-1 font-semibold text-slate-800">{humanize(lead.current_action_type || (lead.has_call_issue ? 'call retry' : 'no next action'))}</div>{(lead.next_retry_at || lead.current_action_due_at || lead.next_followup_at) && <div className={`mt-0.5 flex items-center gap-1 ${lead.is_pending ? 'font-semibold text-rose-600' : ''}`}><Clock3 className="h-3 w-3" />{fmtDate(lead.next_retry_at || lead.current_action_due_at || lead.next_followup_at, 'd MMM, h:mm a')} | {fmtRelative(lead.next_retry_at || lead.current_action_due_at || lead.next_followup_at)}</div>}{lead.is_pending && <span className="mt-1 inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">Pending cycle {lead.pending_occurrences || 1}</span>}</div>
                  <div className="flex items-center gap-2 lg:justify-end">{lead.phone && <a href={`tel:${lead.phone}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-emerald-200 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"><Phone className="h-3.5 w-3.5" />Call</a>}<Link href={`/leads/${lead.id}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-brand-200 px-3 text-xs font-semibold text-brand-700 hover:bg-brand-50">Open<ArrowRight className="h-3.5 w-3.5" /></Link></div>
                </div>
                <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer font-medium text-slate-600">More details</summary><div className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-3"><span><strong>Category:</strong> {humanize(lead.category || 'unknown')}</span><span><strong>Campaign:</strong> {lead.campaign_name || lead.campaign_label || '-'}</span><span><strong>Latest interaction:</strong> {lead.latest_interaction_at ? fmtDate(lead.latest_interaction_at, 'd MMM, h:mm a') : '-'}</span></div></details>
              </article>
            ))}
          </div>
        )}
        {(leads.data?.total || 0) > 25 && <div className="flex items-center justify-end gap-2"><span className="text-xs text-slate-500">Page {page} of {Math.ceil((leads.data?.total || 0) / 25)}</span><button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><button className="btn-secondary" disabled={page * 25 >= (leads.data?.total || 0)} onClick={() => setPage(value => value + 1)}>Next</button></div>}
      </div>
    </section>
  );
}
