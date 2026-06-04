'use client';
import { ReactNode } from 'react';
import { clsx } from '@/lib/format';

interface KpiCardProps {
  label: string;
  value: string | number;
  delta?: string;
  trend?: 'up' | 'down' | 'flat';
  icon?: ReactNode;
  accent?: 'pink' | 'blue' | 'green' | 'amber' | 'slate';
}

const accentClass: Record<NonNullable<KpiCardProps['accent']>, string> = {
  pink:  'kpi-accent-pink',
  blue:  'kpi-accent-blue',
  green: 'kpi-accent-green',
  amber: 'kpi-accent-amber',
  slate: 'kpi-accent-slate',
};

export function KpiCard({ label, value, delta, trend, icon, accent = 'pink' }: KpiCardProps) {
  return (
    <div className="card card-hover flex items-center gap-3 sm:gap-4 p-4 sm:p-5 cursor-pointer">
      {icon && (
        <div className={clsx('grid h-10 w-10 sm:h-12 sm:w-12 place-items-center rounded-xl shadow-md shrink-0', accentClass[accent])}>
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-500 truncate">{label}</div>
        <div className="mt-1 font-display text-2xl sm:text-3xl font-bold tabular-nums text-slate-900 leading-tight truncate">{value}</div>
        {delta && (
          <div className={clsx(
            'mt-1 text-[11px] sm:text-xs font-medium truncate',
            trend === 'up' && 'text-emerald-600',
            trend === 'down' && 'text-rose-600',
            (!trend || trend === 'flat') && 'text-slate-500',
          )}>
            {delta}
          </div>
        )}
      </div>
    </div>
  );
}
