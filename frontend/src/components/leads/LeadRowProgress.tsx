'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { WorkflowEvent } from '@/hooks/useCounselorWorkflow';
import { journeyStep } from './CounselorJourneyTracker';
import { fmtDate } from '@/lib/format';

export function countdownText(due: string, now: number): string {
  const timestamp = Date.parse(due);
  if (!Number.isFinite(timestamp)) return 'Deadline unavailable';
  const seconds = Math.max(0, Math.ceil((timestamp - now) / 1000));
  if (!seconds) return 'Due now — awaiting update';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds / 3600) % 24;
  const minutes = Math.floor(seconds / 60) % 60;
  return `${days ? `${days}d ` : ''}${hours || days ? `${hours}h ` : ''}${minutes}m ${String(seconds % 60).padStart(2, '0')}s remaining`;
}

export function LeadDeadline({ due }: { due: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [due]);
  return <span className="min-w-0 text-xs text-slate-600">
    <span className="block">{fmtDate(due, 'd MMM, h:mm a')}</span>
    <span className="block tabular-nums" aria-live="off">{now === null ? 'Calculating remaining time…' : countdownText(due, now)}</span>
  </span>;
}

export function LeadRowJourney({ events, currentStatus, href }: { events: WorkflowEvent[]; currentStatus?: string | null; href: string }) {
  const steps = events.map(event => ({ event, label: journeyStep(event) })).filter(step => step.label);
  // Only the most recent occurrence of the authoritative current remark is current.
  let currentId: string | undefined;
  for (const { event } of steps) if (event.event_type === 'remark_saved' && event.primary_status === currentStatus) currentId = event.id;
  return <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
    <ol aria-label="Recent journey history" className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-slate-600">
      {steps.slice(-5).map(({ event, label }, index) => <li key={event.id} className="inline-flex max-w-full items-center gap-1 break-words">
        {index > 0 && <span aria-hidden="true">→</span>}
        <span aria-current={event.id === currentId ? 'step' : undefined} title={fmtDate(event.occurred_at, 'd MMM yyyy, h:mm a')} className={`rounded px-1.5 py-1 ${event.id === currentId ? 'bg-emerald-100 font-medium text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
          {label}{event.id === currentId && <span className="ml-1 text-[10px]">· Current</span>}
        </span>
      </li>)}
    </ol>
    <Link href={href} className="inline-flex min-h-9 items-center text-xs font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900">View timeline</Link>
  </div>;
}
