'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, ChevronLeft, ChevronRight, Clock3, UserRound } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { LeadAnalyticsPeriodControl } from '@/components/leads/LeadAnalyticsPeriodControl';
import {
  DISTRIBUTION_METRICS,
  DistributionContextBar,
  DistributionError,
  DistributionSkeleton,
  DistributionSummaryGrid,
} from '@/components/leads/LeadDistributionUi';
import { useCounselorDistributionLeads } from '@/hooks/useLeadDistribution';
import { clsx, fmtPhone, humanize } from '@/lib/format';
import { normalizeAnalyticsScope } from '@/lib/leadAnalytics';
import type { LeadAnalyticsScope, LeadDailyMetric, LeadDistributionAttempt } from '@/types';

function formatDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  }).format(new Date(value)) : '-';
}

function formatMinutes(value?: number | null) {
  const minutes = Math.max(0, Math.round(Number(value || 0)));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function AttemptTrail({ attempts }: { attempts: LeadDistributionAttempt[] }) {
  if (!attempts.length) return <span className="text-xs text-slate-400">No tracked sequence</span>;
  return <details className="min-w-44"><summary className="cursor-pointer text-xs font-semibold text-brand-700">{attempts.length} tracked attempt{attempts.length === 1 ? '' : 's'}</summary><div className="mt-2 space-y-1.5">{attempts.map(attempt => <div key={attempt.id} className={clsx('rounded-lg border px-2 py-1.5 text-[10px]', attempt.attempt_state === 'missed' ? 'border-rose-100 bg-rose-50 text-rose-700' : attempt.attempt_state === 'completed' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-sky-100 bg-sky-50 text-sky-700')}><div className="font-semibold">{attempt.attempt_number === 1 ? 'Initial issue' : attempt.is_final_attempt ? 'Final recovery' : `Retry ${attempt.attempt_number - 1}`} · {humanize(attempt.trigger_reason || attempt.outcome || attempt.status)}</div><div className="mt-0.5">{attempt.attempt_state === 'missed' && attempt.overdue_by_minutes != null ? `Overdue by ${formatMinutes(attempt.overdue_by_minutes)}` : formatDate(attempt.attempted_at || attempt.scheduled_at)}</div></div>)}</div></details>;
}

export default function CounselorLeadDistributionPage() {
  const { rmId, counselorId } = useParams<{ rmId: string; counselorId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const scope = normalizeAnalyticsScope(searchParams.get('view'), searchParams.get('from'), searchParams.get('to'));
  const metric = (DISTRIBUTION_METRICS.some(option => option.key === searchParams.get('metric')) ? searchParams.get('metric') : 'received') as LeadDailyMetric;
  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const query = useCounselorDistributionLeads(rmId, counselorId, {
    ...Object.fromEntries(searchParams.entries()), metric, page, page_size: 25,
  });
  const data = query.data;

  function replaceParams(next: URLSearchParams) {
    router.replace(`/leads/distribution/rm/${rmId}/counselor/${counselorId}?${next.toString()}`);
  }

  function updateScope(nextScope: LeadAnalyticsScope) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('view', nextScope.view);
    next.set('page', '1');
    if (nextScope.view === 'daily' && nextScope.from && nextScope.to) {
      next.set('from', nextScope.from);
      next.set('to', nextScope.to);
    } else {
      next.delete('from');
      next.delete('to');
    }
    replaceParams(next);
  }

  function setMetric(nextMetric: LeadDailyMetric) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('metric', nextMetric);
    next.set('page', '1');
    if (nextMetric !== 'call_issues') next.delete('call_issue_type');
    replaceParams(next);
  }

  function setIssue(issue?: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (issue) next.set('call_issue_type', issue); else next.delete('call_issue_type');
    next.set('page', '1');
    replaceParams(next);
  }

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / (data?.page_size || 25)));
  const activeIssue = searchParams.get('call_issue_type') || '';
  const parentParams = new URLSearchParams(searchParams.toString());
  ['call_issue_type', 'page', 'search', 'sort', 'order'].forEach(key => parentParams.delete(key));

  return <AppShell title={data?.counselor.full_name || 'Counselor Lead Report'} subtitle="Lead-level explanation of counselor analytics" roles={['super_admin', 'admin', 'rm', 'member', 'partner']}>
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><Link href="/leads" className="hover:text-brand-700">Leads</Link><span>/</span><Link href={`/leads/distribution?${parentParams.toString()}`} className="hover:text-brand-700">Lead Distribution</Link><span>/</span><Link href={`/leads/distribution/rm/${rmId}?${parentParams.toString()}`} className="hover:text-brand-700">{data?.rm.full_name || 'RM'}</Link><span>/</span><span className="text-slate-700">{data?.counselor.full_name || 'Counselor'}</span></div><div className="mt-3 flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-blue-700 text-white"><UserRound className="h-6 w-6" /></div><div><h1 className="text-2xl font-bold tracking-tight text-slate-950">{data?.counselor.full_name || 'Counselor Report'}</h1><p className="text-sm text-slate-500">Counselor · RM: {data?.rm.full_name || '-'}</p></div></div></div><LeadAnalyticsPeriodControl scope={scope} onChange={updateScope} /></div>
      <DistributionContextBar scope={scope} rmName={data?.rm.full_name} counselorName={data?.counselor.full_name} />

      {query.isLoading && !data ? <DistributionSkeleton cards={3} /> : query.isError ? <DistributionError onRetry={() => query.refetch()} /> : data ? <>
        <DistributionSummaryGrid summary={data.summary} activeMetric={metric} onMetricChange={setMetric} />

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-950">Counselor Leads</h2><p className="mt-0.5 text-xs text-slate-500">{data.total.toLocaleString()} lead{data.total === 1 ? '' : 's'} explain the selected metric.</p></div><div className="flex flex-wrap gap-2">{DISTRIBUTION_METRICS.map(option => <button key={option.key} type="button" onClick={() => setMetric(option.key)} className={clsx('rounded-lg border px-3 py-1.5 text-xs font-semibold transition', metric === option.key ? 'border-brand-500 bg-brand-600 text-white' : 'border-slate-200 text-slate-600 hover:border-brand-200 hover:bg-brand-50')}>{option.key === 'received' ? 'All Leads' : option.label} <span className="ml-1 opacity-80">({Number(data.summary[option.key] || 0).toLocaleString()})</span></button>)}</div></div>
            {metric === 'call_issues' && <div className="mt-3 flex gap-2 overflow-x-auto border-t border-slate-100 pt-3"><button type="button" onClick={() => setIssue()} className={clsx('shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold', !activeIssue ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-600')}>All Call Issues ({data.summary.call_issues})</button>{Object.entries(data.call_issue_buckets).sort(([, a], [, b]) => b - a).map(([issue, count]) => <button key={issue} type="button" onClick={() => setIssue(issue)} className={clsx('shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold', activeIssue === issue ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>{data.call_issue_labels[issue] || humanize(issue)} ({count})</button>)}</div>}
          </div>

          <div className="overflow-x-auto">{query.isFetching && <div className="h-0.5 animate-pulse bg-brand-500" />}<table className="min-w-[1500px] w-full text-sm"><thead className="bg-slate-50"><tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">{['Lead', 'Source / Campaign', 'Assigned', 'Stage', 'Call Status', 'Current Remark', 'Attempt', 'Next Follow-up', 'Last Activity', 'Action'].map(label => <th key={label} className="border-b border-slate-200 px-3 py-3">{label}</th>)}</tr></thead><tbody>{data.rows.map(lead => <tr key={lead.id} className="border-b border-slate-100 align-top hover:bg-slate-50/70"><td className="px-3 py-3"><div className="font-semibold text-slate-900">{lead.full_name || 'Unnamed lead'}</div><div className="mt-0.5 text-xs text-slate-500">{fmtPhone(lead.phone || '')}</div>{lead.has_call_issue && <div className="mt-1 inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">{data.call_issue_labels[lead.effective_call_issue || ''] || humanize(lead.effective_call_issue || 'Call issue')}</div>}</td><td className="max-w-52 px-3 py-3 text-xs text-slate-600"><div>{lead.source || '-'}</div><div className="mt-1 truncate" title={lead.campaign_name || lead.campaign_label || undefined}>{lead.campaign_name || lead.campaign_label || '-'}</div></td><td className="px-3 py-3 text-xs text-slate-600">{formatDate(lead.assigned_at)}</td><td className="px-3 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{humanize(lead.stage || 'new')}</span></td><td className="px-3 py-3 text-xs text-slate-700">{humanize(lead.latest_remark_status || lead.call_status || 'not_called')}</td><td className="max-w-64 px-3 py-3"><div className="line-clamp-3 text-xs text-slate-700" title={lead.current_remark || undefined}>{lead.current_remark || '-'}</div><div className="mt-1 text-[10px] text-slate-400">{formatDate(lead.latest_remark_at)}</div></td><td className="px-3 py-3"><AttemptTrail attempts={lead.attempts || []} /></td><td className="px-3 py-3 text-xs text-slate-600">{formatDate(lead.next_attempt_at || lead.next_followup_at)}</td><td className="px-3 py-3 text-xs text-slate-600">{formatDate(lead.last_activity_at)}</td><td className="px-3 py-3"><Link href={`/leads/${lead.id}`} className="inline-flex items-center gap-1 rounded-lg border border-brand-200 px-2.5 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50">Open Lead<ArrowRight className="h-3.5 w-3.5" /></Link></td></tr>)}{!data.rows.length && <tr><td colSpan={10} className="px-4 py-14 text-center"><Clock3 className="mx-auto h-7 w-7 text-slate-300" /><div className="mt-2 text-sm font-medium text-slate-700">{metric === 'call_issues' ? 'No call issue leads for this period.' : 'No leads found for the selected period.'}</div></td></tr>}</tbody></table></div>
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500"><span>Page {data.page} of {totalPages}</span><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => { const next = new URLSearchParams(searchParams.toString()); next.set('page', String(page - 1)); replaceParams(next); }} className="btn-outline inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" />Previous</button><button type="button" disabled={page >= totalPages} onClick={() => { const next = new URLSearchParams(searchParams.toString()); next.set('page', String(page + 1)); replaceParams(next); }} className="btn-outline inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 disabled:opacity-40">Next<ChevronRight className="h-3.5 w-3.5" /></button></div></div>
        </section>
      </> : null}
    </div>
  </AppShell>;
}
