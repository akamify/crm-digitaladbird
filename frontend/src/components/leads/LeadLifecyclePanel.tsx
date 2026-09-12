'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, GitBranch, History, PhoneCall } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Modal, Skeleton } from '@/components/ui/Modal';
import { useCloseLifecycle, useCompleteLifecycleAction, useLeadLifecycle, useRecordLifecycleEvent, useReopenLifecycle } from '@/hooks/useLifecycle';
import { fmtDate, humanize } from '@/lib/format';

const ACTIVITIES = [
  ['responded', 'Responded'], ['communication_completed', 'Communication completed'],
  ['common_meeting_scheduled', 'Common Meeting scheduled'], ['common_meeting_attended', 'Common Meeting attended'],
  ['common_meeting_missed', 'Common Meeting missed / no show'], ['tte_scheduled', 'TTE scheduled'],
  ['tte_attended', 'TTE attended'], ['tte_missed', 'TTE missed / no show'], ['tte_completed', 'TTE completed'],
  ['personal_meeting_scheduled', 'Personal Meeting scheduled'], ['personal_meeting_attended', 'Personal Meeting attended'],
  ['personal_meeting_missed', 'Personal Meeting missed / no show'], ['personal_meeting_completed', 'Personal Meeting completed'], ['quotation_sent', 'Quotation sent'],
  ['follow_up_scheduled', 'Follow-up scheduled'], ['callback_scheduled', 'Callback scheduled'], ['other', 'Other activity'],
] as const;

const NEXT_ACTIONS = [
  ['responded_next_action', 'Decide next step'], ['common_meeting', 'Common Meeting'], ['tte', 'TTE'],
  ['personal_meeting', 'Personal Meeting'], ['quotation', 'Quotation'], ['callback', 'Callback'],
  ['follow_up', 'Stage follow-up'], ['recontact', 'Re-contact'], ['other', 'Other'],
] as const;

const COLD_REASONS = [
  ['not_interested', 'Not Interested'], ['budget_issue', 'Budget Issue'],
  ['no_response_after_full_cycle', 'No Response After Full Cycle'], ['requirement_mismatch', 'Requirement Mismatch'],
  ['purchased_elsewhere', 'Purchased Elsewhere'], ['timing_issue', 'Timing Issue'], ['duplicate', 'Duplicate'],
  ['invalid_lead', 'Invalid Lead'], ['other', 'Other'],
] as const;

function key() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `lifecycle-${Date.now()}`;
}

function defaultDue() {
  const value = new Date(Date.now() + 60 * 60 * 1000);
  value.setMinutes(Math.ceil(value.getMinutes() / 15) * 15, 0, 0);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function errorMessage(error: unknown) {
  const apiError = error as { response?: { data?: { error?: { message?: string } } } };
  return apiError.response?.data?.error?.message || 'Could not update lifecycle';
}

export function LeadLifecyclePanel({ leadId, readOnly = false, canManage = false }: { leadId: string; readOnly?: boolean; canManage?: boolean }) {
  const lifecycle = useLeadLifecycle(leadId);
  const record = useRecordLifecycleEvent();
  const complete = useCompleteLifecycleAction();
  const close = useCloseLifecycle();
  const reopen = useReopenLifecycle();
  const [modalOpen, setModalOpen] = useState(false);
  const [completeMode, setCompleteMode] = useState(false);
  const [reopenMode, setReopenMode] = useState(false);
  const [activity, setActivity] = useState('communication_completed');
  const [reason, setReason] = useState('');
  const [nextAction, setNextAction] = useState('follow_up');
  const [dueAt, setDueAt] = useState(defaultDue);
  const [terminal, setTerminal] = useState<'' | 'converted' | 'cold'>('');
  const [coldReason, setColdReason] = useState('not_interested');
  const [coldNote, setColdNote] = useState('');

  if (lifecycle.isLoading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>;
  if (lifecycle.isError || !lifecycle.data?.enabled || !lifecycle.data.state) return null;

  const data = lifecycle.data;
  const state = data.state;
  const activeAction = state.current_action;
  const activeRetry = state.active_call_retry;

  function openRecord(isCompletion = false) {
    setCompleteMode(isCompletion);
    setReopenMode(false);
    setTerminal('');
    setDueAt(defaultDue());
    setModalOpen(true);
  }

  function openReopen() {
    setCompleteMode(false);
    setReopenMode(true);
    setTerminal('');
    setDueAt(defaultDue());
    setModalOpen(true);
  }

  async function submit() {
    try {
      if (reopenMode) {
        if (!dueAt) {
          toast.error('Next action date and time is required.');
          return;
        }
        await reopen.mutateAsync({
          leadId, journey_stage: state.journey_stage, reason: reason.trim() || 'manager_reopened',
          expected_version: state.version, idempotency_key: key(),
          next_action: { action_type: nextAction, due_at: new Date(dueAt).toISOString(), reason: reason.trim() || `reopened_${state.journey_stage}` },
        });
      } else if (terminal) {
        await close.mutateAsync({
          leadId, terminal_state: terminal, expected_version: state.version, idempotency_key: key(),
          ...(terminal === 'cold' ? { cold_reason: coldReason, cold_reason_note: coldNote } : {}),
        });
      } else {
        if (!dueAt) {
          toast.error('Next action date and time is required.');
          return;
        }
        const next_action = { action_type: nextAction, due_at: new Date(dueAt).toISOString(), reason: reason.trim() || `post_${state.journey_stage}` };
        if (completeMode && activeAction) {
          await complete.mutateAsync({ leadId, actionId: activeAction.id, outcome: activity, event_type: activity, expected_version: state.version, idempotency_key: key(), next_action });
        } else {
          await record.mutateAsync({ leadId, event_type: activity, reason: reason.trim() || undefined, expected_version: state.version, idempotency_key: key(), next_action });
        }
      }
      setModalOpen(false);
      toast.success(reopenMode ? 'Lead reopened with a next action' : terminal ? `Lead marked ${humanize(terminal)}` : 'Activity and next action saved');
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-amber-50">
        <div className="flex flex-col gap-3 border-b border-sky-100 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">Lifecycle V2</p><h2 className="mt-1 text-base font-semibold text-slate-950">Current Journey</h2></div>
          {!state.terminal_state && !readOnly && !activeRetry && <Button size="sm" onClick={() => openRecord(false)}>Record Activity</Button>}
          {state.terminal_state && canManage && <Button size="sm" variant="outline" onClick={openReopen}>Reopen Lead</Button>}
        </div>
        <div className="grid gap-px bg-slate-200/70 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCell icon={<GitBranch className="h-4 w-4" />} label="Journey stage" value={humanize(state.journey_stage)} />
          <SummaryCell icon={<PhoneCall className="h-4 w-4" />} label="Last call result" value={humanize(state.last_call_result || 'Not recorded')} />
          <SummaryCell icon={<CalendarClock className="h-4 w-4" />} label="Next required action" value={state.terminal_state ? humanize(state.terminal_state) : humanize(activeAction?.action_type || (activeRetry ? 'Call retry' : 'Missing'))} warning={!state.terminal_state && !activeAction && !activeRetry} />
          <SummaryCell icon={<Clock3 className="h-4 w-4" />} label="Stage follow-up" value={activeAction?.stage_followup_attempt ? `${activeAction.stage_followup_attempt}/${activeAction.stage_followup_max}` : 'Not active'} />
        </div>
        {(activeAction || activeRetry) && !state.terminal_state && (
          <div className="grid gap-3 p-4 lg:grid-cols-2">
            {activeAction && <div className="rounded-xl border border-sky-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Next Required Action</p><h3 className="mt-1 text-sm font-semibold text-slate-900">{humanize(activeAction.action_type)}</h3><p className="text-xs text-slate-500">{humanize(activeAction.reason)} / {activeAction.action_type === 'common_meeting' ? `Meeting ${fmtDate(activeAction.scheduled_at, 'd MMM, h:mm a')} / outcome due ${fmtDate(activeAction.due_at, 'd MMM, h:mm a')}` : fmtDate(activeAction.due_at, 'd MMM, h:mm a')}</p>{activeAction.status === 'paused' && <p className="mt-1 text-xs font-medium text-amber-700">Paused while the active Call Retry is completed.</p>}{activeAction.action_type === 'manager_escalation' && !canManage && <p className="mt-1 text-xs font-medium text-amber-700">RM or Admin resolution required.</p>}</div>{!readOnly && activeAction.status !== 'paused' && (activeAction.action_type !== 'manager_escalation' || canManage) && <Button size="sm" variant="outline" onClick={() => openRecord(true)}>Complete</Button>}</div></div>}
            {activeRetry && <div className="rounded-xl border border-amber-200 bg-white p-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Active Call Retry</p><h3 className="mt-1 text-sm font-semibold text-slate-900">{humanize(String(activeRetry.initial_trigger_reason || 'Call issue'))}</h3><p className="text-xs text-slate-500">Belongs to {humanize(activeRetry.originating_action_id ? activeAction?.reason || state.journey_stage : state.journey_stage)}{activeRetry.next_attempt?.scheduled_at ? ` / ${fmtDate(activeRetry.next_attempt.scheduled_at, 'd MMM, h:mm a')}` : ''}</p></div>}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-5">
        <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><History className="h-4 w-4 text-sky-600" /><h2 className="text-sm font-semibold text-slate-900">Lead Journey</h2></div><span className="text-xs text-slate-500">{data.events.length} events</span></div>
        {!data.events.length ? <p className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">No lifecycle activity recorded yet.</p> : <ol className="space-y-0">{data.events.map(event => <li key={event.id} className="relative border-l border-slate-200 pb-5 pl-5 last:pb-0"><span className="absolute -left-1.5 top-1 h-3 w-3 rounded-full border-2 border-white bg-sky-500" /><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-slate-900">{humanize(event.event_type)}</p><p className="text-xs text-slate-500">{event.reason ? humanize(event.reason) : humanize(event.call_result || '')}{event.stage_after ? ` / ${humanize(event.stage_after)}` : ''}</p></div><div className="text-right text-[11px] text-slate-400">{fmtDate(event.occurred_at, 'd MMM yyyy, h:mm a')}<br />{event.user_name || 'System'}</div></div></li>)}</ol>}
      </section>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={reopenMode ? 'Reopen Lead' : completeMode ? 'Complete Required Action' : 'Record Activity'} description={reopenMode ? 'Reopen with one clear, scheduled next action.' : 'Record what happened and always leave one clear next action.'} size="md" footer={<><Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={submit} disabled={record.isPending || complete.isPending || close.isPending || reopen.isPending}>Save lifecycle</Button></>}>
        <div className="space-y-4">
          {!reopenMode && <><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setTerminal('')} className={`rounded-xl border p-3 text-sm font-medium ${!terminal ? 'border-sky-500 bg-sky-50 text-sky-800' : 'border-slate-200'}`}>Continue journey</button><button type="button" onClick={() => setTerminal('converted')} className={`rounded-xl border p-3 text-sm font-medium ${terminal === 'converted' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200'}`}>Converted</button></div><button type="button" onClick={() => setTerminal('cold')} className={`w-full rounded-xl border p-3 text-sm font-medium ${terminal === 'cold' ? 'border-rose-500 bg-rose-50 text-rose-800' : 'border-slate-200'}`}>Close as Cold</button></>}
          {terminal === 'cold' ? <><label className="block"><span className="label">Cold reason</span><select className="input" value={coldReason} onChange={event => setColdReason(event.target.value)}>{COLD_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{coldReason === 'other' && <label className="block"><span className="label">Reason details</span><textarea className="input min-h-20" value={coldNote} onChange={event => setColdNote(event.target.value)} /></label>}</> : terminal === 'converted' ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mr-2 inline h-4 w-4" />Future actions and retries will be cancelled; history remains.</div> : <>{!reopenMode && <label className="block"><span className="label">Activity</span><select className="input" value={activity} onChange={event => setActivity(event.target.value)}>{ACTIVITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}<label className="block"><span className="label">What happens next?</span><select className="input" value={nextAction} onChange={event => setNextAction(event.target.value)}>{NEXT_ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="block"><span className="label">Deadline</span><input type="datetime-local" className="input" value={dueAt} onChange={event => setDueAt(event.target.value)} /></label><label className="block"><span className="label">Reason / context</span><textarea className="input min-h-20" value={reason} onChange={event => setReason(event.target.value)} placeholder="Why is this the next action?" /></label></>}
        </div>
      </Modal>
    </div>
  );
}

function SummaryCell({ icon, label, value, warning = false }: { icon: ReactNode; label: string; value: string; warning?: boolean }) {
  return <div className="bg-white p-4"><div className={`flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide ${warning ? 'text-rose-600' : 'text-slate-500'}`}>{warning ? <AlertTriangle className="h-4 w-4" /> : icon}{label}</div><div className={`mt-2 text-sm font-semibold ${warning ? 'text-rose-700' : 'text-slate-900'}`}>{value}</div></div>;
}
