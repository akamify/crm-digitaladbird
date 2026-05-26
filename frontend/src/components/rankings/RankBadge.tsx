'use client';
import { useUserBadge, RANK_LABELS, BADGE_MAP } from '@/hooks/useRankings';
import { clsx } from '@/lib/format';

const RANK_COLORS = [
  'bg-gradient-to-r from-amber-400 to-yellow-500 text-white shadow-amber-200',
  'bg-gradient-to-r from-slate-300 to-slate-400 text-white shadow-slate-200',
  'bg-gradient-to-r from-amber-600 to-orange-500 text-white shadow-orange-200',
  'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-blue-200',
  'bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-violet-200',
];

function rankColor(pos: number) {
  if (pos <= 5) return RANK_COLORS[pos - 1];
  return 'bg-slate-100 text-slate-700';
}

const MOVEMENT_ICON: Record<string, { icon: string; cls: string }> = {
  up:     { icon: '▲', cls: 'text-emerald-500' },
  down:   { icon: '▼', cls: 'text-rose-500' },
  new:    { icon: '★', cls: 'text-amber-500' },
  stable: { icon: '—', cls: 'text-slate-400' },
};

export function RankBadge({ userId, size = 'sm' }: { userId: string; size?: 'sm' | 'md' | 'lg' }) {
  const { data } = useUserBadge(userId);
  if (!data?.rank) return null;

  const pos = data.rank.rank_position;
  const label = data.label;
  const move = MOVEMENT_ICON[data.rank.movement] || MOVEMENT_ICON.stable;

  if (size === 'sm') {
    return (
      <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold shadow-sm', rankColor(pos))}>
        #{pos} {label?.emoji}
      </span>
    );
  }

  if (size === 'md') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold shadow-sm', rankColor(pos))}>
          #{pos} {label?.emoji}
        </span>
        <span className="text-[10px] font-medium text-slate-500">{label?.label}</span>
        <span className={clsx('text-[10px] font-bold', move.cls)}>{move.icon}</span>
      </span>
    );
  }

  return (
    <div className="inline-flex items-center gap-2">
      <span className={clsx('inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-sm font-bold shadow-sm', rankColor(pos))}>
        #{pos} {label?.emoji} {label?.label}
      </span>
      <span className={clsx('text-xs font-bold', move.cls)}>{move.icon}</span>
      {data.badges.length > 0 && (
        <span className="inline-flex items-center gap-0.5">
          {data.badges.slice(0, 3).map(b => (
            <span key={b.badge_type} className="text-sm" title={BADGE_MAP[b.badge_type]?.label}>
              {BADGE_MAP[b.badge_type]?.emoji}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

export function MovementIndicator({ movement, prev, current }: { movement: string; prev: number | null; current: number }) {
  const move = MOVEMENT_ICON[movement] || MOVEMENT_ICON.stable;
  const diff = prev ? Math.abs(prev - current) : 0;

  return (
    <span className={clsx('inline-flex items-center gap-0.5 text-xs font-bold', move.cls)}>
      {move.icon}
      {movement === 'up' && diff > 0 && <span>+{diff}</span>}
      {movement === 'down' && diff > 0 && <span>-{diff}</span>}
      {movement === 'new' && <span className="text-[10px] font-semibold uppercase">new</span>}
    </span>
  );
}

export function ScoreBadge({ score }: { score: string | number }) {
  const s = Number(score);
  const color = s >= 50 ? 'text-emerald-700 bg-emerald-50' : s >= 20 ? 'text-blue-700 bg-blue-50' : 'text-slate-600 bg-slate-50';
  return (
    <span className={clsx('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold tabular-nums', color)}>
      {s.toLocaleString()} pts
    </span>
  );
}

export function AppreciationBadges({ badges }: { badges: Array<{ badge_type: string; count: string }> }) {
  if (!badges?.length) return null;
  return (
    <span className="inline-flex items-center gap-0.5">
      {badges.map(b => {
        const info = BADGE_MAP[b.badge_type];
        return (
          <span key={b.badge_type} className={clsx('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium', info?.color || 'bg-slate-100 text-slate-600')} title={`${info?.label} × ${b.count}`}>
            {info?.emoji} {Number(b.count) > 1 && `×${b.count}`}
          </span>
        );
      })}
    </span>
  );
}
