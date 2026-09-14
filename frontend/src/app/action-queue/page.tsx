'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ListChecks,
  PhoneCall,
  RefreshCw,
  Search,
  UserRound,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, Skeleton } from '@/components/ui/Modal';
import { formatISTCompact } from '@/lib/date';
import { clsx, fmtPhone, humanize } from '@/lib/format';
import { ActionQueueType, useActionQueue } from '@/hooks/useActionQueue';

const QUEUE_FILTERS: Array<{
  key: ActionQueueType;
  label: string;
  description: string;
  Icon: typeof ListChecks;
  tone: string;
}> = [
  { key: 'all', label: 'All Actions', description: 'Complete prioritized workload', Icon: ListChecks, tone: 'text-blue-700 bg-blue-50 border-blue-200' },
  { key: 'overdue_retry', label: 'Overdue Retries', description: 'Scheduled retry time has passed', Icon: PhoneCall, tone: 'text-rose-700 bg-rose-50 border-rose-200' },
  { key: 'unworked', label: 'Unworked Leads', description: 'No qualifying action recorded', Icon: AlertCircle, tone: 'text-amber-700 bg-amber-50 border-amber-200' },
  { key: 'followup', label: 'Today Follow-ups', description: 'Follow-ups scheduled today', Icon: Clock3, tone: 'text-sky-700 bg-sky-50 border-sky-200' },
  { key: 'meeting', label: 'Today Meetings', description: 'Meetings without an outcome', Icon: CalendarClock, tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
];


const VALID_TYPES = new Set(QUEUE_FILTERS.map(option => option.key));


function dueLabel(taskType: string, dueAt: string | null) {
  if (!dueAt) return 'No due time';
  const diffMinutes = Math.round((new Date(dueAt).getTime() - Date.now()) / 60000);
  if (diffMinutes === 0) return 'Due now';
  if (diffMinutes > 0) {
    if (diffMinutes < 60) return `Due in ${diffMinutes}m`;
    return `Due in ${Math.floor(diffMinutes / 60)}h ${diffMinutes % 60}m`;
  }
  const overdue = Math.abs(diffMinutes);
  if (taskType === 'unworked') {
    if (overdue < 60) return `Unworked for ${overdue}m`;
    return `Unworked for ${Math.floor(overdue / 60)}h ${overdue % 60}m`;
  }
  if (overdue < 60) return `Overdue by ${overdue}m`;
  const days = Math.floor(overdue / 1440);
  const hours = Math.floor((overdue % 1440) / 60);
  return days ? `Overdue by ${days}d ${hours}h` : `Overdue by ${hours}h ${overdue % 60}m`;
}

function scopeLabel(scope?: string) {
  if (scope === 'all') return 'All assigned CRM leads';
  if (scope === 'team') return 'Your RM team';
  return 'Your assigned leads';
}

export default function ActionQueuePage() {
  return (
    <AppShell
      title="My Action Queue"
      subtitle="A prioritized workspace for calls, follow-ups, and meetings"
      roles={['super_admin', 'admin', 'rm', 'member', 'partner']}
    >
      <ActionQueueContent />
    </AppShell>
  );
}

function ActionQueueContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedType = searchParams.get('type') || 'all';
  const type = (VALID_TYPES.has(requestedType as ActionQueueType) ? requestedType : 'all') as ActionQueueType;
  const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
  const activeSearch = searchParams.get('q') || '';
  const [search, setSearch] = useState(activeSearch);
  const queue = useActionQueue({ type, page, page_size: 25, q: activeSearch });
  const data = queue.data;
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / (data?.page_size || 25)));

  useEffect(() => setSearch(activeSearch), [activeSearch]);

  function replaceQuery(next: URLSearchParams) {
    const queryString = next.toString();
    router.replace(`/action-queue${queryString ? `?${queryString}` : ''}`);
  }

  function selectType(nextType: ActionQueueType) {
    const next = new URLSearchParams(searchParams.toString());
    if (nextType === 'all') next.delete('type');
    else next.set('type', nextType);
    next.set('page', '1');
    replaceQuery(next);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams(searchParams.toString());
    if (search.trim()) next.set('q', search.trim());
    else next.delete('q');
    next.set('page', '1');
    replaceQuery(next);
  }

  function changePage(nextPage: number) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('page', String(nextPage));
    replaceQuery(next);
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.14),_transparent_38%),linear-gradient(135deg,#ffffff,#f8fafc)] shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-950 text-white shadow-lg shadow-slate-300">
              <ListChecks className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-950">Work the highest-priority action first</div>
              <div className="mt-1 text-xs text-slate-500">Scope: {scopeLabel(data?.scope)}. Separate actions on the same lead are shown separately.</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {queue.isFetching && <span className="hidden text-xs text-slate-400 sm:inline">Refreshing...</span>}
            <button type="button" onClick={() => queue.refetch()} disabled={queue.isFetching} className="btn-outline inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold disabled:opacity-50">
              <RefreshCw className={clsx('h-4 w-4', queue.isFetching && 'animate-spin')} /> Refresh
            </button>
          </div>
        </div>

        <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-5">
          {QUEUE_FILTERS.map(({ key, label, description, Icon, tone }) => {
            const active = type === key;
            const count = Number(data?.summary?.[key] || 0);
            return (
              <button key={key} type="button" onClick={() => selectType(key)} className={clsx(
                'rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-brand-500/30',
                active ? 'border-slate-900 bg-slate-950 text-white shadow-md' : 'border-white bg-white/90 text-slate-900 shadow-sm hover:border-slate-200 hover:bg-white',
              )}>
                <div className="flex items-center justify-between gap-3">
                  <span className={clsx('grid h-8 w-8 place-items-center rounded-lg border', active ? 'border-white/15 bg-white/10 text-white' : tone)}><Icon className="h-4 w-4" /></span>
                  <span className="text-xl font-bold tabular-nums">{queue.isLoading ? '...' : count.toLocaleString()}</span>
                </div>
                <div className="mt-3 text-xs font-semibold">{label}</div>
                <div className={clsx('mt-1 truncate text-[10px]', active ? 'text-slate-300' : 'text-slate-500')} title={description}>{description}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">{QUEUE_FILTERS.find(option => option.key === type)?.label}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{data?.total?.toLocaleString() || 0} matching action{data?.total === 1 ? '' : 's'}, sorted by urgency and due time.</p>
          </div>
          <form onSubmit={submitSearch} className="flex w-full max-w-md gap-2">
            <label className="relative flex-1">
              <span className="sr-only">Search action queue</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search lead, phone, counselor..." className="input h-10 w-full pl-9" />
            </label>
            <button type="submit" className="btn-primary rounded-lg px-4 text-xs font-semibold">Search</button>
          </form>
        </div>

        {queue.isLoading && !data ? (
          <div className="space-y-3 p-4">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-24" />)}</div>
        ) : queue.isError ? (
          <div className="p-8 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-rose-500" />
            <div className="mt-3 text-sm font-semibold text-slate-900">Unable to load your action queue</div>
            <div className="mt-1 text-xs text-slate-500">Please retry. Existing lead data has not been changed.</div>
            <button type="button" onClick={() => queue.refetch()} className="btn-outline mt-4 rounded-lg px-4 py-2 text-xs">Try again</button>
          </div>
        ) : !data?.rows.length ? (
          <EmptyState
            title={activeSearch ? 'No matching actions' : 'Queue is clear'}
            description={activeSearch ? 'Try a different lead, phone, or counselor search.' : 'There are no actions in this category right now.'}
            icon={<CheckCircle2 className="h-6 w-6" />}
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {data.rows.map(task => {
              const destination = task.lead_id ? `/leads/${task.lead_id}` : '/personal-meetings';
              return (
                <article key={task.task_id} className="group grid gap-4 px-4 py-4 transition hover:bg-slate-50/80 lg:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.8fr)_180px_auto] lg:items-center">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className={clsx('mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border', QUEUE_FILTERS.find(option => option.key === task.task_type)?.tone)}>
                      {task.task_type === 'overdue_retry' ? <PhoneCall className="h-4 w-4" /> : task.task_type === 'meeting' ? <CalendarClock className="h-4 w-4" /> : task.task_type === 'followup' ? <Clock3 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-slate-950">{task.lead_name || 'Unlinked meeting'}</h3>
                        <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                          task.priority === 'urgent' ? 'bg-rose-100 text-rose-700' : task.priority === 'high' ? 'bg-orange-100 text-orange-700' : task.priority === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600',
                        )}>{task.priority}</span>
                      </div>
                      <div className="mt-1 text-xs font-medium text-slate-700">{task.title}</div>
                      <div className="mt-1 truncate text-xs text-slate-500" title={task.reason}>{task.reason}</div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                        <span>{fmtPhone(task.phone || '') || 'No phone'}</span>
                        <span>{task.source || 'Unknown source'}</span>
                        {task.campaign_name && <span className="max-w-48 truncate" title={task.campaign_name}>{task.campaign_name}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0"><div className="truncate font-medium text-slate-800">{task.assigned_to_name || 'Unassigned owner'}</div><div className="mt-0.5 text-[10px] text-slate-400">Responsible counselor</div></div>
                  </div>

                  <div>
                    <div className={clsx('text-xs font-semibold', new Date(task.due_at || 0).getTime() < Date.now() ? 'text-rose-600' : 'text-slate-800')}>{dueLabel(task.task_type, task.due_at)}</div>
                    <div className="mt-1 text-[10px] text-slate-400">{task.due_at ? formatISTCompact(task.due_at) : '-'}</div>
                    {task.meeting_mode && <div className="mt-1 text-[10px] text-slate-500">{humanize(task.meeting_mode)}</div>}
                  </div>

                  <Link href={destination} className="btn-outline inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold group-hover:border-brand-200 group-hover:text-brand-700">
                    {task.lead_id ? 'Open Lead' : 'View Meetings'} <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </article>
              );
            })}
          </div>
        )}

        {data && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-xs text-slate-500">
            <span>Page {data.page} of {totalPages}</span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)} className="btn-outline inline-flex items-center gap-1 rounded-lg px-3 py-1.5 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /> Previous</button>
              <button type="button" disabled={page >= totalPages} onClick={() => changePage(page + 1)} className="btn-outline inline-flex items-center gap-1 rounded-lg px-3 py-1.5 disabled:opacity-40">Next <ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
