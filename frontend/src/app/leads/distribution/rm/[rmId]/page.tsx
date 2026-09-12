'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { UserRound } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { LeadAnalyticsPeriodControl } from '@/components/leads/LeadAnalyticsPeriodControl';
import {
  DISTRIBUTION_METRICS,
  DistributionContextBar,
  DistributionError,
  DistributionPersonCard,
  DistributionSearchInput,
  DistributionSkeleton,
  DistributionSummaryGrid,
  UnassignedDistributionCard,
} from '@/components/leads/LeadDistributionUi';
import { useRmCounselorDistribution } from '@/hooks/useLeadDistribution';
import { normalizeAnalyticsScope } from '@/lib/leadAnalytics';
import type { LeadAnalyticsScope, LeadDailyMetric } from '@/types';

export default function RmLeadDistributionPage() {
  const { rmId } = useParams<{ rmId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const scope = normalizeAnalyticsScope(searchParams.get('view'), searchParams.get('from'), searchParams.get('to'));
  const activeMetric = (DISTRIBUTION_METRICS.some(option => option.key === searchParams.get('metric')) ? searchParams.get('metric') : 'received') as LeadDailyMetric;
  const requestParams = new URLSearchParams(searchParams.toString());
  requestParams.delete('metric');
  const query = useRmCounselorDistribution(rmId, Object.fromEntries(requestParams.entries()));
  const data = query.data;

  function replaceParams(next: URLSearchParams) {
    router.replace(`/leads/distribution/rm/${rmId}?${next.toString()}`);
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

  function updateMetric(metric: LeadDailyMetric) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('metric', metric);
    replaceParams(next);
  }

  function counselorHref(counselorId: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('search');
    next.delete('sort');
    next.delete('order');
    if (!next.get('metric')) next.set('metric', 'received');
    return `/leads/distribution/rm/${rmId}/counselor/${counselorId}?${next.toString()}`;
  }

  const reconciled = data
    ? data.counselors.reduce((total, counselor) => total + counselor.received, 0) + data.unassigned.received
    : 0;
  const hasHierarchySearch = Boolean(searchParams.get('search')?.trim());
  const parentParams = new URLSearchParams(searchParams.toString());
  parentParams.delete('search');
  parentParams.delete('sort');
  parentParams.delete('order');

  return <AppShell title={data?.rm.full_name || 'RM Distribution'} subtitle="Counselor-level lead distribution and performance" roles={['super_admin', 'admin', 'rm']}>
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><Link href="/leads" className="hover:text-brand-700">Leads</Link><span>/</span><Link href={`/leads/distribution?${parentParams.toString()}`} className="hover:text-brand-700">Lead Distribution</Link><span>/</span><span className="text-slate-700">{data?.rm.full_name || 'RM'}</span></div><div className="mt-3 flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-blue-700 text-white"><UserRound className="h-6 w-6" /></div><div><h1 className="text-2xl font-bold tracking-tight text-slate-950">{data?.rm.full_name || 'Relationship Manager'}</h1><p className="text-sm text-slate-500">Relationship Manager{data?.rm.team_name ? ` - ${data.rm.team_name}` : ''}</p></div></div></div><LeadAnalyticsPeriodControl scope={scope} onChange={updateScope} /></div>
      <DistributionContextBar scope={scope} rmName={data?.rm.full_name} />

      {query.isLoading && !data ? <DistributionSkeleton /> : query.isError ? <DistributionError onRetry={() => query.refetch()} /> : data ? <>
        <DistributionSummaryGrid summary={data.summary} activeMetric={activeMetric} onMetricChange={updateMetric} />
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-950">Counselors</h2><p className="mt-0.5 text-xs text-slate-500">Current counselors belonging to {data.rm.full_name}.</p></div><div className="flex flex-wrap items-center gap-2"><DistributionSearchInput value={searchParams.get('search') || ''} placeholder="Search counselor..." onSearch={value => { const next = new URLSearchParams(searchParams.toString()); if (value) next.set('search', value); else next.delete('search'); replaceParams(next); }} /><select value={searchParams.get('sort') || 'received'} onChange={event => { const next = new URLSearchParams(searchParams.toString()); next.set('sort', event.target.value); replaceParams(next); }} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-brand-400"><option value="received">Sort: Leads Received</option><option value="worked">Sort: Worked</option><option value="pending">Sort: Pending</option><option value="converted">Sort: Converted</option><option value="call_issues">Sort: Call Issues</option><option value="name">Sort: Name</option></select></div></div>
          {data.counselors.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{data.counselors.map(counselor => <DistributionPersonCard key={counselor.id} person={counselor} href={counselorHref(String(counselor.id))} kind="counselor" />)}</div> : <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">No counselors are currently assigned to this RM.</div>}
          {data.unassigned.received > 0 && <div className="mt-4"><UnassignedDistributionCard person={data.unassigned} label="Unassigned to Counselor" /></div>}
          <div className={hasHierarchySearch ? "mt-4 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800" : "mt-4 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"}><strong>{hasHierarchySearch ? 'Matched counselor share:' : 'Reconciled:'}</strong> counselor totals + unassigned = {reconciled.toLocaleString()} / {data.summary.received.toLocaleString()} RM leads{hasHierarchySearch ? ' (clear search for full reconciliation)' : ''}</div>
        </section>
      </> : null}
    </div>
  </AppShell>;
}
