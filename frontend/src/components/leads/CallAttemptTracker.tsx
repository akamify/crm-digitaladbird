'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Loader2, Lock, PhoneCall, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import type { CallAttemptSequenceSummary, CallAttemptStateSummary, CallAttemptSummary, NextScheduledCallSummary } from '@/types';
import { humanize, clsx } from '@/lib/format';
import { useCompleteCallAttempt } from '@/hooks/useWorkflow';
import { formatCompactDateTime, formatDateTimeTooltip } from './leadProfileUtils';

const OUTCOME_LABELS: Record<string, string> = {
  call_received: 'Call received',
  cnr: 'Not received',
  busy: 'Busy',
  cb: 'Call busy',
  cw: 'Call waiting',
  nn: 'No network',
  so: 'Switch off',
  nc: 'Not connected',
  rnr: 'Ringing no response',
  recall: 'Recall',
  call_cut_busy: 'Call cut / busy',
  in: 'Invalid number',
  not_interested: 'Not interested',
  follow_up: 'Follow-up',
  callback_requested: 'Callback requested',
};

const OTHER_OUTCOMES = [
  'busy',
  'cb',
  'cw',
  'nn',
  'so',
  'nc',
  'rnr',
  'recall',
  'call_cut_busy',
  'in',
  'not_interested',
] as const;

type Props = {
  leadId: string;
  sequence: CallAttemptSequenceSummary | null | undefined;
  attempts: CallAttemptSummary[] | undefined;
  callAttemptState: CallAttemptStateSummary | null | undefined;
  nextScheduledCall: NextScheduledCallSummary | null | undefined;
};

function formatMinutes(minutes: number | null | undefined) {
  if (minutes == null) return '';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function deriveState(attempt: CallAttemptSummary | null | undefined, nowMs: number) {
  if (!attempt) return { uiState: 'waiting' as const, isActionable: false, availableInMinutes: null, overdueByMinutes: null };
  if (attempt.status === 'completed') return { uiState: 'completed' as const, isActionable: false, availableInMinutes: null, overdueByMinutes: attempt.delay_minutes ?? null };
  if (attempt.status === 'cancelled') return { uiState: 'cancelled' as const, isActionable: false, availableInMinutes: null, overdueByMinutes: null };

  const scheduledMs = new Date(attempt.scheduled_at).getTime();
  const diffMinutes = Math.floor((nowMs - scheduledMs) / 60000);
  if (diffMinutes < 0) {
    return {
      uiState: 'locked' as const,
      isActionable: false,
      availableInMinutes: Math.abs(diffMinutes),
      overdueByMinutes: null,
    };
  }
  if (diffMinutes === 0) {
    return { uiState: 'due' as const, isActionable: true, availableInMinutes: 0, overdueByMinutes: 0 };
  }
  return { uiState: 'overdue' as const, isActionable: true, availableInMinutes: 0, overdueByMinutes: diffMinutes };
}

function getSlotLabel(position: number, isFinalAttempt: boolean) {
  if (isFinalAttempt || position === 4) return 'Final recovery';
  return `Attempt ${position}`;
}

function getSlotClasses(uiState: string) {
  if (uiState === 'completed') return 'border-green-200 bg-green-50';
  if (uiState === 'due') return 'border-amber-200 bg-amber-50';
  if (uiState === 'overdue') return 'border-rose-200 bg-rose-50';
  if (uiState === 'locked') return 'border-brand-200 bg-brand-50/60';
  if (uiState === 'cancelled') return 'border-slate-200 bg-slate-50';
  return 'border-slate-200 bg-slate-50/70';
}

function getIndicator(uiState: string) {
  if (uiState === 'completed') return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (uiState === 'due') return <PhoneCall className="h-4 w-4 text-amber-600" />;
  if (uiState === 'overdue') return <AlertTriangle className="h-4 w-4 text-rose-600" />;
  if (uiState === 'locked') return <Lock className="h-4 w-4 text-brand-600" />;
  return <Clock3 className="h-4 w-4 text-slate-400" />;
}

export function CallAttemptTracker({ leadId, sequence, attempts, callAttemptState, nextScheduledCall }: Props) {
  const completeAttempt = useCompleteCallAttempt();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const attemptList = useMemo(() => attempts ?? [], [attempts]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const maxAttempts = sequence?.max_attempts || callAttemptState?.max_attempts || 4;
  const slots = useMemo(() => {
    const built: Array<{ slot: number; attempt: CallAttemptSummary | null }> = [];
    for (let slot = 1; slot <= maxAttempts; slot += 1) {
      built.push({
        slot,
        attempt: attemptList.find(item => item.attempt_number === slot) || null,
      });
    }
    return built;
  }, [attemptList, maxAttempts]);

  const activeAttempt = useMemo(
    () => attemptList.find(item => item.status === 'scheduled') || null,
    [attemptList],
  );
  const activeAttemptState = deriveState(activeAttempt, nowMs);

  if (!sequence || attemptList.length === 0) return null;

  async function handleOutcome(outcome: string) {
    if (!activeAttempt) return;
    try {
      await completeAttempt.mutateAsync({
        leadId,
        attemptId: activeAttempt.id,
        outcome,
      });
      toast.success(outcome === 'call_received' ? 'Communication completed' : 'Call attempt saved');
    } catch (error: unknown) {
      const message = typeof error === 'object' && error && 'response' in error
        ? (error as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      toast.error(message || 'Failed to save call attempt');
    }
  }

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Call Attempts</p>
          <p className="mt-1 text-xs text-slate-500">
            {sequence.has_active_sequence
              ? nextScheduledCall?.is_overdue
                ? `Overdue call tracked for ${humanize(nextScheduledCall.trigger_reason)}`
                : nextScheduledCall
                  ? `Next call set for ${formatCompactDateTime(nextScheduledCall.scheduled_at)}`
                  : 'Sequence active'
              : sequence.status === 'completed'
                ? 'Sequence completed successfully'
                : sequence.status === 'cold_closed'
                  ? 'Sequence closed as cold / unresponsive'
                  : 'Sequence closed'}
          </p>
        </div>
        {sequence.has_active_sequence && callAttemptState?.active_attempt_number ? (
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-semibold text-brand-700">
            Attempt {callAttemptState.active_attempt_number} of {maxAttempts}
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {slots.map(({ slot, attempt }) => {
          const derived = deriveState(attempt, nowMs);
          const label = getSlotLabel(slot, !!attempt?.is_final_attempt || slot === maxAttempts);
          const outcomeLabel = attempt?.outcome ? (OUTCOME_LABELS[attempt.outcome] || humanize(attempt.outcome)) : null;
          return (
            <div
              key={slot}
              className={clsx(
                'rounded-xl border px-3 py-2.5 transition-colors',
                getSlotClasses(derived.uiState),
              )}
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 shadow-sm">
                  {getIndicator(derived.uiState)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-900">{label}</p>
                    {attempt?.attempt_number ? (
                      <span className="text-[10px] font-medium text-slate-500">#{attempt.attempt_number}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs font-medium text-slate-700">
                    {outcomeLabel || (attempt ? (OUTCOME_LABELS[attempt.trigger_reason] || humanize(attempt.trigger_reason)) : 'Waiting')}
                  </p>
                  {attempt ? (
                    <>
                      <p className="mt-1 text-[11px] text-slate-500" title={formatDateTimeTooltip(attempt.scheduled_at)}>
                        {attempt.status === 'completed'
                          ? formatCompactDateTime(attempt.attempted_at || attempt.scheduled_at)
                          : attempt.status === 'cancelled'
                            ? 'Cancelled'
                            : `Call at ${formatCompactDateTime(attempt.scheduled_at)}`}
                      </p>
                      {attempt.status === 'completed' && attempt.delay_minutes ? (
                        <p className="mt-1 text-[11px] text-amber-700">{attempt.delay_minutes} min late</p>
                      ) : null}
                      {derived.uiState === 'locked' && derived.availableInMinutes != null ? (
                        <p className="mt-1 text-[11px] text-brand-700">Available in {formatMinutes(derived.availableInMinutes)}</p>
                      ) : null}
                      {derived.uiState === 'due' ? (
                        <p className="mt-1 text-[11px] text-amber-700">Call due now</p>
                      ) : null}
                      {derived.uiState === 'overdue' && derived.overdueByMinutes != null ? (
                        <p className="mt-1 text-[11px] font-medium text-rose-700">Overdue by {formatMinutes(derived.overdueByMinutes)}</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-400">Waiting</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {sequence.has_active_sequence && activeAttempt && activeAttemptState.isActionable ? (
        <div className={clsx(
          'mt-3 rounded-xl border px-3 py-3',
          activeAttemptState.uiState === 'overdue' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50',
        )}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {activeAttemptState.uiState === 'overdue'
                  ? `Attempt ${activeAttempt.attempt_number} overdue`
                  : `Attempt ${activeAttempt.attempt_number} due now`}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {activeAttemptState.uiState === 'overdue' && activeAttemptState.overdueByMinutes != null
                  ? `Due ${formatMinutes(activeAttemptState.overdueByMinutes)} ago`
                  : 'Call lead now'}
              </p>
            </div>
            <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600">
              {activeAttempt.is_final_attempt ? 'Final recovery call' : `Attempt ${activeAttempt.attempt_number}`}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={completeAttempt.isPending}
              onClick={() => handleOutcome('call_received')}
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {completeAttempt.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Call Received
            </button>
            <button
              type="button"
              disabled={completeAttempt.isPending}
              onClick={() => handleOutcome('cnr')}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {completeAttempt.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneCall className="h-3.5 w-3.5" />}
              Not Received
            </button>
            <details className="rounded-lg border border-slate-200 bg-white">
              <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-slate-700">
                Other Call Issue
              </summary>
              <div className="grid gap-2 border-t border-slate-200 p-2 sm:grid-cols-2">
                {OTHER_OUTCOMES.map(outcome => (
                  <button
                    key={outcome}
                    type="button"
                    disabled={completeAttempt.isPending}
                    onClick={() => handleOutcome(outcome)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-left text-[11px] font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {OUTCOME_LABELS[outcome]}
                  </button>
                ))}
              </div>
            </details>
          </div>
        </div>
      ) : null}
    </div>
  );
}
