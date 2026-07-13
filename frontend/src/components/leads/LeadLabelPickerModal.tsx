'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import {
  LeadLabel,
  useAssignLeadLabel,
  useBulkApplyLeadLabels,
  useCreateLeadLabel,
  useLabels,
  useRemoveLeadLabel,
} from '@/hooks/useLeadLabels';

const COLORS = ['#2563EB', '#16A34A', '#EA580C', '#9333EA', '#DC2626', '#0891B2', '#475569'];

interface Props {
  open: boolean;
  onClose: () => void;
  mode: 'single' | 'bulk';
  leadId?: string;
  leadIds?: string[];
  selectedLabels?: LeadLabel[];
  title?: string;
  description?: string;
  onSuccess?: () => void;
}

export function LeadLabelPickerModal({
  open,
  onClose,
  mode,
  leadId,
  leadIds = [],
  selectedLabels = [],
  title,
  description,
  onSuccess,
}: Props) {
  const labels = useLabels();
  const assign = useAssignLeadLabel();
  const remove = useRemoveLeadLabel();
  const bulk = useBulkApplyLeadLabels();
  const create = useCreateLeadLabel();
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const assignedIds = new Set(selectedLabels.map(label => label.id));
  const activeIds = mode === 'single' ? [...assignedIds] : selectedIds;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (labels.data || []).filter(label => !q || label.name.toLowerCase().includes(q));
  }, [labels.data, search]);

  function finish(message: string) {
    toast.success(message);
    onSuccess?.();
  }

  function toggle(label: LeadLabel) {
    if (mode === 'single') {
      if (!leadId) return;
      if (assignedIds.has(label.id)) {
        remove.mutate({ leadId, labelId: label.id }, {
          onSuccess: () => finish('Label removed'),
          onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Could not remove label'),
        });
        return;
      }
      assign.mutate({ leadId, labelId: label.id }, {
        onSuccess: () => finish('Label assigned'),
        onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Could not assign label'),
      });
      return;
    }
    setSelectedIds(ids => ids.includes(label.id) ? ids.filter(id => id !== label.id) : [...ids, label.id]);
  }

  function applyBulk(nextIds = selectedIds) {
    if (nextIds.length === 0) {
      toast.error('Select at least one label.');
      return;
    }
    bulk.mutate({ leadIds, labelIds: nextIds, mode: 'add' }, {
      onSuccess: summary => {
        toast.success(`Labels applied to ${summary.applied_count} lead${summary.applied_count === 1 ? '' : 's'}`);
        if (summary.skipped_count) toast.error(`${summary.skipped_count} lead${summary.skipped_count === 1 ? '' : 's'} skipped`);
        setSelectedIds([]);
        onSuccess?.();
        onClose();
      },
      onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Could not apply labels'),
    });
  }

  function createAndApply() {
    create.mutate({ name: name.trim(), color }, {
      onSuccess: label => {
        setName('');
        if (mode === 'single' && leadId) {
          assign.mutate({ leadId, labelId: label.id }, {
            onSuccess: () => finish('Label created and assigned'),
            onError: () => toast.error('Label was created, but could not be assigned'),
          });
        } else {
          const nextIds = [...new Set([...selectedIds, label.id])];
          setSelectedIds(nextIds);
          if (leadIds.length) applyBulk(nextIds);
        }
      },
      onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Could not create label'),
    });
  }

  const pending = assign.isPending || remove.isPending || bulk.isPending || create.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title || (mode === 'bulk' ? 'Add Labels to Selected Leads' : 'Add Label')}
      description={description || (mode === 'bulk' ? `${leadIds.length} selected lead${leadIds.length === 1 ? '' : 's'}` : 'Select existing labels or create a new one.')}
      size="md"
      footer={mode === 'bulk' ? (
        <>
          <button type="button" onClick={onClose} className="btn-outline rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button type="button" onClick={() => applyBulk()} disabled={pending || selectedIds.length === 0} className="btn-primary rounded-lg px-4 py-2 text-sm">
            {bulk.isPending ? 'Applying...' : 'Apply Labels'}
          </button>
        </>
      ) : undefined}
    >
      <div className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={event => setSearch(event.target.value)} className="input w-full pl-9" placeholder="Search labels..." />
        </div>
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {filtered.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">No labels found.</p>}
          {filtered.map(label => {
            const selected = activeIds.includes(label.id);
            return (
              <button
                key={label.id}
                type="button"
                disabled={pending}
                onClick={() => toggle(label)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-60"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: label.color }} />
                  <span className="truncate text-sm font-medium text-slate-800">{label.name}</span>
                </span>
                <span className={selected ? 'chip-green' : 'chip-slate'}>{selected ? 'Selected' : 'Add'}</span>
              </button>
            );
          })}
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-sm font-semibold text-slate-900">Create Label</div>
          <input value={name} maxLength={60} onChange={event => setName(event.target.value)} className="input w-full" placeholder="Label name" />
          <div className="mt-3 flex flex-wrap gap-2">
            {COLORS.map(value => (
              <button key={value} type="button" onClick={() => setColor(value)} className="h-7 w-7 rounded-full ring-offset-2" style={{ backgroundColor: value, outline: color === value ? '2px solid #0F172A' : undefined }} aria-label={`Select ${value}`} />
            ))}
          </div>
          <button type="button" onClick={createAndApply} disabled={!name.trim() || pending} className="btn-primary mt-3 rounded-lg px-4 py-2 text-sm">
            {mode === 'bulk' ? 'Create and Add' : 'Create and Apply'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
