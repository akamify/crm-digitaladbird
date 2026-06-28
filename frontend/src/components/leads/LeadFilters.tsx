'use client';
import { ChangeEvent } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Input';
import { useCampaignNames } from '@/hooks/useLeads';
import type { LeadFilters } from '@/types';

interface Props {
  value: LeadFilters;
  onChange: (next: LeadFilters) => void;
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
  { value: 'not_called',     label: 'Not Called' },
  { value: 'talk_response',  label: 'Connected' },
  { value: 'busy',           label: 'Busy' },
  { value: 'callback_requested', label: 'Call Back Later' },
  { value: 'interested',     label: 'Interested' },
  { value: 'follow_up',      label: 'Follow-up Scheduled' },
  { value: 'converted',      label: 'Converted' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'wrong_number',   label: 'Wrong Number' },
  { value: 'switched_off',   label: 'Switch Off' },
  { value: 'nn',             label: 'No Network' },
];

const FOLLOWUP_OPTS = [
  { value: '', label: 'All followups' },
  { value: 'today', label: 'Due today' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'upcoming', label: 'Upcoming' },
];

const CATEGORY_OPTS = [
  { value: '', label: 'All categories' },
  { value: 'trader', label: 'Trader Leads' },
  { value: 'partner', label: 'Partner Leads' },
  { value: 'unknown', label: 'Unknown' },
];

export function LeadFilters({ value, onChange }: Props) {
  const set = <K extends keyof LeadFilters>(k: K, v: LeadFilters[K]) =>
    onChange({ ...value, [k]: v, page: 1 });

  const { data: campaignNames } = useCampaignNames();
  const campaignOpts = [
    { value: '', label: 'All campaigns' },
    ...(campaignNames || []).map(n => ({ value: n, label: n })),
  ];

  const hasFilters = !!(value.q || value.category || value.stage || value.call_status || value.followup || value.source || value.campaign || value.from || value.to || value.pending);

  return (
    <div className="card p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Input
            placeholder="Search name, phone, email…"
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
        <Select
          value={value.followup || ''}
          options={FOLLOWUP_OPTS}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('followup', e.target.value as LeadFilters['followup'])}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 flex items-center gap-3 sm:grid-cols-6">
        <Select
          value={value.category || ''}
          options={CATEGORY_OPTS}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('category', e.target.value as LeadFilters['category'])}
        />
        <Select
          value={value.campaign || ''}
          options={campaignOpts}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => set('campaign', e.target.value)}
        />
        <Input
          type="date" label="From"
          value={value.from || ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => set('from', e.target.value)}
        />
        <Input
          type="date" label="To"
          value={value.to || ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => set('to', e.target.value)}
        />
        <div className="flex items-end">
          {hasFilters && (
            <button
              onClick={() => onChange({ page: 1, page_size: value.page_size })}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs text-slate-600 hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" /> Clear filters
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
