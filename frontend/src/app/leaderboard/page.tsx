'use client';

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import {
  BarChart3, Clock, Loader2, Medal, RefreshCw,
  Target, Trophy, Users,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, Skeleton } from '@/components/ui/Modal';
import { useAuth } from '@/lib/auth';
import { clsx, humanize, initials } from '@/lib/format';
import { formatISTCompact, formatISTTooltip } from '@/lib/date';
import {
  useLeaderboard,
  type LeaderboardEntry,
  type LeaderboardPeriod,
  type LeaderboardScope,
} from '@/hooks/useRankings';

const PERIODS: { key: LeaderboardPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'all_time', label: 'All Time' },
];

const ADMIN_SCOPES: { key: LeaderboardScope; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'rms', label: 'RMs' },
  { key: 'members', label: 'Members' },
  { key: 'partners', label: 'Partners' },
];

const PODIUM_ORDER = [1, 0, 2];

export default function LeaderboardPage() {
  return (
    <AppShell title="Leaderboard" subtitle="Performance ranking from CRM activity">
      <LeaderboardInner />
    </AppShell>
  );
}

function LeaderboardInner() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin';
  const isRm = user?.role === 'rm';
  const scopes = useMemo(() => {
    if (isAdmin) return ADMIN_SCOPES;
    if (isRm) return [
      { key: 'team' as LeaderboardScope, label: 'My Team' },
      { key: 'rms' as LeaderboardScope, label: 'RM Ranking' },
    ];
    return [{ key: 'team' as LeaderboardScope, label: 'My Team' }];
  }, [isAdmin, isRm]);

  const [scope, setScope] = useState<LeaderboardScope>(isAdmin ? 'all' : 'team');
  const [period, setPeriod] = useState<LeaderboardPeriod>('this_month');
  const leaderboard = useLeaderboard(scope, period, 20);
  const pages = leaderboard.data?.pages || [];
  const entries = pages.flatMap((page) => page.data || []);
  const summary = pages[0]?.summary;
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  const subtitle = isAdmin
    ? 'Overall CRM performance ranking'
    : isRm
      ? 'Your team performance ranking'
      : 'Your team leaderboard';

  return (
    <div className="space-y-5">
      <header className="rounded-xl border border-slate-200 bg-white px-2 py-4 shadow-sm">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="font-display text-2xl font-semibold text-slate-900">Leaderboard</h1>
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              items={scopes}
              value={scope}
              onChange={(next) => setScope(next as LeaderboardScope)}
            />
            <SegmentedControl
              items={PERIODS}
              value={period}
              onChange={(next) => setPeriod(next as LeaderboardPeriod)}
            />
            <button
              type="button"
              onClick={() => leaderboard.refetch()}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw className={clsx('h-3.5 w-3.5', leaderboard.isFetching && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricTile label="Ranked Users" value={summary?.total_ranked_users ?? entries.length} icon={<Users className="h-4 w-4" />} />
          <MetricTile label="Scope" value={scopeLabel(scope)} icon={<Target className="h-4 w-4" />} />
          <MetricTile label="Period" value={periodLabel(period)} icon={<Clock className="h-4 w-4" />} />
          <MetricTile label="Formula" value="CRM performance" icon={<BarChart3 className="h-4 w-4" />} />
        </div>
      </header>

      {leaderboard.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-96" />
        </div>
      ) : leaderboard.isError ? (
        <EmptyState
          title="Could not load leaderboard"
          description={leaderboardError(leaderboard.error)}
          icon={<Trophy className="h-6 w-6" />}
          action={<button className="btn-primary rounded-lg px-4 py-2 text-sm" onClick={() => leaderboard.refetch()}>Retry</button>}
        />
      ) : entries.length === 0 ? (
        <EmptyState
          title="No leaderboard data found for this period."
          description="Performance rankings will appear after leads, calls, and follow-ups are recorded."
          icon={<Trophy className="h-6 w-6" />}
        />
      ) : (
        <>
          <TopPerformers entries={top3} />
          <LeaderboardList entries={rest} />
          <div className="flex justify-center">
            {leaderboard.hasNextPage ? (
              <button
                type="button"
                onClick={() => leaderboard.fetchNextPage()}
                disabled={leaderboard.isFetchingNextPage}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {leaderboard.isFetchingNextPage ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Load More
              </button>
            ) : (
              <span className="text-xs text-slate-400">You are all caught up.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TopPerformers({ entries }: { entries: LeaderboardEntry[] }) {
  if (!entries.length) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Trophy className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold text-slate-900">Top Performers</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-3 md:items-end">
        {PODIUM_ORDER.map((idx) => {
          const entry = entries[idx];
          if (!entry) return <div key={idx} />;
          return <PodiumCard key={entry.user_id} entry={entry} featured={idx === 0} />;
        })}
      </div>
    </section>
  );
}

function PodiumCard({ entry, featured }: { entry: LeaderboardEntry; featured: boolean }) {
  return (
    <div className={clsx(
      'rounded-xl border p-4 text-center',
      featured ? 'border-amber-200 bg-amber-50 md:pb-8' : 'border-slate-200 bg-slate-50',
    )}>
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white text-sm font-semibold text-slate-800 shadow-sm">
        {initials(entry.name)}
      </div>
      <div className="mt-3 flex items-center justify-center gap-1 text-xs font-semibold text-amber-700">
        <Medal className="h-3.5 w-3.5" /> Rank #{entry.rank}
      </div>
      <h3 className="mt-1 truncate text-sm font-semibold text-slate-900" title={entry.name}>{entry.name}</h3>
      <p className="text-xs text-slate-500">{humanize(entry.role)}{entry.team_name ? ` - ${entry.team_name}` : ''}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <MiniStat label="Score" value={entry.performance_score} />
        <MiniStat label="Conv." value={entry.converted_leads} />
        <MiniStat label="Rate" value={`${entry.conversion_rate}%`} />
      </div>
      <span className="mt-3 inline-flex rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm">
        {entry.badge}
      </span>
    </div>
  );
}

function LeaderboardList({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="sticky top-0 z-10 grid grid-cols-[64px_1.4fr_repeat(5,minmax(90px,1fr))] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 max-lg:hidden">
        <span>Rank</span>
        <span>Name</span>
        <span>Total</span>
        <span>Converted</span>
        <span>Completed</span>
        <span>Contacted</span>
        <span>Score</span>
      </div>
      <div className="divide-y divide-slate-100">
        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">Only top performers are available for this period.</div>
        ) : entries.map((entry) => <LeaderboardRow key={entry.user_id} entry={entry} />)}
      </div>
    </section>
  );
}

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  return (
    <article className="grid gap-3 px-4 py-3 lg:grid-cols-[64px_1.4fr_repeat(5,minmax(90px,1fr))] lg:items-center">
      <div className="flex items-center gap-3 lg:block">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-sm font-bold text-slate-700">#{entry.rank}</span>
        <div className="min-w-0 lg:hidden">
          <h3 className="truncate text-sm font-semibold text-slate-900">{entry.name}</h3>
          <p className="text-xs text-slate-500">{humanize(entry.role)}{entry.team_name ? ` - ${entry.team_name}` : ''}</p>
        </div>
      </div>
      <div className="hidden min-w-0 lg:block">
        <h3 className="truncate text-sm font-semibold text-slate-900" title={entry.name}>{entry.name}</h3>
        <p className="text-xs text-slate-500">
          {humanize(entry.role)}
          {entry.team_name ? ` - ${entry.team_name}` : ''}
          {entry.rm_name ? ` - RM: ${entry.rm_name}` : ''}
        </p>
      </div>
      <MetricText value={entry.total_leads} label="Total" />
      <MetricText value={entry.converted_leads} label="Converted" />
      <MetricText value={entry.completed_leads} label="Completed" />
      <MetricText value={entry.contacted_leads} label="Contacted" />
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-brand-50 px-2 py-1 text-xs font-bold text-brand-700">{entry.performance_score} pts</span>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">{entry.badge}</span>
        {entry.last_activity_at && (
          <span className="text-[11px] text-slate-400" title={formatISTTooltip(entry.last_activity_at)}>
            {formatISTCompact(entry.last_activity_at)}
          </span>
        )}
      </div>
    </article>
  );
}

function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { key: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onChange(item.key)}
          className={clsx(
            'rounded-md px-3 py-1.5 text-xs font-medium transition',
            value === item.key ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function MetricTile({ label, value, icon }: { label: string; value: string | number; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-slate-500">{icon}{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-white px-2 py-1.5">
      <div className="font-semibold text-slate-900">{value}</div>
      <div className="text-[10px] uppercase text-slate-400">{label}</div>
    </div>
  );
}

function MetricText({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-slate-400 lg:hidden">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-slate-800">{value}</div>
    </div>
  );
}

function scopeLabel(scope: LeaderboardScope) {
  if (scope === 'rms') return 'RMs';
  if (scope === 'members') return 'Members';
  if (scope === 'partners') return 'Partners';
  if (scope === 'team') return 'Team';
  return 'All';
}

function periodLabel(period: LeaderboardPeriod) {
  return PERIODS.find((item) => item.key === period)?.label || 'This Month';
}

function leaderboardError(error: unknown) {
  return (error as { response?: { data?: { message?: string; error?: { message?: string } } } })?.response?.data?.message
    || (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
    || 'Please try again.';
}
