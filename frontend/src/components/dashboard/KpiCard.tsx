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

const accentBg: Record<NonNullable<KpiCardProps['accent']>, string> = {
  pink:  'bg-blue-50   text-blue-700',
  blue:  'bg-sky-50    text-sky-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50   text-amber-700',
  slate: 'bg-slate-100  text-slate-700',
};

export function KpiCard({ label, value, delta, trend, icon, accent = 'pink' }: KpiCardProps) {
  return (
    <div className="card flex items-center gap-4 p-5">
      {icon && (
        <div className={clsx('grid h-11 w-11 place-items-center rounded-lg', accentBg[accent])}>
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</div>
        <div className="mt-1 font-display text-2xl font-semibold text-slate-900">{value}</div>
        {delta && (
          <div className={clsx(
            'mt-0.5 text-xs',
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
