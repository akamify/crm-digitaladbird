'use client';

import { FormEvent, useState } from 'react';
import { Bookmark, Check, Copy, Pencil, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import {
  useCreateLeadSavedView,
  useDeleteLeadSavedView,
  useLeadSavedViews,
  useUpdateLeadSavedView,
} from '@/hooks/useLeadSavedViews';
import { leadViewSharePath, pickSavedLeadFilters } from '@/lib/leadSavedViews';
import { clsx } from '@/lib/format';
import type { LeadFilters, LeadSavedView, Role } from '@/types';

interface Props {
  value: LeadFilters;
  role?: Role;
  onApply: (filters: LeadFilters) => void;
}

function errorMessage(error: unknown, fallback: string) {
  const response = (error as { response?: { data?: { error?: { message?: string }; message?: string } } })?.response;
  return response?.data?.error?.message || response?.data?.message || fallback;
}

export function LeadSavedViews({ value, role, onApply }: Props) {
  const isSuperAdmin = role === 'super_admin';
  const { data: savedViews = [], isLoading, isError } = useLeadSavedViews();
  const createView = useCreateLeadSavedView();
  const updateView = useUpdateLeadSavedView();
  const deleteView = useDeleteLeadSavedView();
  const [selectedId, setSelectedId] = useState('');
  const [editorMode, setEditorMode] = useState<'create' | 'rename' | null>(null);
  const [name, setName] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const selectedView = savedViews.find(view => view.id === selectedId) || null;
  const savableFilters = pickSavedLeadFilters(value, isSuperAdmin);
  const pendingViewName = role === 'rm'
    ? 'Team Pending'
    : role === 'super_admin' || role === 'admin' || role === 'client'
      ? 'Pending Work'
      : 'My Pending';
  const quickViews: Array<{ name: string; filters: LeadFilters }> = [
    {
      name: pendingViewName,
      filters: isSuperAdmin
        ? { lead_view: 'all_time', all_time_metric: 'pending' }
        : { pending: 'true' },
    },
    {
      name: 'Call Issues',
      filters: isSuperAdmin
        ? { lead_view: 'all_time', all_time_metric: 'call_issues' }
        : { call_issues: 'true' },
    },
    { name: 'Today Follow-ups', filters: { followup: 'today', followup_strict: 'true' } },
  ];

  function applyView(view: LeadSavedView) {
    setSelectedId(view.id);
    onApply(view.filters);
    toast.success(`${view.name} applied`);
  }

  async function submitName(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Enter a view name');
      return;
    }
    try {
      if (editorMode === 'rename' && selectedView) {
        await updateView.mutateAsync({ id: selectedView.id, name: trimmedName });
        toast.success('View renamed');
      } else {
        const created = await createView.mutateAsync({ name: trimmedName, filters: savableFilters });
        setSelectedId(created.id);
        toast.success('View saved');
      }
      setEditorMode(null);
      setName('');
    } catch (error) {
      toast.error(errorMessage(error, 'Could not save view'));
    }
  }

  async function updateSelectedView() {
    if (!selectedView) return;
    try {
      await updateView.mutateAsync({ id: selectedView.id, filters: savableFilters });
      toast.success(`${selectedView.name} updated`);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not update view'));
    }
  }

  async function confirmDelete() {
    if (!selectedView) return;
    try {
      await deleteView.mutateAsync(selectedView.id);
      toast.success('Saved view deleted');
      setDeleteOpen(false);
      setSelectedId('');
    } catch (error) {
      toast.error(errorMessage(error, 'Could not delete view'));
    }
  }

  async function copyShareLink() {
    try {
      const path = leadViewSharePath(value, isSuperAdmin);
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      toast.success('Share link copied');
    } catch {
      toast.error('Browser could not copy the link');
    }
  }

  const saving = createView.isPending || updateView.isPending;

  return (
    <>
      <section className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="mr-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Bookmark className="h-4 w-4 text-brand-600" /> Saved Views
            </div>
            {quickViews.map(view => (
              <button
                key={view.name}
                type="button"
                onClick={() => {
                  setSelectedId('');
                  onApply(view.filters);
                }}
                className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
              >
                {view.name}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Select a saved lead view"
              value={selectedId}
              disabled={isLoading || isError || savedViews.length === 0}
              onChange={event => {
                const view = savedViews.find(item => item.id === event.target.value);
                if (view) applyView(view);
                else setSelectedId('');
              }}
              className="h-9 min-w-[180px] rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">{isLoading ? 'Loading views...' : isError ? 'Saved views unavailable' : savedViews.length ? 'Choose saved view' : 'No custom views yet'}</option>
              {savedViews.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}
            </select>

            {selectedView && (
              <>
                <button type="button" title="Update selected view with current filters" onClick={updateSelectedView} disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  <Check className="h-3.5 w-3.5" /> Update
                </button>
                <button type="button" title="Rename saved view" onClick={() => { setName(selectedView.name); setEditorMode('rename'); }} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Rename saved view">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button type="button" title="Delete saved view" onClick={() => setDeleteOpen(true)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50" aria-label="Delete saved view">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}

            <button type="button" onClick={() => { setName(''); setEditorMode('create'); }} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700">
              <Save className="h-3.5 w-3.5" /> Save current
            </button>
            <button type="button" onClick={copyShareLink} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-3 text-xs font-semibold text-brand-700 transition hover:bg-brand-50">
              <Copy className="h-3.5 w-3.5" /> Copy link
            </button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">Saved views are private to your account. Shared links apply the same filters within the recipient&apos;s own CRM permissions.</p>
      </section>

      <Modal
        open={editorMode !== null}
        onClose={() => !saving && setEditorMode(null)}
        title={editorMode === 'rename' ? 'Rename saved view' : 'Save current view'}
        description="Lead filters and analytics period are saved; search text, sorting, and page number are not."
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setEditorMode(null)} disabled={saving} className="btn-outline px-4 py-2 text-sm">Cancel</button>
            <button type="submit" form="saved-view-form" disabled={saving || !name.trim()} className={clsx('btn-primary px-4 py-2 text-sm', (saving || !name.trim()) && 'opacity-50')}>
              {saving ? 'Saving...' : editorMode === 'rename' ? 'Rename' : 'Save view'}
            </button>
          </>
        )}
      >
        <form id="saved-view-form" onSubmit={submitName}>
          <label htmlFor="saved-view-name" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">View name</label>
          <input id="saved-view-name" autoFocus maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. High priority follow-ups" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
        </form>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => !deleteView.isPending && setDeleteOpen(false)}
        title="Delete saved view?"
        description={selectedView ? `This removes "${selectedView.name}" from your account only.` : undefined}
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setDeleteOpen(false)} disabled={deleteView.isPending} className="btn-outline px-4 py-2 text-sm">Cancel</button>
            <button type="button" onClick={confirmDelete} disabled={deleteView.isPending} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">{deleteView.isPending ? 'Deleting...' : 'Delete view'}</button>
          </>
        )}
      >
        <p className="text-sm text-slate-600">The leads and CRM data will not be changed.</p>
      </Modal>
    </>
  );
}
