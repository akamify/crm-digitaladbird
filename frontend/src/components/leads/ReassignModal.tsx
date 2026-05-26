'use client';
import { useState, FormEvent } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select, Input } from '@/components/ui/Input';
import { useReassignLead } from '@/hooks/useLeads';
import { useUsers } from '@/hooks/useUsers';

interface Props {
  leadId: string;
  open: boolean;
  onClose: () => void;
}

export function ReassignModal({ leadId, open, onClose }: Props) {
  const { data: users } = useUsers();
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const { mutate, isPending } = useReassignLead();

  const opts = (users ?? [])
    .filter(u => u.role !== 'super_admin' && u.is_active !== false)
    .map(u => ({ value: u.id, label: `${u.full_name} · ${u.role}` }));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userId) { toast.error('Pick a team member'); return; }
    mutate({ id: leadId, userId, reason: reason || undefined }, {
      onSuccess: () => { toast.success('Lead reassigned'); setUserId(''); setReason(''); onClose(); },
      onError: (err: unknown) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast.error(msg || 'Could not reassign');
      },
    });
  }

  return (
    <Modal
      open={open} onClose={onClose}
      title="Reassign lead"
      description="Move this lead to another team member and log the reason."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSubmit} loading={isPending}>Reassign</Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          label="Assign to" value={userId} options={opts} placeholder="Choose user…"
          onChange={(e) => setUserId(e.target.value)} required
        />
        <Input
          label="Reason (optional)" placeholder="e.g. on leave, conflict of interest"
          value={reason} onChange={(e) => setReason(e.target.value)}
        />
      </form>
    </Modal>
  );
}
