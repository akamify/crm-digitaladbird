'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { CreateLabelModal } from '@/components/leads/LeadLabelsCard';
import { EmptyState, Modal, Skeleton } from '@/components/ui/Modal';
import { useDeleteLeadLabel, useLabels, type LeadLabel } from '@/hooks/useLeadLabels';

export default function LabelsPage() {
  return (
    <AppShell
      title="Labels"
      subtitle="Create labels and open the leads assigned to each label"
      roles={['super_admin']}
    >
      <LabelsInner />
    </AppShell>
  );
}

function LabelsInner() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<LeadLabel | null>(null);
  const [deleteLabel, setDeleteLabel] = useState<LeadLabel | null>(null);
  const labels = useLabels();
  const deleteMutation = useDeleteLeadLabel();

  function confirmDelete() {
    if (!deleteLabel) return;
    deleteMutation.mutate(
      { labelId: deleteLabel.id },
      {
        onSuccess: () => {
          toast.success('Label deleted');
          setDeleteLabel(null);
        },
        onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Could not delete label'),
      },
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
        >
          <Plus className="h-4 w-4" /> Create Label
        </button>
      </div>

      {labels.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-36" />)}
        </div>
      ) : labels.isError ? (
        <EmptyState title="Could not load labels" description="Refresh the page to retry." />
      ) : labels.data?.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {labels.data.map(label => (
            <div key={label.id} className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/leads?label_id=${encodeURIComponent(label.id)}`} className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: label.color }} />
                    <span className="min-w-0 truncate font-semibold text-slate-900">{label.name}</span>
                  </div>
                </Link>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setEditingLabel(label)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                    aria-label={`Edit ${label.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteLabel(label)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 text-rose-600 transition hover:bg-rose-50"
                    aria-label={`Delete ${label.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>{label.visibility === 'global' ? 'Global label' : `Custom by ${label.created_by_name || 'user'}`}</span>
                <span>{label.lead_count || 0} leads</span>
              </div>

              <div className="mt-4">
                <Link
                  href={`/leads?label_id=${encodeURIComponent(label.id)}`}
                  className="inline-flex items-center text-sm font-medium text-brand-700 transition hover:text-brand-800"
                >
                  Open matching leads
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No labels created"
          description="Create a label to organize leads."
          icon={<Tag className="h-6 w-6" />}
        />
      )}

      <CreateLabelModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <CreateLabelModal
        open={!!editingLabel}
        onClose={() => setEditingLabel(null)}
        mode="edit"
        initialLabel={editingLabel}
      />

      <Modal
        open={!!deleteLabel}
        onClose={() => {
          if (deleteMutation.isPending) return;
          setDeleteLabel(null);
        }}
        title="Delete Label"
        description="This will remove the label and clear it from any assigned leads."
        size="sm"
        footer={(
          <>
            <button
              type="button"
              onClick={() => setDeleteLabel(null)}
              disabled={deleteMutation.isPending}
              className="btn-outline rounded-lg px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-50"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Label'}
            </button>
          </>
        )}
      >
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <div className="font-semibold">{deleteLabel?.name}</div>
          <div className="mt-2">Assigned lead count: {deleteLabel?.lead_count || 0}</div>
        </div>
      </Modal>
    </div>
  );
}
