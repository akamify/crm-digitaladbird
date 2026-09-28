'use client';
import { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2, ChevronDown, Loader2,
  Clock, History, MessageSquare, BarChart3, Target, Trophy,
  Zap, Upload, Paperclip, X, ExternalLink, FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  useLeadWorkflow, useSaveRemark,
  useSaveConversion, useWorkflowHistory,
  useConversionAttachments, useUploadConversionAttachments, useDeleteConversionAttachment,
  type ConversionAttachment,
} from '@/hooks/useWorkflow';
import { fmtDate, humanize, clsx } from '@/lib/format';
import {
  CALL_ISSUE_STATUS_VALUES,
  COMPLETED_REMARK_STATUS_VALUES,
  LEAD_REMARK_GROUPS,
  RETRYABLE_CALL_ISSUE_VALUES,
  SEQUENCE_CLOSING_REMARK_VALUES,
} from '@/constants/leadRemarkOptions';
import type { CallAttemptSequenceSummary, CallAttemptStateSummary, CallAttemptSummary, NextScheduledCallSummary } from '@/types';
import { CallAttemptTracker } from './CallAttemptTracker';
import { useAddRemark } from '@/hooks/useLeads';

/* ── Remark display labels + colors ─────────────────────────────────── */

const REMARK_DISPLAY: Record<string, { label: string; bg: string; text: string; ring: string }> = {
  communication_completed:  { label: 'Communication Completed', bg: 'bg-green-50',   text: 'text-green-700',   ring: 'ring-green-400' },
  recall:                   { label: 'Recall',                  bg: 'bg-blue-50',    text: 'text-blue-700',    ring: 'ring-blue-400' },
  respond_hi:               { label: 'Respond (HI)',            bg: 'bg-indigo-50',  text: 'text-indigo-700',  ring: 'ring-indigo-400' },
  cnr:                      { label: 'CNR (Call Not Received)',  bg: 'bg-red-50',     text: 'text-red-700',     ring: 'ring-red-400' },
  busy:                     { label: 'Busy',                    bg: 'bg-yellow-50',  text: 'text-yellow-700',  ring: 'ring-yellow-400' },
  call_cut_busy:            { label: 'Call Cut / Busy',         bg: 'bg-orange-50',  text: 'text-orange-700',  ring: 'ring-orange-400' },
  rnr:                      { label: 'RNR (Ringing No Response)', bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-400' },
  so:                       { label: 'SO (Switch Off)',          bg: 'bg-gray-50',    text: 'text-gray-700',    ring: 'ring-gray-400' },
  cw:                       { label: 'CW (Call Waiting)',        bg: 'bg-amber-50',   text: 'text-amber-700',   ring: 'ring-amber-400' },
  nn:                       { label: 'NN (No Network)',          bg: 'bg-orange-50',  text: 'text-orange-700',  ring: 'ring-orange-400' },
  nc:                       { label: 'NC (Not Connected)',       bg: 'bg-rose-50',    text: 'text-rose-700',    ring: 'ring-rose-400' },
  ni:                       { label: 'NI (No Incoming)',         bg: 'bg-pink-50',    text: 'text-pink-700',    ring: 'ring-pink-400' },
  in:                       { label: 'IN (Invalid Number)',      bg: 'bg-slate-50',   text: 'text-slate-700',   ring: 'ring-slate-400' },
  cb:                       { label: 'CB (Call Busy)',           bg: 'bg-yellow-50',  text: 'text-yellow-700',  ring: 'ring-yellow-400' },
  session_730_attend:       { label: 'Common Meeting Attended',  bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-400' },
  yes_after_730_session:    { label: 'Yes After Common Meeting', bg: 'bg-teal-50',    text: 'text-teal-700',    ring: 'ring-teal-400' },
};

/* ── Level display labels + colors ──────────────────────────────────── */

const STEP_CONFIG = [
  { label: 'Remark', icon: MessageSquare, gradient: 'from-violet-500 to-purple-600', light: 'bg-violet-50 border-violet-200', badge: 'bg-violet-100 text-violet-700' },
  { label: 'Lead Category', icon: BarChart3, gradient: 'from-blue-500 to-indigo-600', light: 'bg-blue-50 border-blue-200', badge: 'bg-blue-100 text-blue-700' },
  { label: 'Follow-up Tracker', icon: Target, gradient: 'from-emerald-500 to-teal-600', light: 'bg-emerald-50 border-emerald-200', badge: 'bg-emerald-100 text-emerald-700' },
  { label: 'Conversion', icon: Trophy, gradient: 'from-amber-500 to-orange-600', light: 'bg-amber-50 border-amber-200', badge: 'bg-amber-100 text-amber-700' },
];

interface Props {
  leadId: string;
  isAdmin?: boolean;
}

export function WorkflowPanel({ leadId }: Props) {
  const { data: wfData, isLoading, isError } = useLeadWorkflow(leadId);
  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-8 w-8 rounded-xl bg-slate-200 animate-pulse" />
          <div className="h-5 w-40 bg-slate-200 rounded animate-pulse" />
        </div>
        {[1, 4].map(i => (
          <div key={i} className="h-20 rounded-2xl bg-slate-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError || !wfData) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <Zap className="mx-auto h-8 w-8 text-slate-400 mb-2" />
        <p className="text-sm font-medium text-slate-600">Workflow loading...</p>
        <p className="text-xs text-slate-400 mt-1">Refresh the page if this persists</p>
      </div>
    );
  }

  const completedSteps = [!!wfData.workflow_remark_completed, false, false, !!wfData.workflow?.conversion_completed];
  return (
    <div className="space-y-6">
      <div className="space-y-6">
        <StepCard
          step={1} config={STEP_CONFIG[0]}
          completed={completedSteps[0]}
          savedValue={(wfData.workflow_step_1_statuses?.length ? wfData.workflow_step_1_statuses : wfData.workflow?.remark_status ? [wfData.workflow.remark_status] : [])
            .map(status => REMARK_DISPLAY[status]?.label || humanize(status)).join(', ') || undefined}
          savedAt={wfData.workflow?.remark_saved_at || undefined}
        >
          <Step1Remark
            leadId={leadId}
            current={wfData.workflow_step_1_statuses?.length ? wfData.workflow_step_1_statuses : wfData.workflow?.remark_status ? [wfData.workflow.remark_status] : []}
            options={wfData.remark_options}
            completed={!!wfData.workflow_remark_completed}
            callAttemptSequence={wfData.call_attempt_sequence}
            callAttempts={wfData.call_attempts}
            callAttemptState={wfData.call_attempt_state}
            nextScheduledCall={wfData.next_scheduled_call}
          />
        </StepCard>

        <StepCard
          step={2} config={STEP_CONFIG[3]} collapsible
          completed={completedSteps[3]}
          savedValue={wfData.conversion?.customer_type ? `${humanize(wfData.conversion.customer_type)} — ₹${Number(wfData.conversion.total_payment || 0).toLocaleString()}` : undefined}
          savedAt={wfData.conversion?.submitted_at || undefined}
        >
          <Step4Conversion
            leadId={leadId}
            conversion={wfData.conversion}
            completed={completedSteps[3]}
            leadCategory={wfData.lead_category}
          />
        </StepCard>
      </div>

      {/* History toggle */}
      <WorkflowHistoryToggle leadId={leadId} />
    </div>
  );
}

/* ── Accordion Step Card ──────────────────────────────────────────── */

function StepCard({ step, config, completed, savedValue, savedAt, children, collapsible = false }: {
  step: number; config: typeof STEP_CONFIG[0]; completed: boolean;
  savedValue?: string; savedAt?: string; children: React.ReactNode; collapsible?: boolean;
}) {
  const Icon = config.icon;
  const header = <div className="flex min-w-0 items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Icon className="h-5 w-5" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-slate-900">Step {step}: {config.label}</h3>
          {completed && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"><CheckCircle2 className="h-3 w-3" />Saved</span>}
        </div>
        {savedValue && <p className="mt-1 break-words text-xs text-slate-600">{savedValue}</p>}
        {savedAt && <p className="mt-1 text-[10px] text-slate-400">{fmtDate(savedAt)}</p>}
      </div>
      {collapsible && <ChevronDown className="mt-2 h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" aria-hidden="true" />}
    </div>;
  const content = <div className="min-w-0 [overflow-wrap:anywhere]">{children}</div>;
  const className = 'min-w-0 rounded-xl border border-slate-200 bg-white p-3 sm:p-4';
  if (collapsible) return <details className={`group ${className}`} aria-label={`Step ${step}: ${config.label}`}>
    <summary className="cursor-pointer list-none rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 [&::-webkit-details-marker]:hidden">{header}</summary>
    <div className="mt-4">{content}</div>
  </details>;
  return <section className={`${className} space-y-4`} aria-label={`Step ${step}: ${config.label}`}>
    {header}
    {content}
  </section>;
}

type PendingRemarkAction = { kind: 'close_plan' | 'retry_due' | 'extra_call'; value: string; nextSelection: string[] };

function Step1Remark({ leadId, current, options, completed, callAttemptSequence, callAttempts, callAttemptState, nextScheduledCall }: {
  leadId: string;
  current: string[];
  options: string[];
  completed: boolean;
  callAttemptSequence?: CallAttemptSequenceSummary | null;
  callAttempts?: CallAttemptSummary[];
  callAttemptState?: CallAttemptStateSummary | null;
  nextScheduledCall?: NextScheduledCallSummary | null;
}) {
  const save = useSaveRemark();
  const addNote = useAddRemark();
  const [selected, setSelected] = useState<string[]>(current || []);
  const [conversationNote, setConversationNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const [customComposerActive, setCustomComposerActive] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingRemarkAction | null>(null);
  const [retryExpanded, setRetryExpanded] = useState(true);
  const [retryRevealPending, setRetryRevealPending] = useState(false);
  const [retryHighlighted, setRetryHighlighted] = useState(false);
  const [retryAnnouncement, setRetryAnnouncement] = useState('');
  const retryHighlightTimerRef = useRef<number | null>(null);
  const reuseMeetingCard = options.includes('common_meeting');
  const availableGroups = LEAD_REMARK_GROUPS.map(group => ({
    ...group,
    options: group.options.filter(option => options.includes(option.value)&&(!reuseMeetingCard||option.value!=='common_meeting')).map(option=>
      reuseMeetingCard&&option.value==='session_730_attend'?{value:'common_meeting',label:'Common Meeting (CM)'}:option),
  })).filter(group => group.options.length > 0);
  const hasActiveCallSequence = !!callAttemptSequence?.has_active_sequence;
  const primaryStatus = hasActiveCallSequence && !CALL_ISSUE_STATUS_VALUES.has(selected[0])
    ? selected.find(value => CALL_ISSUE_STATUS_VALUES.has(value)) || selected[0]
    : selected[0];
  const displayedSelection = primaryStatus
    ? [primaryStatus, ...selected.filter(value => value !== primaryStatus)]
    : selected;

  useEffect(() => {
    setSelected([...new Set((current||[]).map(value=>reuseMeetingCard&&value==='session_730_attend'?'common_meeting':value))]);
  }, [current,reuseMeetingCard]);

  useEffect(() => {
    if (!pendingAction) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !save.isPending) setPendingAction(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [pendingAction, save.isPending]);

  useEffect(() => () => {
    if (retryHighlightTimerRef.current !== null) window.clearTimeout(retryHighlightTimerRef.current);
  }, []);

  useEffect(() => {
    if (!callAttemptSequence?.has_active_sequence) {
      setRetryExpanded(false);
      return;
    }
    setRetryExpanded(true);
  }, [callAttemptSequence?.has_active_sequence, callAttemptSequence?.id, callAttemptState?.is_due, callAttemptState?.is_overdue]);

  useEffect(() => {
    if (!retryRevealPending || !callAttemptSequence?.has_active_sequence) return undefined;
    setRetryRevealPending(false);
    setRetryExpanded(true);
    setRetryHighlighted(true);
    setRetryAnnouncement(nextScheduledCall
      ? `Retry plan created. Next call is ${fmtDate(nextScheduledCall.scheduled_at)}.`
      : 'Retry plan created.');
    scrollToRetryPlan();
    if (retryHighlightTimerRef.current !== null) window.clearTimeout(retryHighlightTimerRef.current);
    retryHighlightTimerRef.current = window.setTimeout(() => {
      setRetryHighlighted(false);
      retryHighlightTimerRef.current = null;
    }, 1800);
    return undefined;
  }, [callAttemptSequence?.has_active_sequence, callAttemptSequence?.id, nextScheduledCall, retryRevealPending]);

  function scrollToRetryPlan() {
    window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      document.getElementById('active-retry-plan')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    });
  }

  function saveSelection(
    nextSelection: string[],
    triggerStatus: string | null,
    settings: { attemptMode?: 'remark_click' | 'unscheduled_call'; confirmSequenceClose?: boolean } = {},
  ) {
    if (nextSelection.length === 0) {
      toast.error('At least one Step 1 status must stay selected.');
      return;
    }

    const previousSelection = selected;
    const shouldRevealRetry = Boolean(triggerStatus && RETRYABLE_CALL_ISSUE_VALUES.has(triggerStatus) && !hasActiveCallSequence);
    setSelected(nextSelection);

    save.mutate({
      leadId,
      remark_status: nextSelection[0],
      remark_statuses: nextSelection,
      attempt_trigger_status: triggerStatus,
      attempt_mode: settings.attemptMode || 'remark_click',
      confirm_sequence_close: settings.confirmSequenceClose,
    }, {
      onSuccess: () => {
        setPendingAction(null);
        if (shouldRevealRetry) setRetryRevealPending(true);
        toast.success(settings.attemptMode === 'unscheduled_call' ? 'Extra call recorded' : 'Remark updated');
      },
      onError: (e: unknown) => {
        if (shouldRevealRetry) setRetryRevealPending(false);
        setSelected(previousSelection);
        const responseData = typeof e === 'object' && e && 'response' in e
          ? (e as { response?: { data?: { error?: { code?: string; message?: string } } } }).response?.data
          : null;
        if (responseData?.error?.code === 'CALL_ATTEMPT_SEQUENCE_CONFIRMATION_REQUIRED' && triggerStatus) {
          setPendingAction({ kind: 'close_plan', value: triggerStatus, nextSelection });
          return;
        }
        if (responseData?.error?.code === 'CALL_ATTEMPT_LOCKED' && triggerStatus) {
          setPendingAction({ kind: 'extra_call', value: triggerStatus, nextSelection });
          return;
        }
        const message = responseData?.error?.message;
        toast.error(message || 'Failed to save Step 1');
      },
    });
  }

  function toggle(value: string) {
    if (save.isPending || addNote.isPending) return;

    if (value === 'custom_remark') {
      setCustomComposerActive(true);
      setNoteError('');
      requestAnimationFrame(() => noteRef.current?.focus());
      return;
    }
    setCustomComposerActive(false);

    const isCallIssue = CALL_ISSUE_STATUS_VALUES.has(value);
    const isAlreadySelected = selected.includes(value);
    const nextSelection = isAlreadySelected
      ? selected.filter(item => item !== value)
      : value === 'custom_remark' && selected.length > 0
        ? [...selected, value]
        : [value, ...selected.filter(item => item !== value && (!isCallIssue || !CALL_ISSUE_STATUS_VALUES.has(item)))];

    if (isCallIssue && isAlreadySelected && !hasActiveCallSequence) {
      toast.error('Choose another call issue or response; the current issue cannot be cleared.');
      return;
    }

    const selectedCallIssue = [value, ...selected.filter(item => item !== value && !CALL_ISSUE_STATUS_VALUES.has(item))];
    if (hasActiveCallSequence && RETRYABLE_CALL_ISSUE_VALUES.has(value)) {
      setPendingAction({
        kind: callAttemptState?.is_due || callAttemptState?.is_overdue ? 'retry_due' : 'extra_call',
        value,
        nextSelection: selectedCallIssue,
      });
      return;
    }
    if (!isAlreadySelected && hasActiveCallSequence && SEQUENCE_CLOSING_REMARK_VALUES.has(value)) {
      setPendingAction({ kind: 'close_plan', value, nextSelection });
      return;
    }

    saveSelection(nextSelection, isAlreadySelected ? null : value);
  }

  function confirmPendingAction() {
    if (!pendingAction) return;
    if (pendingAction.kind === 'retry_due') {
      setPendingAction(null);
      setRetryExpanded(true);
      scrollToRetryPlan();
      return;
    }
    if (pendingAction.kind === 'extra_call') {
      saveSelection(pendingAction.nextSelection, pendingAction.value, { attemptMode: 'unscheduled_call' });
      return;
    }
    saveSelection(pendingAction.nextSelection, pendingAction.value, { confirmSequenceClose: true });
  }

  const customRemarkSelected = customComposerActive;

  async function saveConversationNote() {
    const note = conversationNote.trim();
    if (!note) {
      setNoteError(customRemarkSelected ? 'Write the custom remark before saving.' : 'Write a conversation note before saving.');
      noteRef.current?.focus();
      return;
    }

    setNoteError('');
    try {
      if (customRemarkSelected) {
        const statuses = selected.includes('custom_remark') ? selected : [...selected, 'custom_remark'];
        await save.mutateAsync({
          leadId,
          remark_status: statuses[0] || 'custom_remark',
          remark_statuses: statuses,
          remark: note,
          attempt_trigger_status: 'custom_remark',
        });
      } else {
        await addNote.mutateAsync({ id: leadId, remark: note, note_type: 'counselor_update', release_lock: true });
      }
      setConversationNote('');
      setCustomComposerActive(false);
      toast.success(customRemarkSelected ? 'Custom remark saved' : 'Conversation note saved');
    } catch (error) {
      const message = typeof error === 'object' && error && 'response' in error
        ? (error as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      setNoteError(message || 'Could not save the note. Your text has been kept.');
    }
  }

  return (
    <div>
      <div className="space-y-4">
        {availableGroups.map(group => (
          <div key={group.key}>
            <p className={clsx('mb-2 text-[11px] font-semibold uppercase tracking-wide', {
              emerald: 'text-emerald-700', sky: 'text-sky-700', amber: 'text-amber-700', slate: 'text-slate-500',
            }[group.tone])}>{group.label}</p>
            <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:grid-cols-3">
              {group.options.map(option => {
                const display = REMARK_DISPLAY[option.value] || { label: option.label, bg: 'bg-slate-50', text: 'text-slate-700', ring: 'ring-slate-400' };
                const isRecorded = selected.includes(option.value) || (option.value === 'custom_remark' && customComposerActive);
                const isSelected = primaryStatus === option.value || (option.value === 'custom_remark' && customComposerActive);
                const isCompletingOption = COMPLETED_REMARK_STATUS_VALUES.has(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={save.isPending || addNote.isPending}
                    aria-pressed={isRecorded}
                    onClick={() => toggle(option.value)}
                    className={clsx(
                      'relative min-h-11 rounded-xl border-2 px-3 py-2.5 text-left text-xs font-semibold transition-all duration-200',
                      isSelected
                        ? `${display.bg} ${display.text} border-current ring-2 ${display.ring} shadow-md scale-[1.02]`
                        : isRecorded
                          ? 'border-brand-200 bg-brand-50/50 text-brand-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:shadow-sm hover:scale-[1.01]'
                    )}
                  >
                    {save.isPending && <Loader2 className="absolute right-1 top-1 h-3 w-3 animate-spin text-slate-400" />}
                    {isSelected && <CheckCircle2 className="absolute right-1 top-1 h-3.5 w-3.5 text-green-500" />}
                    {option.label}
                    {isRecorded && !isSelected && <span className="mt-1 block text-[9px] font-medium uppercase tracking-wide text-brand-600">Recorded</span>}
                    {isCompletingOption && !isRecorded && <span className="mt-1 block text-[9px] font-medium uppercase tracking-wide text-emerald-600">Completes step</span>}
                  </button>
                );
              })}
            </div>
            {group.key === 'issues' && (
              <CallAttemptTracker
                leadId={leadId}
                sequence={callAttemptSequence}
                attempts={callAttempts}
                callAttemptState={callAttemptState}
                nextScheduledCall={nextScheduledCall}
                displayMode="contextual"
                expanded={retryExpanded}
                onExpandedChange={setRetryExpanded}
                highlighted={retryHighlighted}
              />
            )}
          </div>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{retryAnnouncement}</p>
      <div id="conversation-note" className="mt-4 scroll-mt-24 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
        <div className="mb-2">
          <label htmlFor={`conversation-note-${leadId}`} className="text-sm font-semibold text-slate-900">
            Conversation Note {customRemarkSelected ? <span className="text-rose-600">(required)</span> : <span className="font-normal text-slate-500">(optional)</span>}
          </label>
          <p className="mt-0.5 text-xs text-slate-500">Write a short summary of what was discussed.</p>
        </div>
        <textarea
          ref={noteRef}
          id={`conversation-note-${leadId}`}
          value={conversationNote}
          onChange={event => { setConversationNote(event.target.value); if (noteError) setNoteError(''); }}
          rows={3}
          maxLength={2000}
          placeholder="Customer needs, questions, or agreed next step..."
          aria-invalid={Boolean(noteError)}
          aria-describedby={noteError ? `conversation-note-error-${leadId}` : undefined}
          className="min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
        {noteError && <p id={`conversation-note-error-${leadId}`} className="mt-1.5 text-xs font-medium text-rose-600">{noteError}</p>}
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-400">{conversationNote.length}/2000</span>
          <button
            type="button"
            onClick={saveConversationNote}
            disabled={save.isPending || addNote.isPending || !conversationNote.trim()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {(save.isPending || addNote.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
            Save note
          </button>
        </div>
      </div>
      {selected.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="mb-1.5 text-[11px] font-medium text-slate-500">Current status and recorded Step 1 context</p>
          <div className="flex flex-wrap gap-2">
            {displayedSelection.map((value, index) => <span key={value} className={index === 0 ? 'chip-green' : 'chip-blue'}>{index === 0 ? 'Current: ' : ''}{REMARK_DISPLAY[value]?.label || humanize(value)}</span>)}
          </div>
        </div>
      )}
      <div className="mt-4 flex items-center justify-end">
        <span className="text-xs text-slate-500">
          {save.isPending ? 'Saving remark...' : completed ? 'Step 1 stays editable.' : 'Step 1 saves automatically.'}
        </span>
      </div>
      {pendingAction && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="remark-action-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="remark-action-title" className="text-base font-bold text-slate-950">
                  {pendingAction.kind === 'close_plan' ? 'Close active retry plan?' : pendingAction.kind === 'retry_due' ? 'Record the due retry' : 'Record an extra call?'}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {pendingAction.kind === 'close_plan'
                    ? `${REMARK_DISPLAY[pendingAction.value]?.label || humanize(pendingAction.value)} will cancel the upcoming retry. Completed call history will remain available.`
                    : pendingAction.kind === 'retry_due'
                      ? 'A scheduled retry is due now. Record its outcome inside the Retry Plan so compliance and timing remain accurate.'
                      : `The scheduled retry stays at ${nextScheduledCall ? fmtDate(nextScheduledCall.scheduled_at) : 'its current time'}. This records ${REMARK_DISPLAY[pendingAction.value]?.label || humanize(pendingAction.value)} as a separate call now.`}
                </p>
              </div>
              <button type="button" onClick={() => setPendingAction(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={save.isPending} onClick={() => setPendingAction(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                Keep retry plan
              </button>
              <button type="button" disabled={save.isPending} onClick={confirmPendingAction} className={clsx('inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60', pendingAction.kind === 'close_plan' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-brand-600 hover:bg-brand-700')}>
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {pendingAction.kind === 'close_plan' ? 'Close plan and save' : pendingAction.kind === 'retry_due' ? 'Show Retry Plan' : 'Record extra call'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Step 2: Lead Level ──────────────────────────────────────────── */

function Step4Conversion({ leadId, conversion, completed, leadCategory }: {
  leadId: string; conversion: any; completed: boolean; leadCategory: 'partner' | 'trader' | 'unknown' | null;
}) {
  const save = useSaveConversion();
  const [form, setForm] = useState({
    followup_status: conversion?.followup_status || '',
    address: conversion?.address || '',
    total_payment: conversion?.total_payment || '',
    part_payment: conversion?.part_payment || '',
    services: conversion?.services || '',
    transaction_id: conversion?.transaction_id || '',
  });

  function handleSave(markComplete: boolean) {
    if (!leadCategory || !['partner', 'trader'].includes(leadCategory)) {
      toast.error('A Partner or Trader lead category is required for conversion');
      return;
    }
    save.mutate({
      leadId,
      followup_status: form.followup_status || undefined,
      address: form.address || undefined,
      total_payment: form.total_payment ? Number(form.total_payment) : undefined,
      part_payment: form.part_payment ? Number(form.part_payment) : undefined,
      services: form.services || undefined,
      transaction_id: form.transaction_id || undefined,
    }, {
      onSuccess: () => toast.success(markComplete ? 'Conversion complete! Lead marked as won.' : 'Conversion saved!'),
      onError: (e: any) => toast.error(e?.message || 'Failed'),
    });
  }

  if (completed && conversion) {
    return (
      <div className="rounded-xl bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Trophy className="h-5 w-5 text-amber-500" />
          <span className="text-sm font-bold text-green-800">Conversion Complete</span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <InfoPill label="Follow-up Status" value={conversion.followup_status || '—'} />
          <InfoPill label="Customer Type" value={humanize(conversion.customer_type)} />
          <InfoPill label="Total Payment" value={conversion.total_payment ? `₹${Number(conversion.total_payment).toLocaleString()}` : '—'} />
          <InfoPill label="Part Payment" value={conversion.part_payment ? `₹${Number(conversion.part_payment).toLocaleString()}` : '—'} />
          <InfoPill label="Services" value={conversion.services || '—'} />
          {conversion.transaction_id && <InfoPill label="Transaction ID" value={conversion.transaction_id} />}
          {conversion.address && <div className="col-span-2"><InfoPill label="Address" value={conversion.address} /></div>}
        </div>
        <p className="mt-3 text-[10px] text-slate-400 text-right">Submitted {fmtDate(conversion.submitted_at)}</p>

      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3">Enter conversion details to close this lead:</p>
      <div className="space-y-3">
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Follow-up Status</label>
          <input
            className="input mt-1 text-sm"
            placeholder="e.g. Regular follow-up, Hot lead, Ready to convert..."
            value={form.followup_status}
            onChange={e => setForm(f => ({ ...f, followup_status: e.target.value }))}
          />
        </div>

        <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-brand-600">Customer Type</p>
          <p className="mt-0.5 text-sm font-semibold text-brand-900">{leadCategory ? humanize(leadCategory) : 'Not set on lead profile'}</p>
          <p className="mt-0.5 text-xs text-brand-700">Taken from the lead profile and cannot be changed here.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Payment (₹)</label>
            <input
              className="input mt-1 text-sm font-semibold"
              type="number"
              placeholder="50,000"
              value={form.total_payment}
              onChange={e => setForm(f => ({ ...f, total_payment: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Part Payment (₹)</label>
            <input
              className="input mt-1 text-sm font-semibold"
              type="number"
              placeholder="25,000"
              value={form.part_payment}
              onChange={e => setForm(f => ({ ...f, part_payment: e.target.value }))}
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Transaction ID</label>
          <input
            className="input mt-1 text-sm font-mono"
            placeholder="Payment transaction / UTR / reference ID"
            value={form.transaction_id}
            maxLength={128}
            onChange={e => setForm(f => ({ ...f, transaction_id: e.target.value.replace(/\s/g, '') }))}
          />
          <p className="mt-1 text-[10px] text-slate-500">Required when a payment amount is recorded.</p>
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Services</label>
          <input
            className="input mt-1 text-sm"
            placeholder="Trading, Advisory, Premium..."
            value={form.services}
            onChange={e => setForm(f => ({ ...f, services: e.target.value }))}
          />
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Address</label>
          <textarea
            className="input mt-1 text-sm"
            rows={2}
            placeholder="Full address..."
            value={form.address}
            onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => handleSave(false)}
            disabled={save.isPending}
            className={clsx(
              'flex-1 rounded-xl py-3 text-sm font-bold transition-all duration-200',
              'border-2 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100',
              'inline-flex items-center justify-center gap-2',
              save.isPending && 'opacity-70'
            )}
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Save Conversion
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={save.isPending}
            className={clsx(
              'flex-1 rounded-xl py-3 text-sm font-bold text-white shadow-lg transition-all duration-200',
              'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700',
              'hover:shadow-xl hover:scale-[1.01] active:scale-[0.99]',
              'inline-flex items-center justify-center gap-2',
              save.isPending && 'opacity-70'
            )}
          >
            {save.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trophy className="h-5 w-5" />}
            Mark Completed
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/80 px-3 py-1.5 border border-green-100">
      <p className="text-[9px] font-semibold text-slate-400 uppercase">{label}</p>
      <p className="text-xs font-bold text-slate-800 truncate">{value}</p>
    </div>
  );
}


/* ── History Toggle ───────────────────────────────────────────────── */

function WorkflowHistoryToggle({ leadId }: { leadId: string }) {
  const [show, setShow] = useState(false);
  const { data: history, isLoading } = useWorkflowHistory(show ? leadId : null);

  return (
    <div>
      <button
        onClick={() => setShow(!show)}
        className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors"
      >
        <History className="h-3.5 w-3.5" />
        {show ? 'Hide' : 'Show'} Workflow History
      </button>

      {show && (
        <div className="mt-2 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {isLoading ? (
            <div className="px-4 py-3 text-xs text-slate-400">Loading...</div>
          ) : !history?.length ? (
            <div className="px-4 py-3 text-xs text-slate-400">No history yet</div>
          ) : (
            history.map(h => (
              <div key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className={clsx(
                  'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white',
                  `bg-gradient-to-br ${STEP_CONFIG[h.step - 1]?.gradient || 'from-slate-400 to-slate-500'}`
                )}>
                  {h.step}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-800">{h.user_name}</span>
                    <span className="text-[10px] text-slate-500">{humanize(h.action)}</span>
                  </div>
                  {h.new_value && (
                    <span className="text-[11px] font-medium text-brand-600">{humanize(h.new_value)}</span>
                  )}
                </div>
                <span className="text-[10px] text-slate-400 flex-shrink-0">{fmtDate(h.created_at)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
