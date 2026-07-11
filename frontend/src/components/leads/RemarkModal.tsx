'use client';
import { useState, FormEvent } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useAddRemark } from '@/hooks/useLeads';
import type { CallStatus, LeadStage } from '@/types';
import { LEAD_REMARK_GROUPS } from '@/constants/leadRemarkOptions';
import { clsx } from '@/lib/format';

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
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="mb-3 block text-sm font-semibold text-slate-900">Call Status</label>
          <div className="space-y-4">
            {LEAD_REMARK_GROUPS.map(group => (
              <div key={group.key}>
                <p className={clsx('mb-2 text-xs font-medium uppercase tracking-wide', {
                  emerald: 'text-emerald-700', sky: 'text-sky-700', amber: 'text-amber-700', slate: 'text-slate-500',
                }[group.tone])}>{group.label}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {group.options.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setStatus(option.value as CallStatus)}
                      className={clsx(
                        'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                        status === option.value
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Move to Stage</label>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value as LeadStage | '')}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              {STAGE_OPTS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Follow-up Date & Time</label>
            <input
              type="datetime-local"
              value={followAt}
              min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
              onChange={(e) => setFollowAt(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <p className="mt-1 text-xs text-slate-500">Optional. Must be in the future.</p>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Remark <span className="text-slate-400 font-normal">(Optional)</span></label>
          <textarea
            placeholder="Add a concise call outcome or customer note..."
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 resize-none"
          />
        </div>
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 transition-colors hover:bg-slate-100">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            checked={releaseLock}
            onChange={event => setReleaseLock(event.target.checked)}
          />
          <div>
            <span className="font-medium text-slate-900">Release lead lock after saving</span>
            <p className="mt-0.5 text-xs text-slate-500">Keep unchecked only when you are continuing work on this lead.</p>
          </div>
        </label>
      </form>
    </Modal>
  );
}
