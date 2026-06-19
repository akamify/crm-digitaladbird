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
    .filter(u => (u.role === 'member' || u.role === 'partner') && u.is_active !== false)
    .map(u => ({ value: u.id, label: `${u.full_name} - ${u.role === 'partner' ? 'Partner' : 'Member'}` }));

  function errorMessage(err: unknown) {
    const data = (err as { response?: { data?: { code?: string; message?: string; error?: { code?: string; message?: string } } } })?.response?.data;
    const code = data?.code || data?.error?.code;
    if (code === 'INVALID_LEAD_ASSIGNEE_ROLE') {
      return 'Lead assignment is allowed only for Members and Partners. RM users can manage teams but cannot receive direct leads.';
    }
    return data?.message || data?.error?.message || 'Could not reassign';
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userId) { toast.error('Pick a team member'); return; }
    mutate({ id: leadId, userId, reason: reason || undefined }, {
      onSuccess: () => { toast.success('Lead reassigned'); setUserId(''); setReason(''); onClose(); },
      onError: (err: unknown) => {
        toast.error(errorMessage(err));
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
          label="Assign to" value={userId} options={opts} placeholder="Choose member or partner..."
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
