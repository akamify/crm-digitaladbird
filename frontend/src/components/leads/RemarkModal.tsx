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

const STAGE_OPTS = [
  { value: '',          label: 'Keep stage as-is' },
  { value: 'new',       label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'follow_up', label: 'Follow-up' },
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

  const { mutate, isPending } = useAddRemark();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!remark.trim()) { toast.error('Remark is required'); return; }
    mutate(
      {
        id: leadId,
        remark: remark.trim(),
        call_status: status,
        stage: stage || undefined,
        next_followup_at: followAt ? new Date(followAt).toISOString() : null,
      },
      {
        onSuccess: () => {
          toast.success('Remark saved');
          setRemark(''); setStatus('not_called'); setStage(''); setFollowAt('');
          onClose();
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          toast.error(msg || 'Could not save remark');
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log call / add remark"
      description="Update call status and optionally schedule a followup. This releases your lead lock."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSubmit} loading={isPending}>Save remark</Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Textarea
          label="Remark / call notes"
          placeholder="What happened on the call?"
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          required
          autoFocus
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Call status"
            value={status}
            options={STATUS_OPTS}
            onChange={(e) => setStatus(e.target.value as CallStatus)}
          />
          <Select
            label="Move to stage"
            value={stage}
            options={STAGE_OPTS}
            onChange={(e) => setStage(e.target.value as LeadStage | '')}
          />
        </div>
        <Input
          type="datetime-local"
          label="Schedule followup (optional)"
          value={followAt}
          onChange={(e) => setFollowAt(e.target.value)}
          hint="Leave empty if no followup is needed."
        />
      </form>
    </Modal>
  );
}
