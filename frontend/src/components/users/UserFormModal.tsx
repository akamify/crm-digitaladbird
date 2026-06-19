'use client';
import { useEffect, useState, FormEvent } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { useCreateUser, useUpdateUser } from '@/hooks/useUsers';
import type { User, Role } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** When provided, modal is in edit mode. */
  initial?: User | null;
  /** RM list to populate report_to_id dropdown. */
  rms: User[];
}

const ROLE_OPTS: { value: Role; label: string }[] = [
  { value: 'member', label: 'Member' },
  { value: 'partner', label: 'Partner' },
  { value: 'rm',     label: 'Relationship Manager' },
  { value: 'super_admin', label: 'Super Admin' },
];

function userFormError(error: unknown) {
  return (error as { response?: { data?: { error?: { message?: string } | string } } })?.response?.data?.error;
}

export function UserFormModal({ open, onClose, initial, rms }: Props) {
  const editing = !!initial;
  const create  = useCreateUser();
  const update  = useUpdateUser();
  const busy    = create.isPending || update.isPending;

  const [name,   setName]   = useState('');
  const [email,  setEmail]  = useState('');
  const [phone,  setPhone]  = useState('');
  const [cpId,   setCpId]   = useState('');
  const [role,   setRole]   = useState<Role>('member');
  const [team,   setTeam]   = useState('');
  const [reportTo, setReportTo] = useState('');
  const [cap,    setCap]    = useState<number | ''>('');
  const [weight, setWeight] = useState<number | ''>(1);
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(initial?.full_name ?? '');
    setEmail(initial?.email ?? '');
    setPhone(initial?.phone ?? '');
    setCpId(initial?.cp_id ?? '');
    setRole(initial?.role ?? 'member');
    setTeam(initial?.team_name ?? '');
    setReportTo(initial?.report_to_id ?? '');
    setCap(initial?.daily_lead_cap ?? '');
    setWeight(initial?.distribution_weight ?? 1);
    setSendWelcomeEmail(true);
  }, [open, initial]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !phone.trim() || !cpId.trim()) {
      toast.error('Name, email, phone and CP ID are required'); return;
    }
    const payload = {
      full_name: name.trim(),
      email:     email.trim(),
      phone:     phone.trim(),
      cp_id:     cpId.trim().toUpperCase(),
      role,
      team_name: team || null,
      report_to_id: role === 'super_admin' ? null : (reportTo || null),
      daily_lead_cap: cap === '' ? null : Number(cap),
      distribution_weight: weight === '' ? 1 : Number(weight),
      ...(!editing ? { sendWelcomeEmail } : {}),
    };
    if (editing && initial) {
      update.mutate({ id: initial.id, ...payload }, {
        onSuccess: () => { toast.success('User updated'); onClose(); },
        onError: (err: unknown) => { const error = userFormError(err); toast.error(typeof error === 'string' ? error : error?.message || 'Update failed'); },
      });
    } else {
      create.mutate(payload, {
        onSuccess: (created) => { toast.success('User created'); if (created.emailWarning) toast.error(created.emailWarning); onClose(); },
        onError: (err: unknown) => { const error = userFormError(err); toast.error(typeof error === 'string' ? error : error?.message || 'Create failed'); },
      });
    }
  }

  return (
    <Modal
      open={open} onClose={onClose}
      title={editing ? 'Edit user' : 'Add team member'}
      description="The user can set a password through the secure onboarding email."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={handleSubmit} loading={busy}>{editing ? 'Save changes' : 'Create user'}</Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Full name" value={name}  onChange={(e) => setName(e.target.value)}  required />
        <Input label="Email"     value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        <Input label="Mobile (E.164)" value={phone} onChange={(e) => setPhone(e.target.value)}
               placeholder="+9198xxxxxxxx" hint="Include country code." required />
        <Input label="CP ID" value={cpId} onChange={(e) => setCpId(e.target.value.toUpperCase())}
               maxLength={40} required />
        <Select label="Role" value={role}
               options={ROLE_OPTS} onChange={(e) => setRole(e.target.value as Role)} />
        <Input  label="Team / department" value={team} onChange={(e) => setTeam(e.target.value)}
               placeholder="e.g. Sales North" />
        <Select label="Reports to"
               value={reportTo}
               placeholder="—"
               options={rms.map(u => ({ value: u.id, label: `${u.full_name} · ${u.role}` }))}
               onChange={(e) => setReportTo(e.target.value)}
               hint="RMs report to admins; members report to RMs." />
        <Input  label="Daily lead cap"
               type="number" min={0}
               value={cap} onChange={(e) => setCap(e.target.value === '' ? '' : Number(e.target.value))}
               hint="Leave blank for unlimited." />
        <Input  label="Distribution weight"
               type="number" min={0} step="0.1"
               value={weight} onChange={(e) => setWeight(e.target.value === '' ? '' : Number(e.target.value))}
               hint="Used by the weighted distribution strategy." />
        {!editing && <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2"><input type="checkbox" checked={sendWelcomeEmail} onChange={(e) => setSendWelcomeEmail(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />Send onboarding email with password setup link</label>}
      </form>
    </Modal>
  );
}
