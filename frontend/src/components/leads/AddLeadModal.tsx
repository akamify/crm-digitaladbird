'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import toast from 'react-hot-toast';
import { Modal, StatusChip } from '@/components/ui/Modal';
import { useLabels } from '@/hooks/useLeadLabels';
import { ManualLeadInput, useCreateManualLead } from '@/hooks/useLeads';
import { LEAD_REMARK_GROUPS } from '@/constants/leadRemarkOptions';
import { clsx } from '@/lib/format';
import type { CallStatus, LeadCategory, LeadStage } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_OPTIONS: Array<{ value: LeadCategory | ''; label: string }> = [
  { value: '', label: 'Select category' },
  { value: 'partner', label: 'Partner Lead' },
  { value: 'trader', label: 'Trader Lead' },
  { value: 'unknown', label: 'Unknown' },
];

const STAGE_OPTIONS: Array<{ value: LeadStage | ''; label: string }> = [
  { value: '', label: 'Select stage' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

const STATUS_OPTIONS = LEAD_REMARK_GROUPS.flatMap(group => group.options);

function getErrorMessage(error: unknown) {
  const maybe = error as { response?: { data?: { error?: { message?: string }; message?: string } } };
  return maybe?.response?.data?.error?.message || maybe?.response?.data?.message || 'Could not add manual lead';
}

function initialForm(): ManualLeadInput {
  return {
    full_name: '',
    phone: '',
    alternate_phone: '',
    email: '',
    city: '',
    state: '',
    category: '',
    stage: '',
    call_status: '',
    next_followup_at: '',
    label_ids: [],
    initial_remark: '',
  };
}

export function AddLeadModal({ open, onClose }: Props) {
  const [form, setForm] = useState<ManualLeadInput>(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const labels = useLabels();
  const create = useCreateManualLead();

  const selectedLabels = useMemo(() => new Set(form.label_ids || []), [form.label_ids]);

  function setField<K extends keyof ManualLeadInput>(key: K, value: ManualLeadInput[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => ({ ...prev, [key]: '' }));
  }

  function toggleLabel(labelId: string) {
    const next = selectedLabels.has(labelId)
      ? (form.label_ids || []).filter(id => id !== labelId)
      : [...(form.label_ids || []), labelId];
    setField('label_ids', next);
  }

  function validate() {
    const next: Record<string, string> = {};
    if (!form.full_name.trim()) next.full_name = 'Name is required.';
    if (!form.phone.trim()) next.phone = 'Phone is required.';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'Enter a valid email.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function submit() {
    if (!validate()) return;
    const payload: ManualLeadInput = {
      ...form,
      full_name: form.full_name.trim(),
      phone: form.phone.trim(),
      alternate_phone: form.alternate_phone?.trim() || undefined,
      email: form.email?.trim() || undefined,
      city: form.city?.trim() || undefined,
      state: form.state?.trim() || undefined,
      category: form.category || undefined,
      stage: form.stage || undefined,
      call_status: form.call_status || undefined,
      next_followup_at: form.next_followup_at || undefined,
      initial_remark: form.initial_remark?.trim() || undefined,
      label_ids: form.label_ids || [],
    };
    create.mutate(payload, {
      onSuccess: () => {
        toast.success('Manual lead added');
        setForm(initialForm());
        setErrors({});
        onClose();
      },
      onError: error => toast.error(getErrorMessage(error)),
    });
  }

  function close() {
    if (create.isPending) return;
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add Lead"
      description="Create a single manual lead."
      size="lg"
      footer={(
        <>
          <button type="button" onClick={close} disabled={create.isPending} className="btn-outline rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button type="button" onClick={submit} disabled={create.isPending} className="btn-primary rounded-lg px-4 py-2 text-sm">
            {create.isPending ? 'Adding...' : 'Add Lead'}
          </button>
        </>
      )}
    >
      <div className="space-y-5">
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          This lead will be saved with source Manual and your user details.
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required error={errors.full_name}>
            <input className="input w-full" value={form.full_name} onChange={event => setField('full_name', event.target.value)} />
          </Field>
          <Field label="Phone" required error={errors.phone}>
            <input className="input w-full" value={form.phone} onChange={event => setField('phone', event.target.value)} inputMode="tel" />
          </Field>
          <Field label="Alternate Phone">
            <input className="input w-full" value={form.alternate_phone || ''} onChange={event => setField('alternate_phone', event.target.value)} inputMode="tel" />
          </Field>
          <Field label="Email" error={errors.email}>
            <input className="input w-full" value={form.email || ''} onChange={event => setField('email', event.target.value)} type="email" />
          </Field>
          <Field label="City">
            <input className="input w-full" value={form.city || ''} onChange={event => setField('city', event.target.value)} />
          </Field>
          <Field label="State">
            <input className="input w-full" value={form.state || ''} onChange={event => setField('state', event.target.value)} />
          </Field>
          <Field label="Category">
            <select className="input w-full" value={form.category || ''} onChange={event => setField('category', event.target.value as LeadCategory | '')}>
              {CATEGORY_OPTIONS.map(option => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Stage">
            <select className="input w-full" value={form.stage || ''} onChange={event => setField('stage', event.target.value as LeadStage | '')}>
              {STAGE_OPTIONS.map(option => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Call Status">
            <select className="input w-full" value={form.call_status || ''} onChange={event => setField('call_status', event.target.value as CallStatus | '')}>
              <option value="">Select status</option>
              {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Next Follow-up">
            <input className="input w-full" value={form.next_followup_at || ''} onChange={event => setField('next_followup_at', event.target.value)} type="datetime-local" />
          </Field>
        </div>

        <Field label="Labels">
          <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {labels.isLoading ? (
              <p className="px-2 py-4 text-center text-xs text-slate-500">Loading labels...</p>
            ) : (labels.data || []).length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-slate-500">No labels available.</p>
            ) : (
              (labels.data || []).map(label => {
                const selected = selectedLabels.has(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => toggleLabel(label.id)}
                    className={clsx(
                      'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition',
                      selected ? 'bg-brand-50 text-brand-800' : 'hover:bg-slate-50',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: label.color }} />
                      <span className="truncate">{label.name}</span>
                    </span>
                    <span className={selected ? 'chip-green' : 'chip-slate'}>{selected ? 'Selected' : 'Add'}</span>
                  </button>
                );
              })
            )}
          </div>
        </Field>

        {form.call_status && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            Selected status: <StatusChip status={form.call_status} />
          </div>
        )}

        <Field label="Initial Remark">
          <textarea className="input min-h-[100px] w-full resize-y" value={form.initial_remark || ''} onChange={event => setField('initial_remark', event.target.value)} placeholder="Optional note" />
        </Field>
      </div>
    </Modal>
  );
}

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-slate-700">{label}{required && <span className="text-rose-500"> *</span>}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}
