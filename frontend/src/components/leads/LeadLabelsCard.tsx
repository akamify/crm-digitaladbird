'use client';

import { useEffect, useState } from 'react';
import { Plus, Tag, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal, Skeleton } from '@/components/ui/Modal';
import {
  useAssignLeadLabel,
  useCreateLeadLabel,
  useLabels,
  useLeadLabels,
  useRemoveLeadLabel,
} from '@/hooks/useLeadLabels';

const COLORS = ['#2563EB', '#16A34A', '#EA580C', '#9333EA', '#DC2626', '#0891B2', '#475569'];

export function LeadLabelsCard({ leadId, canManage, createSignal = 0 }: { leadId: string; canManage: boolean; createSignal?: number }) {
  const [selectedLabelId, setSelectedLabelId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const labels = useLabels();
  const assigned = useLeadLabels(leadId);
  const assign = useAssignLeadLabel();
  const remove = useRemoveLeadLabel();
  const assignedIds = new Set((assigned.data || []).map(label => label.id));
  const available = (labels.data || []).filter(label => !assignedIds.has(label.id));

  useEffect(() => {
    if (createSignal > 0 && canManage) setCreateOpen(true);
  }, [createSignal, canManage]);

  function assignSelected() {
    if (!selectedLabelId) return;
    assign.mutate({ leadId, labelId: selectedLabelId }, {
      onSuccess: () => { setSelectedLabelId(''); toast.success('Label assigned'); },
      onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Could not assign label'),
    });
  }

  return (
    <section className="card-padded">
      <div className="mb-3 flex items-center gap-2"><Tag className="h-4 w-4 text-brand-600" /><h2 className="text-sm font-semibold text-slate-900">Labels</h2></div>
      {assigned.isLoading ? <Skeleton className="h-10" /> : (
        <div className="flex flex-wrap gap-2">
          {(assigned.data || []).length === 0 && <span className="text-xs text-slate-500">No labels assigned.</span>}
          {(assigned.data || []).map(label => <span key={label.id} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-white" style={{ backgroundColor: label.color }} title={label.visibility === 'custom' ? `Created by ${label.created_by_name || 'user'}` : 'Admin label'}>{label.name}{canManage && <button type="button" onClick={() => remove.mutate({ leadId, labelId: label.id }, { onError: () => toast.error('Could not remove label') })} className="rounded-full p-0.5 hover:bg-black/15" aria-label={`Remove ${label.name}`}><X className="h-3 w-3" /></button>}</span>)}
        </div>
      )}
      {canManage && <div className="mt-3 flex gap-2"><select value={selectedLabelId} onChange={event => setSelectedLabelId(event.target.value)} className="input min-w-0 flex-1 text-xs"><option value="">Assign a label</option>{available.map(label => <option key={label.id} value={label.id}>{label.name}{label.visibility === 'custom' ? ' (custom)' : ''}</option>)}</select><button type="button" onClick={assignSelected} disabled={!selectedLabelId || assign.isPending} className="btn-outline rounded-lg px-3 py-2 text-xs">Assign</button><button type="button" onClick={() => setCreateOpen(true)} className="btn-outline inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs"><Plus className="h-3.5 w-3.5" /> Add Label</button></div>}
      <CreateLabelModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={labelId => {
        assign.mutate({ leadId, labelId }, {
          onSuccess: () => { setSelectedLabelId(''); toast.success('Custom label created and assigned'); },
          onError: () => toast.error('Label was created, but could not be assigned'),
        });
      }} />
    </section>
  );
}

export function CreateLabelModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (labelId: string) => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const create = useCreateLeadLabel();
  function submit() {
    create.mutate({ name: name.trim(), color }, {
      onSuccess: label => { toast.success('Custom label created'); setName(''); onCreated?.(label.id); onClose(); },
      onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Could not create label'),
    });
  }
  return <Modal open={open} onClose={onClose} title="Create Label" description="Custom labels are visible only to you, your reporting RM, and admins." size="sm" footer={<><button type="button" onClick={onClose} className="btn-outline rounded-lg px-4 py-2 text-sm">Cancel</button><button type="button" onClick={submit} disabled={!name.trim() || create.isPending} className="btn-primary rounded-lg px-4 py-2 text-sm">Create Label</button></>}><div className="space-y-4"><label className="block"><span className="label">Label Name</span><input value={name} maxLength={60} onChange={event => setName(event.target.value)} className="input w-full" placeholder="e.g. High Intent" /></label><div><span className="label">Color</span><div className="mt-2 flex flex-wrap gap-2">{COLORS.map(value => <button key={value} type="button" onClick={() => setColor(value)} className="h-7 w-7 rounded-full ring-offset-2" style={{ backgroundColor: value, outline: color === value ? '2px solid #0F172A' : undefined }} aria-label={`Select ${value}`} />)}</div></div></div></Modal>;
}
