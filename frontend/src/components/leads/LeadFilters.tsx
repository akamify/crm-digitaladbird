'use client';
import { ChangeEvent, useState } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Input';
import { clsx } from '@/lib/format';
import { useCampaignNames } from '@/hooks/useLeads';
import { useLabels } from '@/hooks/useLeadLabels';
import { LEAD_REMARK_GROUPS } from '@/constants/leadRemarkOptions';
import {
  LEAD_REMARK_CATEGORY_OPTIONS,
  LEAD_REMARK_CUSTOMER_INTEREST_OPTIONS,
  LEAD_REMARK_NOTE_TYPE_OPTIONS,
  LEAD_REMARK_PRIORITY_OPTIONS,
} from '@/constants/leadRemarkMeta';
import type { LeadFilters } from '@/types';

interface Props {
  value: LeadFilters;
  onChange: (next: LeadFilters) => void;
  simplifiedAdmin?: boolean;
}

const STAGE_OPTS = [
  { value: '', label: 'All stages' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

const STATUS_OPTS = [
  { value: '', label: 'All call statuses' },
  { value: 'not_called', label: 'Not Called' },
  { value: 'talk_response', label: 'Connected' },
  { value: 'busy', label: 'Busy' },
  { value: 'callback_requested', label: 'Call Back Later' },
  { value: 'interested', label: 'Interested' },
  { value: 'follow_up', label: 'Follow-up Scheduled' },
  { value: 'converted', label: 'Converted' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'wrong_number', label: 'Wrong Number' },
  { value: 'call_cut_busy', label: 'Call Cut / Busy' },
  { value: 'switched_off', label: 'Switch Off' },
  { value: 'nn', label: 'No Network' },
];

const FOLLOWUP_OPTS = [
  { value: '', label: 'All followups' },
  { value: 'today', label: 'Due today' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'no_followup', label: 'No follow-up' },
];

const CATEGORY_OPTS = [
  { value: '', label: 'All categories' },
  { value: 'trader', label: 'Trader Leads' },
  { value: 'partner', label: 'Partner Leads' },
  { value: 'unknown', label: 'Unknown' },
];

const ASSIGNMENT_OPTS = [
  { value: '', label: 'All assignment' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'unassigned', label: 'Unassigned' },
];

const SOURCE_OPTS = [
  { value: '', label: 'All sources' },
  { value: 'manual', label: 'Manual' },
  { value: 'meta', label: 'Meta' },
  { value: 'google_sheet', label: 'Google Sheet' },
  { value: 'import', label: 'Import' },
];

const REMARK_STATUS_OPTS = [
  { value: '', label: 'All remarks' },
  ...LEAD_REMARK_GROUPS.flatMap(group => [
    { value: `__group_${group.key}`, label: group.label, disabled: true },
    ...group.options.map(option => ({ value: option.value, label: `  ${option.label}` })),
  ]),
];

const SESSION_OPTS = [
  { value: '', label: 'All sessions' },
  { value: 'has_session', label: 'Session attended' },
  { value: 'no_session', label: 'No session added' },
];

const WORKFLOW_OPTS = [
  { value: '', label: 'All workflow' },
  { value: 'step_1_pending', label: 'Step 1 Pending' },
  { value: 'step_1_completed', label: 'Step 1 Completed' },
  { value: 'step_2_unlocked', label: 'Step 2 Unlocked' },
  { value: 'completed_response', label: 'Completed Response' },
];

const LATEST_ACTIVITY_OPTS = [
  { value: '', label: 'Any activity' },
  { value: 'today', label: 'Activity today' },
  { value: 'yesterday', label: 'Activity yesterday' },
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
];

function optionLabel(options: { value: string; label: string }[], value?: string) {
  return options.find(option => option.value === value)?.label?.trim() || value || '';
}

export function LeadFilters({ value, onChange, simplifiedAdmin = false }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const set = <K extends keyof LeadFilters>(k: K, v: LeadFilters[K]) =>
    onChange({ ...value, [k]: v, page: 1 });

  const { data: campaignNames } = useCampaignNames();
  const { data: labels } = useLabels();
  const campaignOpts = [
    { value: '', label: 'All campaigns' },
    ...(campaignNames || []).map(n => ({ value: n, label: n })),
  ];

  const hasFilters = !!(
    value.q || value.category || value.stage || value.call_status || value.followup || value.source || value.campaign
    || value.pending || (!simplifiedAdmin && value.assignment) || value.label_id || value.remark_status || value.customer_interest
    || value.workflow_status || value.latest_activity || value.call_issues
    || (!simplifiedAdmin && (value.from || value.to || value.created_preset || value.note_type || value.note_category
      || value.priority || value.has_rm_update || value.updated_by_rm || value.session_attendance || value.no_remark))
  );
  const labelOpts = [{ value: '', label: 'All labels' }, ...(labels || []).map(label => ({ value: label.id, label: label.name }))];
  const activeChips = [
    value.category && { key: 'category', label: `Category: ${optionLabel(CATEGORY_OPTS, value.category)}` },
    value.stage && { key: 'stage', label: `Stage: ${optionLabel(STAGE_OPTS, value.stage)}` },
    value.call_status && { key: 'call_status', label: `Call: ${optionLabel(STATUS_OPTS, value.call_status)}` },
    value.remark_status && { key: 'remark_status', label: `Remark: ${optionLabel(REMARK_STATUS_OPTS, value.remark_status)}` },
    value.workflow_status && { key: 'workflow_status', label: `Workflow: ${optionLabel(WORKFLOW_OPTS, value.workflow_status)}` },
    value.followup && { key: 'followup', label: `Follow-up: ${optionLabel(FOLLOWUP_OPTS, value.followup)}` },
    !simplifiedAdmin && value.session_attendance && { key: 'session_attendance', label: `Session: ${optionLabel(SESSION_OPTS, value.session_attendance)}` },
    !simplifiedAdmin && value.assignment && { key: 'assignment', label: `Assignment: ${optionLabel(ASSIGNMENT_OPTS, value.assignment)}` },
    value.source && { key: 'source', label: `Source: ${optionLabel(SOURCE_OPTS, value.source)}` },
    value.campaign && { key: 'campaign', label: `Campaign: ${value.campaign}` },
    value.label_id && { key: 'label_id', label: `Label: ${optionLabel(labelOpts, value.label_id)}` },
    value.latest_activity && { key: 'latest_activity', label: `Activity: ${optionLabel(LATEST_ACTIVITY_OPTS, value.latest_activity)}` },
    value.call_issues === 'true' && { key: 'call_issues', label: 'Call Issues' },
    !simplifiedAdmin && value.no_remark === 'true' && { key: 'no_remark', label: 'No remark' },
    !simplifiedAdmin && value.note_type && { key: 'note_type', label: `Note Type: ${optionLabel([{ value: '', label: '' }, ...LEAD_REMARK_NOTE_TYPE_OPTIONS], value.note_type)}` },
    !simplifiedAdmin && value.note_category && { key: 'note_category', label: `Note Category: ${optionLabel([{ value: '', label: '' }, ...LEAD_REMARK_CATEGORY_OPTIONS], value.note_category)}` },
    !simplifiedAdmin && value.priority && { key: 'priority', label: `Priority: ${optionLabel([{ value: '', label: '' }, ...LEAD_REMARK_PRIORITY_OPTIONS], value.priority)}` },
    value.customer_interest && { key: 'customer_interest', label: `Interest: ${optionLabel([{ value: '', label: '' }, ...LEAD_REMARK_CUSTOMER_INTEREST_OPTIONS], value.customer_interest)}` },
    !simplifiedAdmin && value.has_rm_update && { key: 'has_rm_update', label: `RM Update: ${value.has_rm_update === 'true' ? 'Yes' : 'No'}` },
  ].filter(Boolean) as { key: keyof LeadFilters; label: string }[];
  const advancedFilterCount = [
    value.category, value.source, value.campaign, value.label_id, value.remark_status,
    value.workflow_status, value.latest_activity, value.customer_interest,
    ...(!simplifiedAdmin ? [value.session_attendance, value.no_remark, value.note_type, value.note_category, value.priority, value.has_rm_update] : []),
  ].filter(Boolean).length;

  function clearFilters() {
    onChange({
      page: 1,
      page_size: value.page_size,
      selected_date: value.selected_date,
      daily_metric: value.daily_metric,
      ...(simplifiedAdmin ? {
        lead_view: value.lead_view,
        from: value.from,
        to: value.to,
        all_time_metric: value.all_time_metric,
        assignment: value.assignment,
      } : {}),
    });
  }

  return (
    <div className="card p-3 sm:p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="sm:col-span-2 xl:col-span-2">
          <Input
            placeholder="Search name, phone, email..."
            value={value.q || ''}
            onChange={(e: ChangeEvent<HTMLInputElement>) => set('q', e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
          />
        </div>
        <Select
          value={value.stage || ''}
          options={STAGE_OPTS}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('stage', e.target.value as LeadFilters['stage'])}
        />
        <Select
          value={value.call_status || ''}
          options={STATUS_OPTS}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('call_status', e.target.value as LeadFilters['call_status'])}
        />
        <div className={clsx(showAdvanced ? 'contents' : 'hidden sm:contents')}>
        <Select
          value={value.followup || ''}
          options={FOLLOWUP_OPTS}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('followup', e.target.value as LeadFilters['followup'])}
        />
        {!simplifiedAdmin && <Select
          value={value.assignment || ''}
          options={ASSIGNMENT_OPTS}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('assignment', e.target.value as LeadFilters['assignment'])}
        />}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <button type="button" onClick={() => setShowAdvanced(open => !open)} className={clsx('inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition sm:min-h-9', showAdvanced || advancedFilterCount ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')} aria-expanded={showAdvanced}>
          <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
          {activeChips.length > 0 && <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] text-white">{activeChips.length}</span>}
          <ChevronDown className={clsx('h-3.5 w-3.5 transition', showAdvanced && 'rotate-180')} />
        </button>
        {hasFilters && <button type="button" onClick={clearFilters} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800 sm:min-h-9"><X className="h-3.5 w-3.5" /> Clear all</button>}
      </div>

      {showAdvanced && <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
        <Select
          value={value.category || ''}
          options={CATEGORY_OPTS}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('category', e.target.value as LeadFilters['category'])}
        />
        <Select
          value={value.source || ''}
          options={SOURCE_OPTS}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('source', e.target.value)}
        />
        <Select
          value={value.campaign || ''}
          options={campaignOpts}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('campaign', e.target.value)}
        />
        <Select
          value={value.label_id || ''}
          options={labelOpts}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('label_id', e.target.value)}
        />
        <Select
          value={value.remark_status || ''}
          options={REMARK_STATUS_OPTS}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('remark_status', e.target.value as LeadFilters['remark_status'])}
        />
        {!simplifiedAdmin && <Select
          value={value.session_attendance || ''}
          options={SESSION_OPTS}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('session_attendance', e.target.value as LeadFilters['session_attendance'])}
        />}
        <Select
          value={value.workflow_status || ''}
          options={WORKFLOW_OPTS}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('workflow_status', e.target.value as LeadFilters['workflow_status'])}
        />
        <Select
          value={value.latest_activity || ''}
          options={LATEST_ACTIVITY_OPTS}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('latest_activity', e.target.value as LeadFilters['latest_activity'])}
        />
        {!simplifiedAdmin && <Select
          value={value.no_remark || ''}
          options={[{ value: '', label: 'All remark state' }, { value: 'true', label: 'No remark yet' }]}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('no_remark', e.target.value as LeadFilters['no_remark'])}
        />}
        {!simplifiedAdmin && <Select
          value={value.note_type || ''}
          options={[{ value: '', label: 'All note types' }, ...LEAD_REMARK_NOTE_TYPE_OPTIONS.map(option => ({ value: option.value, label: option.label }))]}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('note_type', e.target.value as LeadFilters['note_type'])}
        />}
        {!simplifiedAdmin && <Select
          value={value.note_category || ''}
          options={[{ value: '', label: 'All note categories' }, ...LEAD_REMARK_CATEGORY_OPTIONS.map(option => ({ value: option.value, label: option.label }))]}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('note_category', e.target.value as LeadFilters['note_category'])}
        />}
        {!simplifiedAdmin && <Select
          value={value.priority || ''}
          options={[{ value: '', label: 'All priorities' }, ...LEAD_REMARK_PRIORITY_OPTIONS.map(option => ({ value: option.value, label: option.label }))]}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('priority', e.target.value as LeadFilters['priority'])}
        />}
        <Select
          value={value.customer_interest || ''}
          options={[{ value: '', label: 'All customer interests' }, ...LEAD_REMARK_CUSTOMER_INTEREST_OPTIONS.map(option => ({ value: option.value, label: option.label }))]}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('customer_interest', e.target.value as LeadFilters['customer_interest'])}
        />
        {!simplifiedAdmin && <Select
          value={value.has_rm_update || ''}
          options={[{ value: '', label: 'RM update state' }, { value: 'true', label: 'Has RM update' }, { value: 'false', label: 'No RM update' }]}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('has_rm_update', e.target.value as LeadFilters['has_rm_update'])}
        />}
        {!simplifiedAdmin && <Input
          type="date" label="From"
          value={value.from || ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, from: e.target.value, created_preset: '', page: 1 })}
        />}
        {!simplifiedAdmin && <Input
          type="date" label="To"
          value={value.to || ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, to: e.target.value, created_preset: '', page: 1 })}
        />}
      </div>}
      {activeChips.length > 0 && (
        <div className="scroll-thin mt-3 flex snap-x gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
          {activeChips.map(chip => (
            <button
              key={String(chip.key)}
              type="button"
              onClick={() => set(chip.key, '' as never)}
              className="inline-flex min-h-9 shrink-0 snap-start items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 hover:bg-white"
              title="Remove filter"
            >
              {chip.label}<X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
