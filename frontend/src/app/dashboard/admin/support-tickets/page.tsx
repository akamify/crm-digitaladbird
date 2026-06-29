'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  CheckCircle2,
  LifeBuoy,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, Modal, Skeleton } from '@/components/ui/Modal';
import { clsx, humanize } from '@/lib/format';
import { formatISTCompact, formatISTTooltip } from '@/lib/date';
import {
  useAdminSupportTickets,
  useSupportTicket,
  useUpdateSupportTicketStatus,
  type SupportTicket,
  type SupportTicketStatus,
} from '@/hooks/useSupportTickets';

const STATUS_CLASS: Record<string, string> = {
  open: 'bg-amber-100 text-amber-800 ring-amber-200',
  solved: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  not_solved: 'bg-rose-100 text-rose-800 ring-rose-200',
};

const CONTROL_CLASS =
  'input h-12 w-full rounded-2xl border-slate-200 bg-white text-sm shadow-sm transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15';

export default function AdminSupportTicketsPage() {
  return (
    <AppShell
      title="Raised Tickets"
      subtitle="Review and resolve CRM support tickets."
      roles={['super_admin', 'admin']}
    >
      <AdminSupportTicketsInner />
    </AppShell>
  );
}

function AdminSupportTicketsInner() {
  const [filters, setFilters] = useState({
    status: '',
    role: '',
    search: '',
    sort: 'newest',
    page: 1,
    page_size: 20,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const tickets = useAdminSupportTickets(filters);
  const rows = tickets.data?.rows || [];
  const pagination = tickets.data?.pagination || {
    page: 1,
    page_size: 20,
    total: 0,
  };

  const totalPages = Math.max(
    1,
    Math.ceil((pagination.total || 0) / (pagination.page_size || 20)),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-100 text-brand-700">
            <LifeBuoy className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-slate-950">
              Support Tickets
            </h2>
            <p className="text-sm text-slate-500">
              {(pagination.total || 0).toLocaleString()} total tickets
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => tickets.refetch()}
          disabled={tickets.isFetching}
          className="btn-outline inline-flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={clsx('h-4 w-4', tickets.isFetching && 'animate-spin')} />
          Refresh
        </button>
      </div>

      <div className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-stretch justify-center gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1 lg:max-w-[520px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

            <input
              className={clsx(CONTROL_CLASS, 'min-w-0 pl-11 pr-4')}
              value={filters.search}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  search: event.target.value,
                  page: 1,
                }))
              }
              placeholder="Search ticket no, name, email, phone, CP ID, subject..."
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:flex lg:shrink-0 lg:items-center lg:justify-center">
            <select
              className={clsx(CONTROL_CLASS, 'lg:w-[180px]')}
              value={filters.status}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  status: event.target.value,
                  page: 1,
                }))
              }
            >
              <option value="">All Status</option>
              <option value="open">Open</option>
              <option value="solved">Solved</option>
              <option value="not_solved">Not Solved</option>
            </select>

            <select
              className={clsx(CONTROL_CLASS, 'lg:w-[180px]')}
              value={filters.role}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  role: event.target.value,
                  page: 1,
                }))
              }
            >
              <option value="">All Roles</option>
              <option value="rm">RM</option>
              <option value="member">Member</option>
              <option value="partner">Partner</option>
            </select>

            <select
              className={clsx(CONTROL_CLASS, 'lg:w-[160px]')}
              value={filters.sort}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  sort: event.target.value,
                  page: 1,
                }))
              }
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="status">Status</option>
            </select>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm">
        {tickets.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-16 rounded-2xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No support tickets found"
              description="Raised support tickets will appear here."
              icon={<LifeBuoy className="h-6 w-6" />}
            />
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <div className="min-w-[1180px]">
              <div className="grid grid-cols-[160px_minmax(220px,1.1fr)_170px_95px_minmax(190px,1fr)_115px_125px_125px_80px] items-center gap-4 border-b border-slate-100 bg-slate-50/90 px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <div>Ticket No</div>
                <div>Requester</div>
                <div>Phone / CP ID</div>
                <div>Role</div>
                <div>Subject</div>
                <div>Status</div>
                <div>Submitted</div>
                <div>Resolved</div>
                <div className="text-right">Action</div>
              </div>

              <div className="divide-y divide-slate-100">
                {rows.map((ticket) => (
                  <TicketRow
                    key={ticket.id}
                    ticket={ticket}
                    onOpen={() => setSelectedId(ticket.id)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <Pagination
        page={filters.page}
        totalPages={totalPages}
        onChange={(page) => setFilters((prev) => ({ ...prev, page }))}
      />

      <TicketDetailModal ticketId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function TicketRow({
  ticket,
  onOpen,
}: {
  ticket: SupportTicket;
  onOpen: () => void;
}) {
  const ticketNo = ticket.ticketNo || ticket.ticket_no || '-';
  const cpId = ticket.cpId || ticket.cp_id || '-';
  const createdAt = ticket.createdAt || ticket.created_at;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="grid cursor-pointer grid-cols-[160px_minmax(220px,1.1fr)_170px_95px_minmax(190px,1fr)_115px_125px_125px_80px] items-center gap-4 px-5 py-4 transition hover:bg-slate-50"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-950" title={ticketNo}>
          {ticketNo}
        </div>
      </div>

      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-900" title={ticket.name || '-'}>
          {ticket.name || '-'}
        </div>
        <div className="mt-0.5 truncate text-xs text-slate-500" title={ticket.email || '-'}>
          {ticket.email || '-'}
        </div>
      </div>

      <div className="min-w-0 text-xs leading-5 text-slate-600">
        <div className="truncate" title={ticket.phone || '-'}>
          {ticket.phone || '-'}
        </div>
        <div className="truncate font-medium text-slate-500" title={cpId}>
          {cpId}
        </div>
      </div>

      <div className="min-w-0">
        <span className="inline-flex max-w-full items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
          <span className="truncate">{humanize(ticket.role)}</span>
        </span>
      </div>

      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-slate-900" title={ticket.subject || '-'}>
          {ticket.subject || '-'}
        </div>
      </div>

      <div className="min-w-0">
        <StatusBadge status={ticket.status} />
      </div>

      <div
        className="min-w-0 truncate text-xs font-medium text-slate-500"
        title={createdAt ? formatISTTooltip(createdAt) : '-'}
      >
        {createdAt ? formatISTCompact(createdAt) : '-'}
      </div>

      <div className="min-w-0 truncate text-xs font-medium text-slate-500">
        {resolvedAtLabel(ticket)}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className="btn-outline rounded-2xl px-3 py-1.5 text-xs"
        >
          View
        </button>
      </div>
    </div>
  );
}

function TicketDetailModal({
  ticketId,
  onClose,
}: {
  ticketId: string | null;
  onClose: () => void;
}) {
  const detail = useSupportTicket(ticketId, true);
  const updateStatus = useUpdateSupportTicketStatus();

  const [action, setAction] = useState<'solved' | 'not_solved' | null>(null);
  const [note, setNote] = useState('');

  const ticket = detail.data;
  const isClosed = ticket?.status === 'solved' || ticket?.status === 'not_solved';

  function submit() {
    if (!ticket || !action) return;

    if (!note.trim()) {
      toast.error('Admin note is required');
      return;
    }

    updateStatus.mutate(
      {
        ticketId: ticket.id,
        status: action,
        adminNote: note,
      },
      {
        onSuccess: () => {
          toast.success(action === 'solved' ? 'Ticket marked solved' : 'Ticket marked not solved');
          setAction(null);
          setNote('');
          detail.refetch();
        },
        onError: (error: any) => {
          toast.error(error?.response?.data?.error?.message || 'Could not update ticket');
        },
      },
    );
  }

  return (
    <Modal open={Boolean(ticketId)} onClose={onClose} title="Support Ticket Details" size="xl">
      {detail.isLoading || !ticket ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : (
        <div className="space-y-5">
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            <Info label="Ticket No" value={ticket.ticketNo || ticket.ticket_no || '-'} />
            <Info label="Status" value={<StatusBadge status={ticket.status} />} />
            <Info label="Name" value={ticket.name || '-'} />
            <Info label="Role" value={humanize(ticket.role)} />
            <Info label="Email" value={ticket.email || '-'} />
            <Info label="Phone" value={ticket.phone || '-'} />
            <Info label="CP ID" value={ticket.cpId || ticket.cp_id || '-'} />
            <Info label="Submitted At" value={formatISTCompact(ticket.createdAt || ticket.created_at)} />
            <Info
              label="Solved At"
              value={
                ticket.solvedAt || ticket.solved_at
                  ? formatISTCompact(ticket.solvedAt || ticket.solved_at || '')
                  : '-'
              }
            />
            <Info
              label="Not Solved At"
              value={
                ticket.notSolvedAt || ticket.not_solved_at
                  ? formatISTCompact(ticket.notSolvedAt || ticket.not_solved_at || '')
                  : '-'
              }
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="break-words font-semibold text-slate-950">{ticket.subject}</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
              {ticket.body}
            </p>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
              Last admin note
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-amber-950">
              {ticket.lastAdminNote || ticket.last_admin_note || 'No admin note yet.'}
            </p>
          </div>

          {isClosed ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              This ticket is already {humanize(ticket.status)}. The final status can be updated only once.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAction('solved')}
                className="btn-primary inline-flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm"
              >
                <CheckCircle2 className="h-4 w-4" />
                Mark as Solved
              </button>

              <button
                type="button"
                onClick={() => setAction('not_solved')}
                className="btn-outline inline-flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm"
              >
                <XCircle className="h-4 w-4" />
                Mark as Not Solved
              </button>
            </div>
          )}

          {action && !isClosed && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <label className="block space-y-1.5 text-sm">
                <span className="font-semibold text-slate-700">
                  Admin note for {humanize(action)}
                </span>
                <textarea
                  className={clsx(CONTROL_CLASS, 'min-h-[110px] resize-y py-3')}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Required note for the ticket creator"
                />
              </label>

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className="btn-outline rounded-2xl px-3.5 py-2 text-sm"
                  onClick={() => {
                    setAction(null);
                    setNote('');
                  }}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={updateStatus.isPending}
                  className="btn-primary inline-flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={submit}
                >
                  {updateStatus.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Submit
                </button>
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-950">History</h3>

            <div className="space-y-2">
              {(ticket.history || []).map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800">
                      {humanize(item.action)} {item.status ? `- ${humanize(item.status)}` : ''}
                    </span>
                    <span className="text-xs text-slate-500">
                      {formatISTCompact(item.createdAt || item.created_at)}
                    </span>
                  </div>

                  {item.adminNote || item.admin_note ? (
                    <p className="mt-1 whitespace-pre-wrap break-words text-slate-600">
                      {item.adminNote || item.admin_note}
                    </p>
                  ) : null}

                  {item.actorName && (
                    <p className="mt-1 text-xs text-slate-500">By {item.actorName}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 min-w-0 break-words text-sm font-semibold text-slate-950">
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: SupportTicketStatus | string }) {
  return (
    <span
      className={clsx(
        'inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1',
        STATUS_CLASS[status] || STATUS_CLASS.open,
      )}
    >
      <span className="truncate">{humanize(status)}</span>
    </span>
  );
}

function resolvedAtLabel(ticket: SupportTicket) {
  const value =
    ticket.status === 'solved'
      ? ticket.solvedAt || ticket.solved_at
      : ticket.status === 'not_solved'
        ? ticket.notSolvedAt || ticket.not_solved_at
        : null;

  return value ? formatISTCompact(value) : '-';
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
      <button
        type="button"
        className="btn-outline rounded-2xl px-3.5 py-2 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>

      <span className="rounded-2xl bg-white px-3.5 py-2 font-medium text-slate-500 shadow-sm ring-1 ring-slate-200">
        Page {page} of {totalPages}
      </span>

      <button
        type="button"
        className="btn-outline rounded-2xl px-3.5 py-2 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}