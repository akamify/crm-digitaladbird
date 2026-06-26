'use client';
import { useState, useEffect } from 'react';
import {
  CheckCircle2, Lock, ChevronRight, Loader2,
  Clock, History, MessageSquare, BarChart3, Target, Trophy,
  Zap, TrendingUp, Upload, Paperclip, X, ExternalLink, FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  useLeadWorkflow, useSaveRemark, useSaveLeadLevel,
  useUpdateFollowup, useSaveConversion, useWorkflowHistory,
  useConversionAttachments, useUploadConversionAttachments, useDeleteConversionAttachment,
  type ConversionAttachment,
} from '@/hooks/useWorkflow';
import { fmtDate, humanize, clsx } from '@/lib/format';

/* ── Remark display labels + colors ─────────────────────────────────── */

const REMARK_DISPLAY: Record<string, { label: string; bg: string; text: string; ring: string }> = {
  communication_completed:  { label: 'Communication Completed', bg: 'bg-green-50',   text: 'text-green-700',   ring: 'ring-green-400' },
  recall:                   { label: 'Recall',                  bg: 'bg-blue-50',    text: 'text-blue-700',    ring: 'ring-blue-400' },
  respond_hi:               { label: 'Respond (HI)',            bg: 'bg-indigo-50',  text: 'text-indigo-700',  ring: 'ring-indigo-400' },
  cnr:                      { label: 'CNR (Call Not Received)',  bg: 'bg-red-50',     text: 'text-red-700',     ring: 'ring-red-400' },
  so:                       { label: 'SO (Switch Off)',          bg: 'bg-gray-50',    text: 'text-gray-700',    ring: 'ring-gray-400' },
  cw:                       { label: 'CW (Call Waiting)',        bg: 'bg-amber-50',   text: 'text-amber-700',   ring: 'ring-amber-400' },
  nn:                       { label: 'NN (No Network)',          bg: 'bg-orange-50',  text: 'text-orange-700',  ring: 'ring-orange-400' },
  nc:                       { label: 'NC (Not Connected)',       bg: 'bg-rose-50',    text: 'text-rose-700',    ring: 'ring-rose-400' },
  ni:                       { label: 'NI (No Incoming)',         bg: 'bg-pink-50',    text: 'text-pink-700',    ring: 'ring-pink-400' },
  in:                       { label: 'IN (Invalid Number)',      bg: 'bg-slate-50',   text: 'text-slate-700',   ring: 'ring-slate-400' },
  cb:                       { label: 'CB (Call Busy)',           bg: 'bg-yellow-50',  text: 'text-yellow-700',  ring: 'ring-yellow-400' },
  session_730_attend:       { label: '7:30 Session Attend',      bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-400' },
  yes_after_730_session:    { label: 'Yes After 7:30 Session',   bg: 'bg-teal-50',    text: 'text-teal-700',    ring: 'ring-teal-400' },
};

/* ── Level display labels + colors ──────────────────────────────────── */

const LEVEL_DISPLAY: Record<string, { label: string; bg: string; text: string; ring: string }> = {
  new_partner:       { label: 'New Partner',       bg: 'bg-blue-50',    text: 'text-blue-700',    ring: 'ring-blue-400' },
  new_trader:        { label: 'New Trader',        bg: 'bg-cyan-50',    text: 'text-cyan-700',    ring: 'ring-cyan-400' },
  followup_partner:  { label: 'Follow-up Partner', bg: 'bg-violet-50',  text: 'text-violet-700',  ring: 'ring-violet-400' },
  followup_trader:   { label: 'Follow-up Trader',  bg: 'bg-indigo-50',  text: 'text-indigo-700',  ring: 'ring-indigo-400' },
  hot_partner:       { label: 'Hot Partner',       bg: 'bg-red-50',     text: 'text-red-700',     ring: 'ring-red-400' },
  hot_trader:        { label: 'Hot Trader',        bg: 'bg-orange-50',  text: 'text-orange-700',  ring: 'ring-orange-400' },
  cold_partner:      { label: 'Cold Partner',      bg: 'bg-slate-100',  text: 'text-slate-700',   ring: 'ring-slate-400' },
  cold_trader:       { label: 'Cold Trader',       bg: 'bg-gray-100',   text: 'text-gray-700',    ring: 'ring-gray-400' },
  all_partner:       { label: 'ALL Partner',       bg: 'bg-sky-50',     text: 'text-sky-700',     ring: 'ring-sky-400' },
  all_trader:        { label: 'ALL Trader',        bg: 'bg-teal-50',    text: 'text-teal-700',    ring: 'ring-teal-400' },
  advance_payment:   { label: 'Advance Payment',   bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-400' },
  closed:            { label: 'Closed',            bg: 'bg-green-50',   text: 'text-green-700',   ring: 'ring-green-400' },
};

const STEP_CONFIG = [
  { label: 'Remark', icon: MessageSquare, gradient: 'from-violet-500 to-purple-600', light: 'bg-violet-50 border-violet-200', badge: 'bg-violet-100 text-violet-700' },
  { label: 'Lead Level', icon: BarChart3, gradient: 'from-blue-500 to-indigo-600', light: 'bg-blue-50 border-blue-200', badge: 'bg-blue-100 text-blue-700' },
  { label: 'Follow-up Tracker', icon: Target, gradient: 'from-emerald-500 to-teal-600', light: 'bg-emerald-50 border-emerald-200', badge: 'bg-emerald-100 text-emerald-700' },
  { label: 'Conversion', icon: Trophy, gradient: 'from-amber-500 to-orange-600', light: 'bg-amber-50 border-amber-200', badge: 'bg-amber-100 text-amber-700' },
];

const FOLLOWUP_FIELDS = [
  { key: 'attendance_730', label: '7:30 PM Attendance', icon: '🕢' },
  { key: 'yes_confirmation', label: 'Yes Confirmation', icon: '✅' },
  { key: 'day_1',  label: 'Day 1',  icon: '1️⃣' },
  { key: 'day_2',  label: 'Day 2',  icon: '2️⃣' },
  { key: 'day_3',  label: 'Day 3',  icon: '3️⃣' },
  { key: 'day_4',  label: 'Day 4',  icon: '4️⃣' },
  { key: 'day_5',  label: 'Day 5',  icon: '5️⃣' },
  { key: 'day_6',  label: 'Day 6',  icon: '6️⃣' },
  { key: 'day_7',  label: 'Day 7',  icon: '7️⃣' },
  { key: 'day_8',  label: 'Day 8',  icon: '8️⃣' },
  { key: 'day_9',  label: 'Day 9',  icon: '9️⃣' },
  { key: 'day_10', label: 'Day 10', icon: '🔟' },
  { key: 'day_11', label: 'Day 11', icon: '1️⃣1️⃣' },
  { key: 'day_12', label: 'Day 12', icon: '1️⃣2️⃣' },
  { key: 'day_13', label: 'Day 13', icon: '1️⃣3️⃣' },
  { key: 'day_14', label: 'Day 14', icon: '1️⃣4️⃣' },
  { key: 'day_15', label: 'Day 15', icon: '1️⃣5️⃣' },
] as const;

interface Props {
  leadId: string;
  isAdmin?: boolean;
}

export function WorkflowPanel({ leadId, isAdmin }: Props) {
  const { data: wfData, isLoading, isError } = useLeadWorkflow(leadId);
  const [openStep, setOpenStep] = useState<number | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);

  const currentStep = wfData?.current_step ?? 1;

  useEffect(() => {
    // Only auto-open on initial load, not when user manually closes
    if (wfData && openStep === null && !hasInteracted) {
      setOpenStep(currentStep <= 4 ? currentStep : null);
    }
  }, [wfData, currentStep, openStep, hasInteracted]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-8 w-8 rounded-xl bg-slate-200 animate-pulse" />
          <div className="h-5 w-40 bg-slate-200 rounded animate-pulse" />
        </div>
        {[1, 2, 3, 4].map(i => (
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

  const completedSteps = [
    !!wfData.workflow?.remark_status,
    !!wfData.workflow?.lead_level,
    !!wfData.workflow?.followup_completed,
    !!wfData.workflow?.conversion_completed,
  ];
  const completedCount = completedSteps.filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* Header + Progress */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-200">
            <TrendingUp className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Lead Workflow</h3>
            <p className="text-xs text-slate-500">
              {completedCount === 4
                ? 'All steps completed'
                : `Step ${currentStep} of 4 — ${STEP_CONFIG[currentStep - 1]?.label || 'Complete'}`}
            </p>
          </div>
        </div>
        {completedCount === 4 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1.5 text-xs font-bold text-green-700 shadow-sm">
            <CheckCircle2 className="h-4 w-4" /> Completed
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700">
            <Zap className="h-3.5 w-3.5" /> {completedCount}/4
          </span>
        )}
      </div>

      {/* Progress Bar */}
      <div className="flex items-center gap-2">
        {STEP_CONFIG.map((cfg, i) => {
          const done = completedSteps[i];
          const active = currentStep === i + 1;
          return (
            <div key={i} className="flex-1">
              <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={clsx(
                    'absolute inset-y-0 left-0 rounded-full transition-all duration-500',
                    done ? `bg-gradient-to-r ${cfg.gradient}` : active ? `bg-gradient-to-r ${cfg.gradient} opacity-50` : ''
                  )}
                  style={{ width: done ? '100%' : active ? '30%' : '0%' }}
                />
              </div>
              <p className={clsx(
                'mt-1 text-center text-[10px] font-semibold',
                done ? 'text-green-600' : active ? 'text-slate-700' : 'text-slate-400'
              )}>
                {cfg.label}
              </p>
            </div>
          );
        })}
      </div>

      {/* 4 Workflow Cards */}
      <div className="space-y-3">
        <StepCard
          step={1} config={STEP_CONFIG[0]}
          unlocked={currentStep >= 1} completed={completedSteps[0]}
          isOpen={openStep === 1} onToggle={() => { setHasInteracted(true); setOpenStep(openStep === 1 ? null : 1); }}
          savedValue={wfData.workflow?.remark_status ? (REMARK_DISPLAY[wfData.workflow.remark_status]?.label || humanize(wfData.workflow.remark_status)) : undefined}
          savedAt={wfData.workflow?.remark_saved_at || undefined}
        >
          <Step1Remark leadId={leadId} current={wfData.workflow?.remark_status || null} options={wfData.remark_options} />
        </StepCard>

        <StepCard
          step={2} config={STEP_CONFIG[1]}
          unlocked={currentStep >= 2} completed={completedSteps[1]}
          isOpen={openStep === 2} onToggle={() => { setHasInteracted(true); setOpenStep(openStep === 2 ? null : 2); }}
          savedValue={wfData.workflow?.lead_level ? (LEVEL_DISPLAY[wfData.workflow.lead_level]?.label || humanize(wfData.workflow.lead_level)) : undefined}
          savedAt={wfData.workflow?.lead_level_saved_at || undefined}
        >
          <Step2Level leadId={leadId} current={wfData.workflow?.lead_level || null} options={wfData.lead_level_options} />
        </StepCard>

        <StepCard
          step={3} config={STEP_CONFIG[2]}
          unlocked={currentStep >= 3} completed={completedSteps[2]}
          isOpen={openStep === 3} onToggle={() => { setHasInteracted(true); setOpenStep(openStep === 3 ? null : 3); }}
          savedValue={wfData.workflow?.followup_completed ? 'Follow-up complete' : undefined}
          savedAt={wfData.workflow?.followup_completed_at || undefined}
        >
          <Step3Followup leadId={leadId} tracker={wfData.followup_tracker} />
        </StepCard>

        <StepCard
          step={4} config={STEP_CONFIG[3]}
          unlocked={currentStep >= 4} completed={completedSteps[3]}
          isOpen={openStep === 4} onToggle={() => { setHasInteracted(true); setOpenStep(openStep === 4 ? null : 4); }}
          savedValue={wfData.conversion?.customer_type ? `${humanize(wfData.conversion.customer_type)} — ₹${Number(wfData.conversion.total_payment || 0).toLocaleString()}` : undefined}
          savedAt={wfData.conversion?.submitted_at || undefined}
        >
          <Step4Conversion leadId={leadId} conversion={wfData.conversion} completed={completedSteps[3]} />
        </StepCard>
      </div>

      {/* History toggle */}
      <WorkflowHistoryToggle leadId={leadId} />
    </div>
  );
}

/* ── Accordion Step Card ──────────────────────────────────────────── */

function StepCard({ step, config, unlocked, completed, isOpen, onToggle, savedValue, savedAt, children }: {
  step: number;
  config: typeof STEP_CONFIG[0];
  unlocked: boolean;
  completed: boolean;
  isOpen: boolean;
  onToggle: () => void;
  savedValue?: string;
  savedAt?: string;
  children: React.ReactNode;
}) {
  const Icon = config.icon;
  const locked = !unlocked;

  return (
    <div
      className={clsx(
        'rounded-2xl border-2 overflow-hidden transition-all duration-300',
        completed
          ? 'border-green-300 bg-gradient-to-r from-green-50 to-emerald-50 shadow-sm'
          : unlocked
            ? 'border-slate-200 bg-white shadow-md hover:shadow-lg'
            : 'border-slate-200 bg-slate-50 opacity-70'
      )}
    >
      <button
        onClick={unlocked ? onToggle : undefined}
        className={clsx(
          'flex w-full items-center gap-4 px-5 py-4 text-left transition-colors',
          unlocked && !completed && 'hover:bg-slate-50/50',
          locked && 'cursor-not-allowed'
        )}
      >
        <div className={clsx(
          'flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl shadow-lg transition-transform duration-200',
          completed
            ? 'bg-gradient-to-br from-green-400 to-emerald-500 shadow-green-200'
            : unlocked
              ? `bg-gradient-to-br ${config.gradient} shadow-slate-200`
              : 'bg-slate-300 shadow-none'
        )}>
          {completed ? (
            <CheckCircle2 className="h-6 w-6 text-white" />
          ) : locked ? (
            <Lock className="h-5 w-5 text-white/80" />
          ) : (
            <Icon className="h-6 w-6 text-white" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={clsx(
              'text-sm font-bold',
              completed ? 'text-green-700' : unlocked ? 'text-slate-900' : 'text-slate-400'
            )}>
              Step {step}: {config.label}
            </span>
            {completed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
                <CheckCircle2 className="h-3 w-3" /> Done
              </span>
            )}
            {locked && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                <Lock className="h-2.5 w-2.5" /> Locked
              </span>
            )}
          </div>
          {savedValue && (
            <div className="mt-0.5 flex items-center gap-2">
              <span className={clsx('inline-block rounded-md px-2 py-0.5 text-xs font-semibold', config.badge)}>
                {savedValue}
              </span>
              {savedAt && (
                <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
                  <Clock className="h-2.5 w-2.5" /> {fmtDate(savedAt)}
                </span>
              )}
            </div>
          )}
          {locked && (
            <p className="mt-0.5 text-[11px] text-slate-400">Complete Step {step - 1} to unlock</p>
          )}
        </div>

        {unlocked && (
          <div className={clsx(
            'flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200',
            isOpen ? 'bg-slate-200 rotate-90' : 'bg-slate-100'
          )}>
            <ChevronRight className="h-4 w-4 text-slate-600" />
          </div>
        )}
      </button>

      {unlocked && isOpen && (
        <div className="border-t border-slate-100 px-5 py-4 bg-white/80">
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Step 1: Remark System ───────────────────────────────────────── */

function Step1Remark({ leadId, current, options }: {
  leadId: string; current: string | null; options: string[];
}) {
  const save = useSaveRemark();

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3">Select the remark status for this lead:</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map(opt => {
          const display = REMARK_DISPLAY[opt] || { label: humanize(opt), bg: 'bg-slate-50', text: 'text-slate-700', ring: 'ring-slate-400' };
          const selected = current === opt;
          return (
            <button
              key={opt}
              disabled={save.isPending}
              onClick={() => save.mutate({ leadId, remark_status: opt }, {
                onSuccess: () => toast.success(`Remark: ${display.label}`),
                onError: () => toast.error('Failed to save remark'),
              })}
              className={clsx(
                'relative rounded-xl border-2 px-3 py-2.5 text-left text-xs font-semibold transition-all duration-200',
                selected
                  ? `${display.bg} ${display.text} border-current ring-2 ${display.ring} shadow-md scale-[1.02]`
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:shadow-sm hover:scale-[1.01]'
              )}
            >
              {save.isPending && <Loader2 className="absolute top-1 right-1 h-3 w-3 animate-spin text-slate-400" />}
              {selected && <CheckCircle2 className="absolute top-1 right-1 h-3.5 w-3.5 text-green-500" />}
              {display.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Step 2: Lead Level ──────────────────────────────────────────── */

function Step2Level({ leadId, current, options }: {
  leadId: string; current: string | null; options: string[];
}) {
  const save = useSaveLeadLevel();

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3">Classify the lead level:</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {options.map(opt => {
          const display = LEVEL_DISPLAY[opt] || { label: humanize(opt), bg: 'bg-slate-50', text: 'text-slate-700', ring: 'ring-slate-400' };
          const selected = current === opt;
          return (
            <button
              key={opt}
              disabled={save.isPending}
              onClick={() => save.mutate({ leadId, lead_level: opt }, {
                onSuccess: () => toast.success(`Level: ${display.label}`),
                onError: (e: any) => toast.error(e?.message || 'Failed'),
              })}
              className={clsx(
                'relative rounded-xl border-2 px-3 py-2.5 text-center text-xs font-semibold transition-all duration-200',
                selected
                  ? `${display.bg} ${display.text} border-current ring-2 ${display.ring} shadow-md scale-[1.02]`
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:shadow-sm hover:scale-[1.01]'
              )}
            >
              {selected && <CheckCircle2 className="absolute -top-1 -right-1 h-4 w-4 text-green-500 bg-white rounded-full" />}
              {display.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Step 3: Follow-up Tracker ────────────────────────────────────── */

function Step3Followup({ leadId, tracker }: {
  leadId: string; tracker: any;
}) {
  const update = useUpdateFollowup();
  const checkedCount = tracker ? FOLLOWUP_FIELDS.filter(f => tracker[f.key]).length : 0;
  const percentage = Math.round((checkedCount / FOLLOWUP_FIELDS.length) * 100);

  // Partner/member/RM/admin can move to Step 4 as soon as ANY one option is
  // picked. The previous rule required attendance + confirmation + one day
  // simultaneously, which blocked partial follow-up logging.
  const canProceed = checkedCount >= 1;

  function toggle(field: string, currentVal: boolean) {
    update.mutate({ leadId, [field]: !currentVal }, {
      onSuccess: (d) => {
        toast.success(d.all_complete ? 'Follow-up complete!' : `${humanize(field)} updated`);
      },
      onError: (e: any) => toast.error(e?.message || 'Failed'),
    });
  }

  function handleNext() {
    if (!canProceed) return;
    const payload: { leadId: string; [key: string]: any } = { leadId, _force_complete: true };
    for (const f of FOLLOWUP_FIELDS) {
      if (tracker?.[f.key]) payload[f.key] = true;
    }
    update.mutate(payload, {
      onSuccess: () => toast.success('Follow-up saved! Step 4 unlocked.'),
      onError: (e: any) => toast.error(e?.message || 'Failed'),
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-500">Select follow-up days (multi-select, any order):</p>
        <div className="flex items-center gap-2">
          <div className="h-2 w-24 rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all duration-500"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <span className="text-xs font-bold text-emerald-600">{checkedCount}/{FOLLOWUP_FIELDS.length}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {FOLLOWUP_FIELDS.map(({ key, label, icon }) => {
          const checked = tracker?.[key] ?? false;
          const ts = tracker?.[`${key}_at`];
          return (
            <button
              key={key}
              disabled={update.isPending}
              onClick={() => toggle(key, checked)}
              className={clsx(
                'flex items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 text-left transition-all duration-200',
                checked
                  ? 'border-emerald-300 bg-emerald-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
              )}
            >
              <div className={clsx(
                'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-sm transition-colors',
                checked ? 'bg-emerald-100' : 'bg-slate-100'
              )}>
                {checked ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <span className="text-xs">{icon}</span>}
              </div>
              <div className="min-w-0 flex-1">
                <p className={clsx('text-[11px] font-semibold truncate', checked ? 'text-emerald-700' : 'text-slate-700')}>
                  {label}
                </p>
                {ts && <p className="text-[9px] text-slate-400">{fmtDate(ts)}</p>}
              </div>
              {update.isPending && <Loader2 className="h-3 w-3 animate-spin text-slate-400 flex-shrink-0" />}
            </button>
          );
        })}
      </div>

      {/* Status pill — pick any combination; Next unlocks at 1+ selection */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
        <span className={clsx('inline-flex items-center gap-1 font-semibold', canProceed ? 'text-emerald-600' : 'text-slate-400')}>
          {canProceed ? <CheckCircle2 className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
          {canProceed ? `${checkedCount} selected — ready to proceed` : 'Select any 1 option to continue'}
        </span>
      </div>

      {/* NEXT Button */}
      <button
        onClick={handleNext}
        disabled={!canProceed || update.isPending}
        className={clsx(
          'mt-4 w-full rounded-xl py-3.5 text-sm font-bold shadow-lg transition-all duration-200',
          'inline-flex items-center justify-center gap-2',
          canProceed
            ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700 hover:shadow-xl hover:scale-[1.01] active:scale-[0.99]'
            : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
        )}
      >
        {update.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <ChevronRight className="h-5 w-5" />}
        {update.isPending ? 'Saving...' : canProceed ? 'NEXT — Unlock Step 4' : 'Select at least 1 option'}
      </button>
    </div>
  );
}

/* ── Step 4: Conversion ───────────────────────────────────────────── */

function Step4Conversion({ leadId, conversion, completed }: {
  leadId: string; conversion: any; completed: boolean;
}) {
  const save = useSaveConversion();
  const [form, setForm] = useState({
    followup_status: conversion?.followup_status || '',
    address: conversion?.address || '',
    total_payment: conversion?.total_payment || '',
    part_payment: conversion?.part_payment || '',
    customer_type: conversion?.customer_type || 'partner',
    services: conversion?.services || '',
  });

  function handleSave(markComplete: boolean) {
    if (!form.customer_type) { toast.error('Select customer type'); return; }
    save.mutate({
      leadId,
      followup_status: form.followup_status || undefined,
      address: form.address || undefined,
      total_payment: form.total_payment ? Number(form.total_payment) : undefined,
      part_payment: form.part_payment ? Number(form.part_payment) : undefined,
      customer_type: form.customer_type as 'partner' | 'trader',
      services: form.services || undefined,
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

        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Customer Type *</label>
          <div className="mt-1.5 flex gap-2">
            {(['partner', 'trader'] as const).map(type => (
              <button
                key={type}
                onClick={() => setForm(f => ({ ...f, customer_type: type }))}
                className={clsx(
                  'flex-1 rounded-xl border-2 py-3 text-sm font-bold transition-all',
                  form.customer_type === type
                    ? 'border-brand-400 bg-brand-50 text-brand-700 shadow-md'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                )}
              >
                {type === 'partner' ? '🤝' : '📈'} {humanize(type)}
              </button>
            ))}
          </div>
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
