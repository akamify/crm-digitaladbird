'use client';
import { useState } from 'react';
import {
  Trophy, Users, Crown, TrendingUp, Star, Award, Zap,
  ChevronDown, RefreshCw, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { Skeleton, EmptyState } from '@/components/ui/Modal';
import { MovementIndicator, ScoreBadge, AppreciationBadges } from '@/components/rankings/RankBadge';
import {
  useRankings, useMyRank, useComputeRankings, useGiveAppreciation,
  RANK_LABELS, BADGE_MAP,
  type RankScope, type RankPeriod, type RankedEntry,
} from '@/hooks/useRankings';
import { useAuth } from '@/lib/auth';
import { clsx, initials } from '@/lib/format';

const SCOPES: { key: RankScope; label: string; icon: typeof Users }[] = [
  { key: 'overall',  label: 'Company',  icon: Crown },
  { key: 'member',   label: 'Members',  icon: Users },
  { key: 'rm',       label: 'RMs',      icon: Award },
  { key: 'partner',  label: 'Partners', icon: Star },
  { key: 'team',     label: 'Teams',    icon: Trophy },
];

const PERIODS: { key: RankPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week',  label: 'This Week' },
  { key: 'month', label: 'This Month' },
];

const PODIUM_SIZE = ['h-28', 'h-24', 'h-20'];
const PODIUM_BG = [
  'bg-gradient-to-b from-amber-400 to-yellow-500',
  'bg-gradient-to-b from-slate-300 to-slate-400',
  'bg-gradient-to-b from-amber-600 to-orange-500',
];
const PODIUM_RING = [
  'ring-4 ring-amber-300 shadow-lg shadow-amber-200/50',
  'ring-4 ring-slate-300 shadow-lg shadow-slate-200/50',
  'ring-4 ring-orange-300 shadow-lg shadow-orange-200/50',
];

export default function LeaderboardPage() {
  return (
    <AppShell title="Leaderboard" subtitle="Top 10 Performance Rankings">
      <LeaderboardInner />
    </AppShell>
  );
}

function LeaderboardInner() {
  const { user } = useAuth();
  const [scope, setScope] = useState<RankScope>('overall');
  const [period, setPeriod] = useState<RankPeriod>('today');
  const rankings = useRankings(scope, period);
  const myRank = useMyRank();
  const compute = useComputeRankings();

  const data = rankings.data ?? [];
  const top3 = data.slice(0, 3);
  const rest = data.slice(3);
  const isAdmin = user?.role === 'super_admin';
  const isRm = user?.role === 'rm';

  const myOverall = myRank.data?.ranks?.find(r => r.scope === 'overall');
  const myScoped = myRank.data?.ranks?.find(r => r.scope === scope);

  return (
    <div className="space-y-6">
      {/* My Rank Banner */}
      {myOverall && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-brand-200 bg-gradient-to-r from-brand-50 to-violet-50 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-brand-600 text-lg font-bold text-white shadow-glow">
              #{myOverall.rank_position}
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">Your Overall Rank</div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>{RANK_LABELS[myOverall.rank_position - 1]?.emoji} {RANK_LABELS[myOverall.rank_position - 1]?.label}</span>
                <MovementIndicator movement={myOverall.movement} prev={myOverall.prev_position} current={myOverall.rank_position} />
              </div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <ScoreBadge score={myOverall.score} />
            {myRank.data?.badges?.map(b => (
              <span key={b.badge_type} className="text-lg" title={BADGE_MAP[b.badge_type]?.label}>
                {BADGE_MAP[b.badge_type]?.emoji}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          {SCOPES.map(s => {
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                onClick={() => setScope(s.key)}
                className={clsx(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition',
                  scope === s.key ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {s.label}
              </button>
            );
          })}
        </div>

        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={clsx(
                'rounded-md px-3 py-1.5 text-xs font-medium transition',
                period === p.key ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {isAdmin && (
          <button
            onClick={() => compute.mutate(undefined, {
              onSuccess: d => toast.success(`Rankings computed: ${d.computed} entries`),
              onError: () => toast.error('Failed to compute rankings'),
            })}
            disabled={compute.isPending}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition disabled:opacity-50"
          >
            <RefreshCw className={clsx('h-3.5 w-3.5', compute.isPending && 'animate-spin')} />
            Refresh Rankings
          </button>
        )}
      </div>

      {/* KPIs from my rank */}
      {myRank.data?.ranks && myRank.data.ranks.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {myRank.data.ranks.slice(0, 4).map(r => (
            <KpiCard
              key={r.scope}
              label={`${r.scope.charAt(0).toUpperCase() + r.scope.slice(1)} Rank`}
              value={`#${r.rank_position}`}
              delta={`${Number(r.score).toLocaleString()} pts`}
              trend={r.movement === 'up' ? 'up' : r.movement === 'down' ? 'down' : undefined}
              accent={r.rank_position <= 3 ? 'green' : r.rank_position <= 7 ? 'pink' : 'amber'}
              icon={<Trophy className="h-5 w-5" />}
            />
          ))}
        </div>
      )}

      {/* Podium — Top 3 */}
      {rankings.isLoading ? (
        <Skeleton className="h-72" />
      ) : top3.length >= 3 ? (
        <div className="card-padded">
          <div className="flex items-center justify-center gap-4 pt-8 pb-4">
            {[1, 0, 2].map(idx => {
              const entry = top3[idx];
              if (!entry) return null;
              return (
                <div key={entry.user_id} className="flex flex-col items-center">
                  <div className={clsx(
                    'relative grid h-16 w-16 place-items-center rounded-full bg-white text-lg font-bold',
                    PODIUM_RING[idx],
                  )}>
                    {initials(entry.full_name)}
                    <span className="absolute -top-2 -right-2 grid h-7 w-7 place-items-center rounded-full bg-white text-sm shadow-md">
                      {entry.rank_label?.emoji}
                    </span>
                  </div>
                  <div className="mt-3 text-center">
                    <div className="text-sm font-semibold text-slate-900">{entry.full_name}</div>
                    <div className="text-[10px] text-slate-500">{entry.rank_label?.label}</div>
                    <ScoreBadge score={entry.score} />
                    <div className="mt-1">
                      <MovementIndicator movement={entry.movement} prev={entry.prev_position} current={entry.rank_position} />
                    </div>
                  </div>
                  <div className={clsx('mt-3 w-20 rounded-t-lg', PODIUM_BG[idx], PODIUM_SIZE[idx])} />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Full Ranking Table */}
      <div className="card-padded">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Top 10 {SCOPES.find(s => s.key === scope)?.label} Rankings
          </h2>
          <span className="text-xs text-slate-500">{period === 'today' ? 'Today' : period === 'week' ? 'This Week' : 'This Month'}</span>
        </div>

        {rankings.isLoading ? (
          <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : data.length === 0 ? (
          <EmptyState
            title="No rankings yet"
            description="Rankings are computed daily based on real CRM activity. Click 'Refresh Rankings' to generate."
            icon={<Trophy className="h-6 w-6" />}
          />
        ) : (
          <div className="space-y-2">
            {data.map((entry, i) => (
              <RankRow key={entry.user_id || entry.team_name || i} entry={entry} index={i} isAdmin={isAdmin} isRm={isRm} scope={scope} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RankRow({ entry, index, isAdmin, isRm, scope }: { entry: RankedEntry; index: number; isAdmin: boolean; isRm: boolean; scope: RankScope }) {
  const [showAppreciation, setShowAppreciation] = useState(false);
  const give = useGiveAppreciation();
  const pos = index + 1;
  const label = RANK_LABELS[index] || null;

  const bgCls = pos === 1 ? 'bg-gradient-to-r from-amber-50 to-yellow-50 border-amber-200'
    : pos === 2 ? 'bg-gradient-to-r from-slate-50 to-gray-50 border-slate-200'
    : pos === 3 ? 'bg-gradient-to-r from-orange-50 to-amber-50 border-orange-200'
    : 'bg-white border-slate-200';

  return (
    <div className={clsx('relative flex items-center gap-4 rounded-xl border px-4 py-3 transition hover:shadow-md', bgCls)}>
      {/* Rank number */}
      <div className={clsx(
        'grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold',
        pos <= 3 ? PODIUM_BG[pos - 1] + ' text-white shadow-sm' : 'bg-slate-100 text-slate-700',
      )}>
        {pos}
      </div>

      {/* Avatar */}
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
        {initials(entry.full_name)}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900 truncate">{scope === 'team' ? entry.team_name : entry.full_name}</span>
          {label && <span className="text-sm">{label.emoji}</span>}
          <span className="hidden sm:inline text-[10px] font-medium text-slate-500">{label?.label}</span>
          <MovementIndicator movement={entry.movement} prev={entry.prev_position} current={entry.rank_position} />
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
          {scope !== 'team' && <span>{entry.role}</span>}
          {entry.user_team && <span className="text-slate-400">{entry.user_team}</span>}
          <span>Conv: {entry.leads_converted}</span>
          <span>Calls: {entry.calls_made}</span>
          <span>F/U: {entry.followups_done}</span>
          <span className="text-emerald-600 font-medium">{entry.conv_rate}%</span>
        </div>
      </div>

      {/* Score + badges */}
      <div className="flex items-center gap-3 shrink-0">
        {entry.latest_badges && entry.latest_badges.length > 0 && (
          <AppreciationBadges badges={entry.latest_badges.map(b => ({ badge_type: b.badge_type, count: '1' }))} />
        )}
        <ScoreBadge score={entry.score} />

        {/* Appreciation button */}
        {(isAdmin || isRm) && scope !== 'team' && (
          <div className="relative">
            <button
              onClick={() => setShowAppreciation(!showAppreciation)}
              className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-brand-600 transition"
              title="Give Appreciation"
            >
              <Star className="h-3.5 w-3.5" />
            </button>
            {showAppreciation && (
              <div className="absolute right-0 top-10 z-50 w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-2 py-1">Give Badge</div>
                {Object.entries(BADGE_MAP).map(([key, val]) => (
                  <button
                    key={key}
                    onClick={() => {
                      give.mutate(
                        { to_user_id: entry.user_id, badge_type: key, note: `Awarded to #${pos} performer` },
                        {
                          onSuccess: () => { toast.success(`${val.emoji} Badge given to ${entry.full_name}!`); setShowAppreciation(false); },
                          onError: () => toast.error('Failed to give appreciation'),
                        },
                      );
                    }}
                    disabled={give.isPending}
                    className={clsx(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium transition hover:bg-slate-50',
                      val.color,
                    )}
                  >
                    <span className="text-sm">{val.emoji}</span> {val.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
