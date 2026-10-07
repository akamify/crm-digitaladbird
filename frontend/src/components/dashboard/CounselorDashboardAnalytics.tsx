'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { useCounselorWorkspaceSummary } from '@/hooks/useLifecycle';
import { LEADS_METRICS, LEADS_VIEWS, QUEUE_TONES } from '@/components/leads/counselorAnalyticsMetrics';
import { LeadAnalyticsPeriodControl } from '@/components/leads/LeadAnalyticsPeriodControl';
import { Skeleton } from '@/components/ui/Modal';
import { copyDistributionFilters, normalizeAnalyticsScope } from '@/lib/leadAnalytics';
import type { LeadAnalyticsScope, LeadFilters } from '@/types';

export function CounselorDashboardAnalytics() {
  const search = useSearchParams();
  const router = useRouter();
  const scope = normalizeAnalyticsScope(search.get('lead_view') || 'daily', search.get('from') || search.get('selected_date'), search.get('to') || search.get('selected_date'));
  const filters = copyDistributionFilters(search, new URLSearchParams());
  const query = useCounselorWorkspaceSummary(scope, Object.fromEntries(filters) as LeadFilters, true, true);
  const summary = query.data?.summary;
  const paramsFor = (next: LeadAnalyticsScope) => {
    const params = new URLSearchParams(filters);
    params.set('lead_view', next.view);
    if (next.view === 'daily' && next.from && next.to) {
      params.set('from', next.from);
      params.set('to', next.to);
    }
    return params;
  };
  const href = (view: string) => {
    const params = paramsFor(scope);
    params.set('workspace_view', view);
    params.set('page', '1');
    return `/leads?${params}`;
  };
  return <section className="min-w-0 overflow-hidden rounded-2xl border border-sky-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-sky-50/50 p-4">
      <div><h2 className="font-semibold text-slate-950">Your lead analytics</h2><p className="mt-1 text-xs text-slate-500">Choose a queue or remark to open its leads.</p></div>
      <div className="flex items-center gap-2"><LeadAnalyticsPeriodControl scope={scope} onChange={next => router.replace(`/dashboard/member?${paramsFor(next)}`, {scroll: false})} />
        <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label="Refresh analytics" className="rounded-full p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} /></button>
      </div>
    </div>
    {query.isError && <div role="alert" className="m-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">Could not load analytics. <button type="button" className="font-semibold underline" onClick={() => void query.refetch()}>Retry</button></div>}
    <div className="grid grid-cols-2 gap-px bg-slate-100 lg:grid-cols-5">
      {LEADS_METRICS.map(metric => <Link key={metric.key} href={href(metric.key)} title={metric.hint} className={`${metric.key === 'cc' ? 'lg:hidden ' : ''}${QUEUE_TONES[metric.key]} relative min-h-24 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500`}>
        <div className="pr-4 text-xs font-medium">{metric.label}</div><ArrowUpRight aria-hidden="true" className="absolute right-3 top-4 h-4 w-4" />
        {query.isLoading ? <Skeleton className="mt-2 h-8 w-16" /> : <div className="mt-2 text-2xl font-bold tabular-nums">{summary ? Number(summary[metric.key] || 0).toLocaleString() : 'Unavailable'}</div>}
        {metric.key === 'worked' && summary && <div className="mt-1 text-[11px]">N {summary.worked_n || 0} / O {summary.worked_o || 0} / Previous {summary.worked_legacy || 0}</div>}
      </Link>)}
    </div>
    <nav aria-label="Remark lead reports" className="flex flex-wrap gap-2 p-4">
      {LEADS_VIEWS.map(([key, label]) => <Link key={key} href={href(key)} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 hover:border-brand-300 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500">{label}<span className="font-semibold tabular-nums">{summary ? summary[key] || 0 : '—'}</span></Link>)}
    </nav>
    <p className="px-4 pb-4 text-xs text-slate-500">Assigned and queue counts use assignment date; Worked uses work date. Old and remark tabs can overlap.</p>
  </section>;
}
