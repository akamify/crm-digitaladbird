'use client';

import { FormEvent, useMemo, useState } from 'react';
import { CalendarClock, Edit2, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { EmptyState, Modal, Skeleton } from '@/components/ui/Modal';
import {
  LeadSessionInput,
  useCreateLeadSession,
  useDeleteLeadSession,
  useLeadSessions,
  useUpdateLeadSession,
} from '@/hooks/useLeads';
import type { LeadSession } from '@/types';

function toDateInput(value?: string | null) {
  return value ? String(value).slice(0, 10) : '';
}

function toTimeInput(value?: string | null) {
  return value ? String(value).slice(0, 5) : '';
}

function formatSessionDate(value?: string | null) {
  if (!value) return 'Date not available';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00+05:30`);
  if (Number.isNaN(date.getTime())) return 'Date not available';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

function formatSessionTime(value?: string | null) {
  const [hour, minute] = String(value || '').split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 'Time not available';
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

function errorMessage(error: unknown) {
  const err = error as { response?: { data?: { error?: { message?: string }; message?: string } }; message?: string };
  return err?.response?.data?.error?.message || err?.response?.data?.message || err?.message || 'Session action failed.';
}

function emptyForm(): LeadSessionInput {
  return { session_name: '', session_date: '', session_time: '', timezone: 'Asia/Kolkata', notes: '' };
}

function sessionToForm(session: LeadSession): LeadSessionInput {
  return {
    session_name: session.sessionName || '',
    session_date: toDateInput(session.sessionDate),
    session_time: toTimeInput(session.sessionTime),
    timezone: session.timezone || 'Asia/Kolkata',
    notes: session.notes || '',
  };
}

export function LeadSessionsCard({ leadId, canManage }: { leadId: string; canManage: boolean }) {
  const sessionsQuery = useLeadSessions(leadId);
  const createSession = useCreateLeadSession();
  const updateSession = useUpdateLeadSession();
  const deleteSession = useDeleteLeadSession();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LeadSession | null>(null);
  const [form, setForm] = useState<LeadSessionInput>(emptyForm());

  const isSaving = createSession.isPending || updateSession.isPending;
  const sessions = useMemo(() => sessionsQuery.data || [], [sessionsQuery.data]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setOpen(true);
  }

  function openEdit(session: LeadSession) {
    setEditing(session);
    setForm(sessionToForm(session));
    setOpen(true);
  }

  function closeModal() {
    if (isSaving) return;
    setOpen(false);
    setEditing(null);
    setForm(emptyForm());
  }

  async function save() {
    const body = {
      ...form,
      session_name: form.session_name.trim(),
      notes: form.notes?.trim() || null,
      timezone: form.timezone || 'Asia/Kolkata',
    };
    try {
      if (editing) {
        await updateSession.mutateAsync({ leadId, sessionId: editing.id, body });
        toast.success('Session updated.');
      } else {
        await createSession.mutateAsync({ leadId, body });
        toast.success('Session added.');
      }
      closeModal();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void save();
  }

  async function remove(session: LeadSession) {
    if (!window.confirm(`Delete session "${session.sessionName}"?`)) return;
    try {
      await deleteSession.mutateAsync({ leadId, sessionId: session.id });
      toast.success('Session deleted.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <section className="card-padded">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-slate-950">Sessions / Webinar Attendance</h2>
        </div>
        {canManage && (
          <Button size="sm" variant="outline" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={openCreate}>
            Add Session
          </Button>
        )}
      </div>

      {sessionsQuery.isLoading ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : sessionsQuery.isError ? (
        <EmptyState title="Could not load sessions" description="Refresh this section and try again." action={<Button variant="outline" onClick={() => sessionsQuery.refetch()}>Retry</Button>} />
      ) : !sessions.length ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No sessions added yet.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {sessions.map(session => (
            <div key={session.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-semibold text-slate-900">{session.sessionName}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatSessionDate(session.sessionDate)} at {formatSessionTime(session.sessionTime)} {session.timezone || 'Asia/Kolkata'}
                  </p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => openEdit(session)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Edit session">
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => remove(session)} disabled={deleteSession.isPending} className="rounded-md p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50" aria-label="Delete session">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
              {session.notes && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{session.notes}</p>}
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                <span>Added by {session.createdBy || 'Unknown'}</span>
                <span>Updated {formatDateTime(session.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={closeModal}
        title={editing ? 'Edit Session' : 'Add Session'}
        description="Save the webinar or session this lead attended."
        footer={(
          <>
            <Button variant="outline" onClick={closeModal} disabled={isSaving}>Cancel</Button>
            <Button onClick={() => void save()} loading={isSaving}>{editing ? 'Save Changes' : 'Save Session'}</Button>
          </>
        )}
      >
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-700">Webinar/Session Name</span>
            <input
              className="input mt-1"
              value={form.session_name}
              onChange={event => setForm(current => ({ ...current, session_name: event.target.value }))}
              maxLength={150}
              required
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Date</span>
              <input
                className="input mt-1"
                type="date"
                value={form.session_date}
                onChange={event => setForm(current => ({ ...current, session_date: event.target.value }))}
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Time</span>
              <input
                className="input mt-1"
                type="time"
                value={form.session_time}
                onChange={event => setForm(current => ({ ...current, session_time: event.target.value }))}
                required
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-slate-700">Notes</span>
            <textarea
              className="input mt-1 min-h-28 resize-y"
              value={form.notes || ''}
              onChange={event => setForm(current => ({ ...current, notes: event.target.value }))}
              maxLength={1000}
              placeholder="Optional session notes"
            />
          </label>
        </form>
      </Modal>
    </section>
  );
}
