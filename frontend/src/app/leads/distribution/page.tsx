'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { LeadAnalyticsPeriodControl } from '@/components/leads/LeadAnalyticsPeriodControl';
import {
  DistributionContextBar,
  DistributionError,
  DistributionPersonCard,
  DistributionSearchInput,
  DistributionSkeleton,
  DistributionSummaryGrid,
  UnassignedDistributionCard,
} from '@/components/leads/LeadDistributionUi';
import { useRmDistribution } from '@/hooks/useLeadDistribution';
import { copyDistributionFilters, normalizeAnalyticsScope } from '@/lib/leadAnalytics';
import type { LeadAnalyticsScope } from '@/types';

function requestObject(params: URLSearchParams) {
  return Object.fromEntries(params.entries());
}

export default function LeadDistributionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scope = normalizeAnalyticsScope(searchParams.get('view'), searchParams.get('from'), searchParams.get('to'));
  const query = useRmDistribution(requestObject(searchParams));
  const data = query.data;

  function replaceParams(next: URLSearchParams) {
    router.replace(`/leads/distribution?${next.toString()}`);
  }

  function updateScope(nextScope: LeadAnalyticsScope) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('view', nextScope.view);
    if (nextScope.view === 'daily' && nextScope.from && nextScope.to) {
      next.set('from', nextScope.from);
      next.set('to', nextScope.to);
    } else {
      next.delete('from');
      next.delete('to');
    }
    replaceParams(next);
  }

  function rmHref(rmId: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('search');
    next.delete('sort');
    next.delete('order');
    return `/leads/distribution/rm/${rmId}?${next.toString()}`;
  }

  const reconciled = data
    ? data.rms.reduce((total, rm) => total + rm.received, 0) + data.unassigned.received
    : 0;
  const hasHierarchySearch = Boolean(searchParams.get('search')?.trim());
  const distributionRows = data ? [
    ...data.rms.filter(rm => rm.received > 0).map(rm => ({ name: rm.full_name, count: rm.received, share: rm.distribution_share || 0 })),
    ...(data.unassigned.received ? [{ name: 'Unassigned RM', count: data.unassigned.received, share: data.summary.received ? Number((data.unassigned.received / data.summary.received * 100).toFixed(1)) : 0 }] : []),
  ] : [];
  const leadParams = copyDistributionFilters(searchParams, new URLSearchParams({ lead_view: scope.view }));
  if (scope.view === 'daily' && scope.from && scope.to) {
    leadParams.set('from', scope.from);
    leadParams.set('to', scope.to);
    leadParams.set('daily_metric', 'received');
  } else {
    leadParams.set('all_time_metric', 'all');
  }

  return <AppShell title="Lead Distribution" subtitle="See how incoming leads are distributed and progressing across RMs" roles={['super_admin', 'admin', 'rm']}>
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2 text-xs text-slate-500"><Link href="/leads" className="hover:text-brand-700">Leads</Link><span>/</span><span className="text-slate-700">Lead Distribution</span></div><h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Lead Distribution</h1><p className="mt-1 text-sm text-slate-500">Every total follows the active Leads analytics scope.</p></div>
        <LeadAnalyticsPeriodControl scope={scope} onChange={updateScope} />
      </div>
      <DistributionContextBar scope={scope} />

      {query.isLoading && !data ? <DistributionSkeleton /> : query.isError ? <DistributionError onRetry={() => query.refetch()} /> : data ? <>
        <DistributionSummaryGrid summary={data.summary} />

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-950">RM Performance and Distribution</h2><p className="mt-0.5 text-xs text-slate-500">Metrics remain separate; share bars represent distribution only.</p></div><div className="flex flex-wrap gap-2">
              <DistributionSearchInput value={searchParams.get('search') || ''} placeholder="Search RM..." onSearch={value => { const next = new URLSearchParams(searchParams.toString()); if (value) next.set('search', value); else next.delete('search'); replaceParams(next); }} />
              <select value={searchParams.get('sort') || 'received'} onChange={event => { const next = new URLSearchParams(searchParams.toString()); next.set('sort', event.target.value); replaceParams(next); }} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-brand-400"><option value="received">Sort: Leads Received</option><option value="worked">Sort: Worked</option><option value="pending">Sort: Pending</option><option value="call_issues">Sort: Call Issues</option><option value="name">Sort: Name</option></select>
            </div></div>
            {data.rms.length ? <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{data.rms.map(rm => <DistributionPersonCard key={rm.id} person={rm} href={rmHref(String(rm.id))} kind="rm" />)}</div> : <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">No RM distribution found for this period.</div>}
            {data.unassigned.received > 0 && <div className="mt-4"><UnassignedDistributionCard person={data.unassigned} label="Unassigned RM" /></div>}
          </div>

          <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-brand-600" /><h2 className="font-semibold text-slate-950">Distribution Health</h2></div><p className="mt-1 text-xs text-slate-500">Lead share only, not a performance score.</p><div className="mt-4 space-y-3">{distributionRows.map(row => <div key={row.name}><div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="truncate font-medium text-slate-700">{row.name}</span><span className="shrink-0 tabular-nums text-slate-500">{row.count.toLocaleString()} · {row.share}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-blue-400" style={{ width: `${Math.min(100, row.share)}%` }} /></div></div>)}</div><div className={hasHierarchySearch ? "mt-5 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800" : "mt-5 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"}><strong>{hasHierarchySearch ? 'Matched RM share:' : 'Reconciled:'}</strong> {reconciled.toLocaleString()} / {data.summary.received.toLocaleString()} leads{hasHierarchySearch ? ' (clear search for full reconciliation)' : ''}</div></aside>
        </section>
      </> : null}

      <Link href={`/leads?${leadParams.toString()}`} className="inline-flex items-center gap-2 text-xs font-semibold text-brand-700 hover:text-brand-800"><ArrowLeft className="h-4 w-4" />Back to Leads</Link>
    </div>
  </AppShell>;
}
