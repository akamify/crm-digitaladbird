'use client';
import { useState, FormEvent } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select, Textarea, Input } from '@/components/ui/Input';
import { useAddRemark } from '@/hooks/useLeads';
import type { CallStatus, LeadStage } from '@/types';

const STATUS_OPTS = [
  { value: 'not_called',     label: 'Not Called' },
  { value: 'talk_response',  label: 'Connected' },
  { value: 'rnr',            label: 'Missed' },
  { value: 'busy',           label: 'Busy' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'converted',      label: 'Converted' },
];

const STAGE_OPTS = [
  { value: '',          label: 'Keep stage as-is' },
  { value: 'new',       label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'proposal',  label: 'Proposal / Follow-up' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'won',       label: 'Won' },
  { value: 'lost',      label: 'Lost' },
];

interface Props {
  leadId: string;
  open: boolean;
  onClose: () => void;
}

export function RemarkModal({ leadId, open, onClose }: Props) {
  const [remark,   setRemark]   = useState('');
  const [status,   setStatus]   = useState<CallStatus>('not_called');
  const [stage,    setStage]    = useState<LeadStage | ''>('');
  const [followAt, setFollowAt] = useState('');
  const [releaseLock, setReleaseLock] = useState(true);

  const { mutate, isPending } = useAddRemark();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const meaningful = ['talk_response', 'not_interested', 'converted'].includes(status);
    if (meaningful && !remark.trim()) { toast.error('Remark is required for this call status'); return; }
    if (!remark.trim()) { toast.error('Remark is required'); return; }
    if (followAt && new Date(followAt).getTime() <= Date.now()) { toast.error('Follow-up must be scheduled in the future'); return; }
    mutate(
      {
        id: leadId,
        remark: remark.trim(),
        call_status: status,
        stage: stage || undefined,
        next_followup_at: followAt ? new Date(followAt).toISOString() : null,
        release_lock: releaseLock,
      },
      {
        onSuccess: () => {
          toast.success('Remark saved');
          setRemark(''); setStatus('not_called'); setStage(''); setFollowAt(''); setReleaseLock(true);
          onClose();
        },
        onError: (err: unknown) => {
          const data = (err as { response?: { data?: { message?: string; error?: string | { message?: string } } } })?.response?.data;
          toast.error(data?.message || (typeof data?.error === 'string' ? data.error : data?.error?.message) || 'Could not save remark');
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Remark"
      description="Record the outcome, next stage, and follow-up in one update."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSubmit} loading={isPending}>Save Remark</Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">Call status</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {STATUS_OPTS.map(option => <button key={option.value} type="button" onClick={() => setStatus(option.value as CallStatus)} className={status === option.value ? 'rounded-lg border border-brand-500 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700' : 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:border-slate-300'}>{option.label}</button>)}
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Move to stage"
            value={stage}
            options={STAGE_OPTS}
            onChange={(e) => setStage(e.target.value as LeadStage | '')}
          />
          <Input
            type="datetime-local"
            label="Follow-up date and time"
            value={followAt}
            min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
            onChange={(e) => setFollowAt(e.target.value)}
            hint="Optional. Must be in the future."
          />
        </div>
        <Textarea
          label="Remark"
          placeholder="Add a concise call outcome or customer note..."
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          required
          autoFocus
        />
        <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700"><input type="checkbox" className="mt-0.5" checked={releaseLock} onChange={event => setReleaseLock(event.target.checked)} /><span><span className="font-medium">Release lead lock after saving</span><span className="mt-0.5 block text-xs text-slate-500">Keep unchecked only when you are continuing work on this lead.</span></span></label>
      </form>
    </Modal>
  );
}
