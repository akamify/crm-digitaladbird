'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarClock, CheckCircle2, ChevronRight, Link2, Pencil, Plus, Search, ShieldCheck, Trash2, UserRound, Users, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, Modal, Skeleton } from '@/components/ui/Modal';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import {
  useAddCustomerNoteEntry,
  useApproveCustomerNote,
  useCreateCustomerNote,
  useCustomerNote,
  useCustomerNoteLeadLookup,
  useCustomerNoteUserLookup,
  useCustomerNotes,
  useDeleteCustomerNote,
  useDeleteCustomerNoteEntry,
  useRejectCustomerNote,
  useUpdateCustomerNote,
  useUpdateCustomerNoteEntry,
  type CustomerNoteInput,
  type LeadLookupItem,
} from '@/hooks/useCustomerNotes';
import { useLead } from '@/hooks/useLeads';
import { type AuthUser, useAuth } from '@/lib/auth';
import { formatISTCompact, formatISTTooltip } from '@/lib/date';
import { clsx, fmtPhone, humanize } from '@/lib/format';
import type { CustomerNote, CustomerNoteApprovalStatus, CustomerNoteFilters } from '@/types';

const STATUS_OPTIONS: Array<{ value: CustomerNoteApprovalStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'pending_rm_approval', label: 'Pending RM Approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

function approvalChip(status?: CustomerNoteApprovalStatus | string | null) {
  if (status === 'approved') return 'chip-green';
  if (status === 'rejected') return 'chip-red';
  return 'chip-amber';
}

function noteSummary(note: CustomerNote) {
  return note.latest_entry_text || note.about_client || note.client_services_want || 'No note text yet';
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { error?: { message?: string }; message?: string } } }).response;
    return response?.data?.error?.message || response?.data?.message || fallback;
  }
  return fallback;
}

type NoteAuthUser = Pick<AuthUser, 'id' | 'role'> | null | undefined;

function emptyForm(prefillLead?: LeadLookupItem | null, currentUser?: NoteAuthUser): CustomerNoteInput {
  return {
    lead_id: prefillLead?.id || null,
    customer_phone: prefillLead?.phone || '',
    customer_name: prefillLead?.full_name || '',
    customer_second_name: '',
    business_name: '',
    about_client: '',
    client_services_want: '',
    client_budget: '',
    meeting_name: '',
    meeting_at: '',
    counselor_user_id: currentUser && ['member', 'partner'].includes(currentUser.role) ? currentUser.id : null,
    rm_user_id: currentUser?.role === 'rm' ? currentUser.id : null,
    initial_entry_text: '',
  };
}

function buildFormFromNote(note: CustomerNote): CustomerNoteInput {
  return {
    lead_id: note.lead_id || null,
    customer_phone: note.customer_phone || '',
    customer_name: note.customer_name || '',
    customer_second_name: note.customer_second_name || '',
    business_name: note.business_name || '',
    about_client: note.about_client || '',
    client_services_want: note.client_services_want || '',
    client_budget: note.client_budget || '',
    meeting_name: note.meeting_name || '',
    meeting_at: note.meeting_at ? note.meeting_at.slice(0, 16) : '',
    counselor_user_id: note.counselor_user_id || null,
    rm_user_id: note.rm_user_id || null,
    initial_entry_text: '',
  };
}

export default function NotesPage() {
  return (
    <AppShell title="Latest Notes" subtitle="Shared counselor, RM, and approved admin-facing customer notes">
      <NotesInner />
    </AppShell>
  );
}

function NotesInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const initialFilters = useMemo<CustomerNoteFilters>(() => ({
    q: searchParams.get('q') || '',
    approval_status: (searchParams.get('approval_status') as CustomerNoteApprovalStatus | '') || '',
    lead_id: searchParams.get('lead_id') || '',
    from: searchParams.get('from') || '',
    to: searchParams.get('to') || '',
    page: Number(searchParams.get('page') || '1'),
    page_size: Number(searchParams.get('page_size') || '20'),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  const [filters, setFilters] = useState<CustomerNoteFilters>(initialFilters);
  const [composeOpen, setComposeOpen] = useState(false);
  const [detailNoteId, setDetailNoteId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<CustomerNote | null>(null);

  const leadIdFromQuery = searchParams.get('leadId');
  const composeFromQuery = searchParams.get('compose') === '1';
  const leadQuery = useLead(leadIdFromQuery);
  const debouncedSearch = useDebouncedValue(filters.q || '');
  const notesQuery = useCustomerNotes({
    ...filters,
    q: debouncedSearch || '',
  });

  useEffect(() => {
    if (composeFromQuery) setComposeOpen(true);
  }, [composeFromQuery]);

  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
    if (leadIdFromQuery) params.set('leadId', leadIdFromQuery);
    if (composeOpen) params.set('compose', '1');
    router.replace(`/notes${params.toString() ? `?${params.toString()}` : ''}`);
  }, [composeOpen, filters, leadIdFromQuery, router]);

  const prefillLead: LeadLookupItem | null = leadQuery.data ? {
    id: leadQuery.data.id,
    full_name: leadQuery.data.full_name,
    phone: leadQuery.data.phone,
    email: leadQuery.data.email,
    source: leadQuery.data.source,
    category: leadQuery.data.category,
    assigned_to_name: leadQuery.data.assigned_to_name,
  } : null;

  const rows = notesQuery.data?.rows || [];
  const total = notesQuery.data?.total || 0;
  const page = filters.page || 1;
  const pageSize = filters.page_size || 20;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const today = getTodayDateString();

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-slate-950">Notes Workspace</span>
            {user?.role === 'super_admin' || user?.role === 'admin' ? (
              <span className="chip-green">Approved notes visible to company</span>
            ) : user?.role === 'rm' ? (
              <span className="chip-blue">You can verify team notes</span>
            ) : (
              <span className="chip-amber">Your updates go to RM for approval</span>
            )}
          </div>
          <p className="text-sm text-slate-500">
            Latest activity stays on top, and each note can hold multiple call updates inside one thread.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setEditingNote(null);
              setComposeOpen(true);
            }}
            className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
          >
            <Plus className="h-4 w-4" /> New Note
          </button>
          <Link
            href="/leads"
            className="btn-outline inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
          >
            Open Leads <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_200px_180px_180px_auto]">
        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Search</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-10"
              placeholder="Customer name, phone, business..."
              value={filters.q || ''}
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value, page: 1 }))}
            />
          </div>
        </label>
        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approval</span>
          <select
            className="input"
            value={filters.approval_status || ''}
            onChange={(event) => setFilters((current) => ({ ...current, approval_status: event.target.value as CustomerNoteApprovalStatus | '', page: 1 }))}
          >
            {STATUS_OPTIONS.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">From</span>
          <input
            type="date"
            className="input"
            value={filters.from || ''}
            onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value, page: 1 }))}
          />
        </label>
        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">To</span>
          <input
            type="date"
            className="input"
            value={filters.to || ''}
            onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value, page: 1 }))}
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => setFilters({ q: '', approval_status: '', lead_id: '', from: '', to: '', page: 1, page_size: pageSize })}
            className="btn-ghost w-full rounded-lg px-4 py-2 text-sm"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilters((current) => ({ ...current, approval_status: '', from: '', to: '', page: 1 }))}
          className={clsx(
            'rounded-lg px-3 py-2 text-sm font-medium transition',
            !filters.approval_status && !filters.from && !filters.to
              ? 'bg-brand-600 text-white'
              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
          )}
        >
          All Notes
        </button>
        {user?.role === 'rm' && (
          <button
            type="button"
            onClick={() => setFilters((current) => ({ ...current, approval_status: 'pending_rm_approval', page: 1 }))}
            className={clsx(
              'rounded-lg px-3 py-2 text-sm font-medium transition',
              filters.approval_status === 'pending_rm_approval'
                ? 'bg-amber-500 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
            )}
          >
            My Pending Approval
          </button>
        )}
        <button
          type="button"
          onClick={() => setFilters((current) => ({ ...current, approval_status: 'approved', page: 1 }))}
          className={clsx(
            'rounded-lg px-3 py-2 text-sm font-medium transition',
            filters.approval_status === 'approved'
              ? 'bg-emerald-600 text-white'
              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
          )}
        >
          Approved
        </button>
        <button
          type="button"
          onClick={() => setFilters((current) => ({ ...current, approval_status: 'rejected', page: 1 }))}
          className={clsx(
            'rounded-lg px-3 py-2 text-sm font-medium transition',
            filters.approval_status === 'rejected'
              ? 'bg-rose-600 text-white'
              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
          )}
        >
          Rejected
        </button>
        <button
          type="button"
          onClick={() => setFilters((current) => ({ ...current, from: today, to: today, page: 1 }))}
          className={clsx(
            'rounded-lg px-3 py-2 text-sm font-medium transition',
            filters.from === today && filters.to === today
              ? 'bg-slate-900 text-white'
              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
          )}
        >
          Today
        </button>
      </div>

      {leadIdFromQuery && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          Lead-linked note mode is active for <span className="font-semibold">{prefillLead?.full_name || 'selected lead'}</span>.
          {' '}
          You can still unlink and convert it into a custom customer note from the composer.
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{total.toLocaleString()}</span> notes
          </div>
          <div className="text-xs text-slate-500">Newest activity first</div>
        </div>
        {notesQuery.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-20" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No notes found"
              description="Create a note from here or open the notes icon from any lead."
              action={<button type="button" onClick={() => setComposeOpen(true)} className="btn-primary rounded-lg px-4 py-2 text-sm">Create Note</button>}
              icon={<CalendarClock className="h-6 w-6" />}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Lead / Team</th>
                  <th className="px-4 py-3 font-medium">Meeting</th>
                  <th className="px-4 py-3 font-medium">Latest Note</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((note, index) => (
                  <tr
                    key={note.id}
                    className="cursor-pointer border-b border-slate-100 transition hover:bg-slate-50/70"
                    onClick={() => setDetailNoteId(note.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-slate-900">{note.customer_name}</span>
                        {index === 0 && page === 1 && <span className="chip-blue">Latest</span>}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{fmtPhone(note.customer_phone)}</div>
                      {note.business_name && <div className="mt-1 text-xs text-slate-500">{note.business_name}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {note.lead_id ? (
                        <div className="space-y-1">
                          <Link href={`/leads/${note.lead_id}`} onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
                            <Link2 className="h-3.5 w-3.5" /> {note.lead_name || 'Open lead'}
                          </Link>
                          <div className="flex flex-wrap gap-1 text-[11px] text-slate-500">
                            {note.counselor_name && <span className="chip-slate">Counselor: {note.counselor_name}</span>}
                            {note.rm_name && <span className="chip-slate">RM: {note.rm_name}</span>}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <span className="chip-amber">Custom customer note</span>
                          <div className="flex flex-wrap gap-1 text-[11px] text-slate-500">
                            {note.counselor_name && <span className="chip-slate">Counselor: {note.counselor_name}</span>}
                            {note.rm_name && <span className="chip-slate">RM: {note.rm_name}</span>}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {note.meeting_name || note.meeting_at ? (
                        <div className="space-y-1">
                          <div className="font-medium text-slate-900">{note.meeting_name || 'Meeting planned'}</div>
                          {note.meeting_at && <div className="text-xs" title={formatISTTooltip(note.meeting_at)}>{formatISTCompact(note.meeting_at)}</div>}
                        </div>
                      ) : (
                        <span className="text-slate-400">No meeting info</span>
                      )}
                    </td>
                    <td className="max-w-[340px] px-4 py-3">
                      <div className="line-clamp-3 text-slate-700">{noteSummary(note)}</div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {note.client_services_want && <span className="chip-slate">{note.client_services_want}</span>}
                        {note.client_budget && <span className="chip-slate">Budget: {note.client_budget}</span>}
                        <span className="chip-slate">{note.entries_count || 0} updates</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <span className={approvalChip(note.approval_status)}>{humanize(note.approval_status)}</span>
                        {note.rejection_note && <div className="line-clamp-2 text-xs text-rose-600">{note.rejection_note}</div>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500" title={formatISTTooltip(note.last_activity_at || note.updated_at)}>
                      {formatISTCompact(note.last_activity_at || note.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setDetailNoteId(note.id);
                          }}
                          className="btn-outline rounded-lg px-3 py-1.5 text-xs"
                        >
                          Open
                        </button>
                        {note.permissions?.can_edit && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditingNote(note);
                              setComposeOpen(true);
                            }}
                            className="btn-ghost rounded-lg px-3 py-1.5 text-xs"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setFilters((current) => ({ ...current, page: page - 1 }))}
              className="btn-outline rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Prev
            </button>
            <div className="text-xs text-slate-500">
              Page {page} / {pages}
            </div>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setFilters((current) => ({ ...current, page: page + 1 }))}
              className="btn-outline rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>

      <CustomerNoteComposerModal
        open={composeOpen}
        onClose={() => {
          setComposeOpen(false);
          setEditingNote(null);
        }}
        prefillLead={prefillLead}
        note={editingNote}
      />

      <CustomerNoteDetailModal
        noteId={detailNoteId}
        onClose={() => setDetailNoteId(null)}
        onEdit={(note) => {
          setDetailNoteId(null);
          setEditingNote(note);
          setComposeOpen(true);
        }}
      />
    </div>
  );
}

function CustomerNoteComposerModal({
  open,
  onClose,
  prefillLead,
  note,
}: {
  open: boolean;
  onClose: () => void;
  prefillLead?: LeadLookupItem | null;
  note?: CustomerNote | null;
}) {
  const { user } = useAuth();
  const createNote = useCreateCustomerNote();
  const updateNote = useUpdateCustomerNote();
  const allUsers = useCustomerNoteUserLookup('', '');
  const [linkedLead, setLinkedLead] = useState<LeadLookupItem | null>(prefillLead || null);
  const [form, setForm] = useState<CustomerNoteInput>(emptyForm(prefillLead, user));
  const [lookupText, setLookupText] = useState('');
  const debouncedLookup = useDebouncedValue(lookupText, 250);
  const leadLookup = useCustomerNoteLeadLookup(debouncedLookup);

  useEffect(() => {
    if (!open) return;
    if (note) {
      setLinkedLead(note.lead_id ? {
        id: note.lead_id,
        full_name: note.lead_name,
        phone: note.lead_phone || note.customer_phone,
        email: null,
        source: null,
        category: null,
        assigned_to_name: null,
      } : null);
      setForm(buildFormFromNote(note));
      setLookupText('');
      return;
    }
    setLinkedLead(prefillLead || null);
    setForm(emptyForm(prefillLead, user));
    setLookupText('');
  }, [note, open, prefillLead, user]);

  const visibleUsers = allUsers.data || [];
  const counselorOptions = visibleUsers.filter((entry) => ['member', 'partner', 'rm'].includes(entry.role));
  const rmOptions = visibleUsers.filter((entry) => entry.role === 'rm');

  function selectLead(lead: LeadLookupItem) {
    setLinkedLead(lead);
    setForm((current) => ({
      ...current,
      lead_id: lead.id,
      customer_phone: lead.phone || current.customer_phone,
      customer_name: lead.full_name || current.customer_name,
    }));
    setLookupText('');
  }

  function handleSubmit() {
    const payload: CustomerNoteInput = {
      lead_id: form.lead_id || null,
      customer_phone: form.customer_phone || '',
      customer_name: form.customer_name || '',
      customer_second_name: form.customer_second_name || '',
      business_name: form.business_name || '',
      about_client: form.about_client || '',
      client_services_want: form.client_services_want || '',
      client_budget: form.client_budget || '',
      meeting_name: form.meeting_name || '',
      meeting_at: form.meeting_at || null,
      counselor_user_id: form.counselor_user_id || null,
      rm_user_id: form.rm_user_id || null,
      initial_entry_text: form.initial_entry_text || '',
    };

    const mutation = note
      ? updateNote.mutateAsync({ id: note.id, ...payload })
      : createNote.mutateAsync(payload);

    toast.promise(
      mutation.then(() => {
        onClose();
      }),
      {
        loading: note ? 'Updating note...' : 'Creating note...',
        success: note ? 'Note updated successfully' : 'Note created successfully',
        error: (error) => getApiErrorMessage(error, 'Could not save note'),
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={note ? 'Edit Customer Note' : linkedLead ? 'Create Lead Note' : 'Create Customer Note'}
      description={note ? 'Update customer metadata, meeting details, or ownership.' : 'Use one note thread for all call updates and RM verification.'}
      size="xl"
    >
      <div className="space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-slate-900">Lead Linking</div>
              <div className="text-xs text-slate-500">Notes can stay connected to a lead or remain a manual customer note.</div>
            </div>
            {linkedLead && (
              <button
                type="button"
                onClick={() => {
                  setLinkedLead(null);
                  setForm((current) => ({ ...current, lead_id: null }));
                }}
                className="btn-ghost rounded-lg px-3 py-1.5 text-xs"
              >
                Unlink Lead
              </button>
            )}
          </div>

          {linkedLead ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="chip-blue">Linked lead</span>
              <span className="font-medium text-slate-900">{linkedLead.full_name || 'Unnamed lead'}</span>
              {linkedLead.phone && <span className="text-sm text-slate-500">{fmtPhone(linkedLead.phone)}</span>}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <input
                className="input"
                placeholder="Search existing leads by phone, name, or email"
                value={lookupText}
                onChange={(event) => setLookupText(event.target.value)}
              />
              {leadLookup.isFetching && <div className="text-xs text-slate-500">Searching leads...</div>}
              {!!leadLookup.data?.length && (
                <div className="grid gap-2">
                  {leadLookup.data.map((lead) => (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => selectLead(lead)}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <div>
                        <div className="font-medium text-slate-900">{lead.full_name || 'Unnamed lead'}</div>
                        <div className="text-xs text-slate-500">{fmtPhone(lead.phone)} {lead.assigned_to_name ? `· ${lead.assigned_to_name}` : ''}</div>
                      </div>
                      <span className="chip-slate">{humanize(lead.source || 'manual')}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Customer number">
            <input className="input" value={form.customer_phone || ''} onChange={(event) => setForm((current) => ({ ...current, customer_phone: event.target.value }))} />
          </Field>
          <Field label="Customer first name">
            <input className="input" value={form.customer_name || ''} onChange={(event) => setForm((current) => ({ ...current, customer_name: event.target.value }))} />
          </Field>
          <Field label="Customer second name (optional)">
            <input className="input" value={form.customer_second_name || ''} onChange={(event) => setForm((current) => ({ ...current, customer_second_name: event.target.value }))} />
          </Field>
          <Field label="Business name">
            <input className="input" value={form.business_name || ''} onChange={(event) => setForm((current) => ({ ...current, business_name: event.target.value }))} />
          </Field>
          <Field label="Meeting name">
            <input className="input" value={form.meeting_name || ''} onChange={(event) => setForm((current) => ({ ...current, meeting_name: event.target.value }))} />
          </Field>
          <Field label="Meeting date & time">
            <input type="datetime-local" className="input" value={form.meeting_at || ''} onChange={(event) => setForm((current) => ({ ...current, meeting_at: event.target.value }))} />
          </Field>
          <Field label="Counselor / Member">
            <select
              className="input"
              value={form.counselor_user_id || ''}
              onChange={(event) => setForm((current) => ({ ...current, counselor_user_id: event.target.value || null }))}
            >
              <option value="">Select counselor</option>
              {counselorOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.full_name} ({humanize(entry.role)})</option>)}
            </select>
          </Field>
          <Field label="RM">
            <select
              className="input"
              value={form.rm_user_id || ''}
              onChange={(event) => setForm((current) => ({ ...current, rm_user_id: event.target.value || null }))}
            >
              <option value="">Select RM</option>
              {rmOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.full_name}</option>)}
            </select>
          </Field>
        </div>

        <Field label="About client">
          <textarea className="input min-h-[96px] resize-y" value={form.about_client || ''} onChange={(event) => setForm((current) => ({ ...current, about_client: event.target.value }))} />
        </Field>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <Field label="Client services wanted">
            <textarea className="input min-h-[92px] resize-y" value={form.client_services_want || ''} onChange={(event) => setForm((current) => ({ ...current, client_services_want: event.target.value }))} />
          </Field>
          <Field label="Client budget">
            <input className="input" value={form.client_budget || ''} onChange={(event) => setForm((current) => ({ ...current, client_budget: event.target.value }))} />
          </Field>
        </div>

        {!note && (
          <Field label="Share notes">
            <textarea
              className="input min-h-[140px] resize-y"
              placeholder="Write what happened on the latest call, meeting ask, objections, timing, next step..."
              value={form.initial_entry_text || ''}
              onChange={(event) => setForm((current) => ({ ...current, initial_entry_text: event.target.value }))}
            />
          </Field>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={createNote.isPending || updateNote.isPending}
          className="btn-primary rounded-lg px-4 py-2 text-sm"
        >
          {createNote.isPending || updateNote.isPending ? 'Saving...' : note ? 'Update Note' : 'Create Note'}
        </button>
      </div>
    </Modal>
  );
}

function CustomerNoteDetailModal({
  noteId,
  onClose,
  onEdit,
}: {
  noteId: string | null;
  onClose: () => void;
  onEdit: (note: CustomerNote) => void;
}) {
  const detail = useCustomerNote(noteId);
  const addEntry = useAddCustomerNoteEntry();
  const updateEntry = useUpdateCustomerNoteEntry();
  const deleteEntry = useDeleteCustomerNoteEntry();
  const approveNote = useApproveCustomerNote();
  const rejectNote = useRejectCustomerNote();
  const deleteNote = useDeleteCustomerNote();
  const [newEntryText, setNewEntryText] = useState('');

  useEffect(() => {
    if (!noteId) setNewEntryText('');
  }, [noteId]);

  const note = detail.data;
  const entries = note?.entries || [];

  function handleAddEntry() {
    if (!noteId || !newEntryText.trim()) {
      toast.error('Write a note update first');
      return;
    }
    addEntry.mutate({ noteId, entry_text: newEntryText.trim() }, {
      onSuccess: () => {
        toast.success('Update added');
        setNewEntryText('');
      },
      onError: (error) => toast.error(getApiErrorMessage(error, 'Could not add update')),
    });
  }

  function handleEditEntry(entryId: string, currentText: string) {
    if (!noteId) return;
    const nextText = window.prompt('Update this note entry', currentText);
    if (!nextText || !nextText.trim()) return;
    updateEntry.mutate({ noteId, entryId, entry_text: nextText.trim() }, {
      onSuccess: () => toast.success('Entry updated'),
      onError: (error) => toast.error(getApiErrorMessage(error, 'Could not update entry')),
    });
  }

  function handleDeleteEntry(entryId: string) {
    if (!noteId) return;
    if (!window.confirm('Delete this note entry?')) return;
    deleteEntry.mutate({ noteId, entryId }, {
      onSuccess: () => toast.success('Entry deleted'),
      onError: (error) => toast.error(getApiErrorMessage(error, 'Could not delete entry')),
    });
  }

  function handleApprove() {
    if (!noteId) return;
    approveNote.mutate(noteId, {
      onSuccess: () => toast.success('Note approved and visible to admin'),
      onError: (error) => toast.error(getApiErrorMessage(error, 'Could not approve note')),
    });
  }

  function handleReject() {
    if (!noteId) return;
    const reason = window.prompt('Reason for rejection (optional)');
    rejectNote.mutate({ noteId, rejection_note: reason || '' }, {
      onSuccess: () => toast.success('Note rejected'),
      onError: (error) => toast.error(getApiErrorMessage(error, 'Could not reject note')),
    });
  }

  function handleDeleteNote() {
    if (!noteId) return;
    if (!window.confirm('Delete this note thread?')) return;
    deleteNote.mutate(noteId, {
      onSuccess: () => {
        toast.success('Note deleted');
        onClose();
      },
      onError: (error) => toast.error(getApiErrorMessage(error, 'Could not delete note')),
    });
  }

  return (
    <Modal
      open={!!noteId}
      onClose={onClose}
      title={note?.customer_name ? `Customer Note: ${note.customer_name}` : 'Customer Note'}
      description="Track every follow-up in one running note thread."
      size="xl"
    >
      {detail.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-56" />
        </div>
      ) : !note ? (
        <EmptyState title="Note not found" description="This note may have been removed or you no longer have access." />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <InfoCard icon={<UserRound className="h-4 w-4" />} label="Customer" value={note.customer_name} hint={fmtPhone(note.customer_phone)} />
            <InfoCard icon={<Users className="h-4 w-4" />} label="Ownership" value={note.rm_name || 'RM not set'} hint={note.counselor_name ? `Counselor: ${note.counselor_name}` : 'Counselor not set'} />
            <InfoCard icon={<ShieldCheck className="h-4 w-4" />} label="Approval" value={humanize(note.approval_status)} hint={note.approved_at ? `Approved ${formatISTCompact(note.approved_at)}` : note.rejected_at ? `Rejected ${formatISTCompact(note.rejected_at)}` : 'Waiting for RM verification'} />
            <InfoCard icon={<CalendarClock className="h-4 w-4" />} label="Meeting" value={note.meeting_name || 'No meeting title'} hint={note.meeting_at ? formatISTCompact(note.meeting_at) : 'No meeting time'} />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <MetaRow label="Business" value={note.business_name} />
              <MetaRow label="Budget" value={note.client_budget} />
              <MetaRow label="About client" value={note.about_client} />
              <MetaRow label="Services wanted" value={note.client_services_want} />
              {note.rejection_note && <MetaRow label="Rejection note" value={note.rejection_note} />}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {note.permissions?.can_edit && (
              <button type="button" onClick={() => onEdit(note)} className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                <Pencil className="h-4 w-4" /> Edit Note
              </button>
            )}
            {note.lead_id && (
              <Link href={`/leads/${note.lead_id}`} className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                <Link2 className="h-4 w-4" /> Open Linked Lead
              </Link>
            )}
            {note.permissions?.can_delete && (
              <button type="button" onClick={handleDeleteNote} className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-700">
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            )}
            {note.permissions?.can_approve && note.approval_status !== 'approved' && (
              <button type="button" onClick={handleApprove} className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                <CheckCircle2 className="h-4 w-4" /> Approve for Admin
              </button>
            )}
            {note.permissions?.can_reject && note.approval_status !== 'rejected' && (
              <button type="button" onClick={handleReject} className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-amber-700">
                <XCircle className="h-4 w-4" /> Reject
              </button>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <div className="text-sm font-semibold text-slate-900">Call / Meeting Updates</div>
              <div className="text-xs text-slate-500">Older updates stay visible so the full conversation history remains clear.</div>
            </div>

            <div className="space-y-4 p-4">
              {entries.map((entry, index) => (
                <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={clsx('chip-slate', index === entries.length - 1 && 'chip-blue')}>{index === entries.length - 1 ? 'Latest update' : `Update ${index + 1}`}</span>
                      <span className="text-sm font-medium text-slate-900">{entry.created_by_name || 'User'}</span>
                      {entry.created_by_role && <span className="text-xs text-slate-500">{humanize(entry.created_by_role)}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500" title={formatISTTooltip(entry.created_at)}>{formatISTCompact(entry.created_at)}</span>
                      {note.permissions?.can_edit && (
                        <button type="button" onClick={() => handleEditEntry(entry.id, entry.entry_text)} className="btn-ghost rounded-lg px-2 py-1 text-xs">Edit</button>
                      )}
                      {note.permissions?.can_delete && (
                        <button type="button" onClick={() => handleDeleteEntry(entry.id)} className="btn-ghost rounded-lg px-2 py-1 text-xs text-rose-700">Delete</button>
                      )}
                    </div>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{entry.entry_text}</p>
                </div>
              ))}

              {note.permissions?.can_add_entry && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4">
                  <label className="mb-2 block text-sm font-semibold text-slate-900">Add new update</label>
                  <textarea
                    className="input min-h-[120px] resize-y"
                    placeholder="Write the next call update, meeting change, objection, or response..."
                    value={newEntryText}
                    onChange={(event) => setNewEntryText(event.target.value)}
                  />
                  <div className="mt-3 flex justify-end">
                    <button type="button" onClick={handleAddEntry} disabled={addEntry.isPending} className="btn-primary rounded-lg px-4 py-2 text-sm">
                      {addEntry.isPending ? 'Adding...' : 'Add Update'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-2">
      <span className="block text-sm font-semibold text-slate-900">{label}</span>
      {children}
    </label>
  );
}

function InfoCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value?: string | null;
  hint?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-3 text-sm font-semibold text-slate-900">{value || 'Not available'}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{value}</div>
    </div>
  );
}
