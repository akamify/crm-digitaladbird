'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { clsx } from '@/lib/format';
import {
  businessToday,
  formatAnalyticsPeriod,
  rangeDays,
  shiftAnalyticsScope,
  shiftBusinessDate,
} from '@/lib/leadAnalytics';
import type { LeadAnalyticsScope } from '@/types';

interface Props {
  scope: LeadAnalyticsScope;
  onChange: (scope: LeadAnalyticsScope) => void;
}

function presetRange(preset: string): LeadAnalyticsScope {
  const today = businessToday();
  if (preset === 'yesterday') {
    const date = shiftBusinessDate(today, -1);
    return { view: 'daily', from: date, to: date };
  }
  if (preset === 'last_7') return { view: 'daily', from: shiftBusinessDate(today, -6), to: today };
  if (preset === 'last_30') return { view: 'daily', from: shiftBusinessDate(today, -29), to: today };
  if (preset === 'month') return { view: 'daily', from: `${today.slice(0, 7)}-01`, to: today };
  return { view: 'daily', from: today, to: today };
}

export function LeadAnalyticsPeriodControl({ scope, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(scope.from || businessToday());
  const [draftTo, setDraftTo] = useState(scope.to || scope.from || businessToday());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const today = businessToday();
  const forwardScope = shiftAnalyticsScope(scope, 1);
  const canMoveForward = scope.view === 'daily' && Boolean(forwardScope.to && forwardScope.to <= today);

  useEffect(() => {
    setDraftFrom(scope.from || today);
    setDraftTo(scope.to || scope.from || today);
  }, [scope.from, scope.to, today]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function applyDraft() {
    if (!draftFrom || !draftTo || draftFrom > draftTo || draftTo > today) return;
    const next = { view: 'daily' as const, from: draftFrom, to: draftTo };
    if (rangeDays(next) > 366) return;
    onChange(next);
    setOpen(false);
  }

  function move(direction: -1 | 1) {
    const shifted = shiftAnalyticsScope(scope, direction);
    if (direction === 1 && shifted.to && shifted.to > today) return;
    onChange(shifted);
  }

  return (
    <div ref={rootRef} className="relative flex items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      {scope.view === 'daily' && (
          <button type="button" onClick={() => move(-1)} aria-label="Previous period" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100">
            <ChevronLeft className="h-4 w-4" />
          </button>
      )}
      <button type="button" onClick={() => setOpen(value => !value)} className="inline-flex min-w-40 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50" aria-haspopup="dialog" aria-expanded={open}>
        <CalendarDays className="h-4 w-4 text-brand-600" /><span>{scope.view === 'all_time' ? 'All Time' : formatAnalyticsPeriod(scope)}</span>
      </button>
      {scope.view === 'daily' && (
        <>
          <button type="button" disabled={!canMoveForward} onClick={() => move(1)} aria-label="Next period" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onChange(presetRange('today'))} className={clsx(
            'ml-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
            scope.from === today && scope.to === today ? 'bg-brand-600 text-white' : 'text-brand-700 hover:bg-brand-50',
          )}>Today</button>
        </>
      )}

      {open && (
        <div role="dialog" aria-label="Select analytics period" className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(92vw,420px)] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-300/50">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Time period</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <button type="button" onClick={() => { onChange({ view: 'all_time', from: null, to: null }); setOpen(false); }} className={clsx('rounded-lg border px-3 py-2 text-xs font-medium', scope.view === 'all_time' ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-700 hover:border-brand-200 hover:bg-brand-50')}>All Time</button>
            {[['today', 'Today'], ['yesterday', 'Yesterday'], ['last_7', 'Last 7 Days'], ['last_30', 'Last 30 Days'], ['month', 'This Month']].map(([key, label]) => (
              <button key={key} type="button" onClick={() => { onChange(presetRange(key)); setOpen(false); }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700">{label}</button>
            ))}
          </div>
          <div className="my-4 h-px bg-slate-100" />
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-slate-600">From<input type="date" value={draftFrom} max={today} onChange={event => setDraftFrom(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm text-slate-800 outline-none focus:border-brand-400" /></label>
            <label className="text-xs font-medium text-slate-600">To<input type="date" value={draftTo} min={draftFrom} max={today} onChange={event => setDraftTo(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm text-slate-800 outline-none focus:border-brand-400" /></label>
          </div>
          <div className="mt-2 min-h-4 text-[11px] text-rose-600">{draftFrom > draftTo ? 'From must be before To.' : draftTo > today ? 'Future dates are not available.' : rangeDays({ view: 'daily', from: draftFrom, to: draftTo }) > 366 ? 'Select 366 days or fewer.' : ''}</div>
          <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="btn-ghost rounded-lg px-3 py-2 text-xs">Cancel</button><button type="button" onClick={applyDraft} disabled={!draftFrom || !draftTo || draftFrom > draftTo || draftTo > today || rangeDays({ view: 'daily', from: draftFrom, to: draftTo }) > 366} className="btn-primary rounded-lg px-3 py-2 text-xs disabled:opacity-50">Apply Period</button></div>
        </div>
      )}
    </div>
  );
}
