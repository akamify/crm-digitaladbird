'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { MANAGER_METRICS, managerLeadHref, distributionReportHref } from '@/lib/managerWorkflow';
import { AlertCircle, ArrowRight, Clock3, PhoneCall, RefreshCw, Search, UserRound, Users, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/Modal';
import { clsx, initials } from '@/lib/format';
import { formatAnalyticsPeriod } from '@/lib/leadAnalytics';
import type { LeadAnalyticsScope, LeadDistributionPerson, LeadDistributionSummary, LeadDailyMetric } from '@/types';

export const DISTRIBUTION_METRICS = MANAGER_METRICS;

export function DistributionSummaryGrid({ summary, activeMetric, onMetricChange, leadParams }: {
  summary: LeadDistributionSummary;
  activeMetric?: LeadDailyMetric;
  onMetricChange?: (metric: LeadDailyMetric) => void;
  leadParams?: URLSearchParams;
}) {
  const search = useSearchParams();
  const route = useParams<{rmId?: string; counselorId?: string}>();
  const params = leadParams || new URLSearchParams(search.toString());
  const href = (key: string) => route.rmId ? distributionReportHref(params, key, route.rmId, route.counselorId) : managerLeadHref(params, key);
  return <div className="min-w-0 space-y-3">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">{DISTRIBUTION_METRICS.slice(0,5).map(metric =>
      <div key={metric.key} className={clsx('relative rounded-xl border p-3', activeMetric === metric.key ? 'border-brand-300 bg-blue-50' : 'border-slate-200 bg-white')}>
        <button type="button" aria-pressed={activeMetric === metric.key} onClick={() => onMetricChange?.(metric.key)} className="w-full pr-5 text-left">
          <span className="block text-[10px] font-semibold uppercase text-slate-500">{metric.label}</span>
          <span className="mt-2 block text-2xl font-bold tabular-nums">{Number(summary[metric.key] || 0).toLocaleString()}</span>
        </button>
        <Link href={href(metric.key)} aria-label={`Open ${metric.label}`} title={`Open ${metric.label}`} className="absolute right-2 top-2 rounded p-1 text-brand-600 hover:bg-blue-100"><ArrowRight className="h-4 w-4" /></Link>
        {metric.key === 'worked' && <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-600">{[['new','N','worked_n'],['old','O','worked_o'],['previous','Previous','worked_legacy']].map(([source,label,key]) => <Link key={source} href={`${href('worked')}&work_source=${source}`} className="hover:text-brand-600 hover:underline">{label} {summary[key as LeadDailyMetric] || 0}</Link>)}</div>}
      </div>)}</div>
    <div className="flex max-w-full gap-2 overflow-x-auto pb-2">{DISTRIBUTION_METRICS.slice(5).map(metric => <div key={metric.key} className={clsx('flex shrink-0 items-center rounded-full border text-xs',activeMetric===metric.key ? 'border-brand-300 bg-blue-50 text-brand-700':'border-slate-200 bg-white text-slate-600')}>
      <button type="button" aria-pressed={activeMetric === metric.key} onClick={() => onMetricChange?.(metric.key)} className="rounded-l-full px-3 py-2">{metric.label} <strong className="ml-1 tabular-nums">{summary[metric.key] || 0}</strong></button>
      <Link href={href(metric.key)} aria-label={`Open ${metric.label}`} className="rounded-r-full p-2 text-brand-600 hover:bg-blue-100"><ArrowRight className="h-3 w-3" /></Link>
    </div>)}</div>
    <p className="text-xs text-slate-500">Assigned Leads retains the original received-date total. Queue and remark tabs use assignment date; Worked uses work date. Old and remark tabs can overlap.</p>
  </div>;
}

export function DistributionPersonCard({ person, href, kind }: {
  person: LeadDistributionPerson;
  href: string;
  kind: 'rm' | 'counselor';
}) {
  const target = new URL(href, 'https://local.invalid');
  const path = target.pathname.split('/');
  const rmId = path[path.indexOf('rm') + 1];
  const counselorId = kind === 'counselor' ? person.id || undefined : undefined;
  const role = kind === 'rm' ? 'Relationship Manager' : 'Counselor';
  const action = kind === 'rm' ? 'View Counselors' : 'View Lead Details';
  return <article className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg hover:shadow-blue-100/70">
    <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-blue-700 text-sm font-bold text-white shadow-sm">{initials(person.full_name)}</div>
      <div className="min-w-0 flex-1"><h3 className="truncate font-semibold text-slate-950">{person.full_name}</h3><p className="mt-0.5 text-xs text-slate-500">{role}{person.team_name ? ` - ${person.team_name}` : ''}</p></div>
      {kind === 'rm' && <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600"><Users className="h-3 w-3" />{person.counselor_count || 0}</div>}
    </div>
    <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">{DISTRIBUTION_METRICS.map(metric => <Link key={metric.key} href={distributionReportHref(target.searchParams, metric.key, rmId, counselorId)} className="bg-white px-3 py-2.5 hover:bg-blue-50 focus-visible:bg-blue-50"><div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{metric.shortLabel}</div><div className={clsx('mt-1 text-sm font-bold tabular-nums', metric.key === 'converted' && person[metric.key] ? 'text-emerald-600' : metric.key === 'call_issues' && person[metric.key] ? 'text-rose-600' : metric.key === 'pending' && person[metric.key] ? 'text-amber-600' : 'text-slate-800')}>{Number(person[metric.key] || 0).toLocaleString()}</div></Link>)}</div>
    <div className="flex flex-wrap gap-3 px-3 pt-3 text-xs text-slate-600">{[['new','New (N)','worked_n'],['old','Old (O)','worked_o'],['previous','Previous work','worked_legacy']].map(([source,label,key])=><Link key={source} href={`${distributionReportHref(target.searchParams,'worked',rmId,counselorId)}&work_source=${source}`} className="hover:text-brand-700 hover:underline">{label}: {person[key as LeadDailyMetric] || 0}</Link>)}</div>
    {kind === 'rm' && <div className="px-4 pt-3"><div className="mb-1 flex justify-between text-[10px] font-medium text-slate-500"><span>Distribution share</span><span>{person.distribution_share || 0}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, person.distribution_share || 0)}%` }} /></div></div>}
    {kind === 'counselor' && <div className="flex items-center justify-between px-4 pt-3 text-[10px] text-slate-500"><span>Work rate</span><span className="font-semibold text-slate-700">{person.work_rate || 0}%</span></div>}
    <Link href={href} className="m-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-xs font-semibold text-brand-700 transition group-hover:bg-brand-50"><span>{action}</span><ArrowRight className="h-4 w-4" /></Link>
  </article>;
}

export function UnassignedDistributionCard({ person, label }: { person: LeadDistributionPerson; label: string }) {
  return <article className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 p-4">
    <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-amber-100 text-amber-700"><UserRound className="h-5 w-5" /></div><div><h3 className="font-semibold text-amber-950">{label}</h3><p className="text-xs text-amber-700">Assignment state kept separate from workflow status.</p></div></div>
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{DISTRIBUTION_METRICS.map(metric => <div key={metric.key} className="rounded-lg bg-white/80 px-2 py-2"><div className="truncate text-[9px] uppercase tracking-wide text-amber-700/70">{metric.shortLabel}</div><div className="mt-1 font-bold tabular-nums text-amber-950">{Number(person[metric.key] || 0).toLocaleString()}</div></div>)}</div>
  </article>;
}

export function DistributionContextBar({ scope, rmName, counselorName }: { scope: LeadAnalyticsScope; rmName?: string; counselorName?: string }) {
  return <div className="sticky top-[72px] z-20 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-blue-100 bg-white/95 px-4 py-2.5 text-xs shadow-sm backdrop-blur">
    <span className="inline-flex items-center gap-1.5 text-slate-600"><Clock3 className="h-3.5 w-3.5 text-brand-600" /><strong className="text-slate-800">Period:</strong>{formatAnalyticsPeriod(scope)}</span>
    <span className="text-slate-600"><strong className="text-slate-800">Mode:</strong> {scope.view === 'all_time' ? 'All Time' : scope.from === scope.to ? 'Daily' : 'Range'}</span>
    {rmName && <span className="text-slate-600"><strong className="text-slate-800">RM:</strong> {rmName}</span>}
    {counselorName && <span className="text-slate-600"><strong className="text-slate-800">Counselor:</strong> {counselorName}</span>}
  </div>;
}

export function DistributionSkeleton({ cards = 6 }: { cards?: number }) {
  return <div className="space-y-4"><div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">{Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-20 rounded-xl" />)}</div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: cards }, (_, index) => <Skeleton key={index} className="h-72 rounded-2xl" />)}</div></div>;
}

export function DistributionError({ onRetry }: { onRetry: () => void }) {
  return <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-rose-100 bg-white p-8 text-center"><AlertCircle className="h-8 w-8 text-rose-500" /><h2 className="mt-3 font-semibold text-slate-900">Unable to load distribution analytics</h2><p className="mt-1 max-w-md text-sm text-slate-500">The report request failed. Existing lead data and workflows were not changed.</p><button type="button" onClick={onRetry} className="btn-outline mt-4 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs"><RefreshCw className="h-3.5 w-3.5" />Retry</button></div>;
}

export function DistributionSearchInput({ value, placeholder, onSearch }: { value: string; placeholder: string; onSearch: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <form onSubmit={event => { event.preventDefault(); onSearch(draft.trim()); }} className="relative">
    <button type="submit" aria-label="Search" className="absolute left-2.5 top-2.5 text-slate-400 hover:text-brand-600"><Search className="h-4 w-4" /></button>
    <input value={draft} onChange={event => setDraft(event.target.value)} placeholder={placeholder} className="h-9 w-48 rounded-lg border border-slate-200 pl-9 pr-8 text-xs outline-none focus:border-brand-400" />
    {draft && <button type="button" aria-label="Clear search" onClick={() => { setDraft(''); onSearch(''); }} className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>}
  </form>;
}

export function CallIssueIndicator({ count }: { count: number }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700"><PhoneCall className="h-3 w-3" />{count}</span>;
}
