'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, LifeBuoy, Loader2, RefreshCw, Search, XCircle } from 'lucide-react';
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
  open: 'bg-amber-100 text-amber-800',
  solved: 'bg-emerald-100 text-emerald-800',
  not_solved: 'bg-rose-100 text-rose-800',
};

export default function AdminSupportTicketsPage() {
  return (
    <AppShell title="Raised Tickets" subtitle="Review and resolve CRM support tickets." roles={['super_admin', 'admin']}>
      <AdminSupportTicketsInner />
    </AppShell>
  );
}

function AdminSupportTicketsInner() {
  const [filters, setFilters] = useState({ status: '', role: '', search: '', sort: 'newest', page: 1, page_size: 20 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tickets = useAdminSupportTickets(filters);
  const rows = tickets.data?.rows || [];
  const pagination = tickets.data?.pagination || { page: 1, page_size: 20, total: 0 };
  const totalPages = Math.max(1, Math.ceil((pagination.total || 0) / pagination.page_size));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LifeBuoy className="h-5 w-5 text-brand-600" />
          <h2 className="text-lg font-semibold text-slate-900">Support Tickets</h2>
          <span className="chip-slate">{pagination.total || 0} total</span>
        </div>
        <button type="button" onClick={() => tickets.refetch()} disabled={tickets.isFetching} className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
          <RefreshCw className={clsx('h-4 w-4', tickets.isFetching && 'animate-spin')} />
          Refresh
        </button>
      </div>

      <div className="card p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_160px_160px_160px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input w-full pl-10"
              value={filters.search}
              onChange={event => setFilters(prev => ({ ...prev, search: event.target.value, page: 1 }))}
              placeholder="Search ticket no, name, email, phone, CP ID, subject..."
            />
          </div>
          <select className="input" value={filters.status} onChange={event => setFilters(prev => ({ ...prev, status: event.target.value, page: 1 }))}>
            <option value="">All Status</option>
            <option value="open">Open</option>
            <option value="solved">Solved</option>
            <option value="not_solved">Not Solved</option>
          </select>
          <select className="input" value={filters.role} onChange={event => setFilters(prev => ({ ...prev, role: event.target.value, page: 1 }))}>
            <option value="">All Roles</option>
            <option value="rm">RM</option>
            <option value="member">Member</option>
            <option value="partner">Partner</option>
          </select>
          <select className="input" value={filters.sort} onChange={event => setFilters(prev => ({ ...prev, sort: event.target.value, page: 1 }))}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="status">Status</option>
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        {tickets.isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-16" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState title="No support tickets found" description="Raised support tickets will appear here." icon={<LifeBuoy className="h-6 w-6" />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] table-fixed text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="w-32 px-4 py-3 font-medium">Ticket No</th>
                  <th className="w-44 px-4 py-3 font-medium">Name</th>
                  <th className="w-60 px-4 py-3 font-medium">Email</th>
                  <th className="w-48 px-4 py-3 font-medium">Phone / CP ID</th>
                  <th className="w-28 px-4 py-3 font-medium">Role</th>
                  <th className="w-72 px-4 py-3 font-medium">Subject</th>
                  <th className="w-32 px-4 py-3 font-medium">Status</th>
                  <th className="w-36 px-4 py-3 font-medium">Submitted</th>
                  <th className="w-40 px-4 py-3 font-medium">Solved / Not solved</th>
                  <th className="w-28 px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(ticket => (
                  <tr
                    key={ticket.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setSelectedId(ticket.id)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedId(ticket.id);
                      }
                    }}
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{ticket.ticketNo || ticket.ticket_no}</td>
                    <td className="px-4 py-3"><div className="truncate" title={ticket.name}>{ticket.name}</div></td>
                    <td className="px-4 py-3 text-slate-600"><div className="truncate" title={ticket.email}>{ticket.email}</div></td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div className="truncate" title={ticket.phone}>{ticket.phone}</div>
                      <div className="truncate" title={ticket.cpId || ticket.cp_id || '-'}>{ticket.cpId || ticket.cp_id || '-'}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3"><span className="chip-blue">{humanize(ticket.role)}</span></td>
                    <td className="px-4 py-3"><div className="truncate" title={ticket.subject}>{ticket.subject}</div></td>
                    <td className="whitespace-nowrap px-4 py-3"><StatusBadge status={ticket.status} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500" title={formatISTTooltip(ticket.createdAt || ticket.created_at)}>{formatISTCompact(ticket.createdAt || ticket.created_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{resolvedAtLabel(ticket)}</td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(ticket.id); }} className="btn-outline rounded-lg px-3 py-1.5 text-xs">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pagination page={filters.page} totalPages={totalPages} onChange={page => setFilters(prev => ({ ...prev, page }))} />
      <TicketDetailModal ticketId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function TicketDetailModal({ ticketId, onClose }: { ticketId: string | null; onClose: () => void }) {
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
    updateStatus.mutate({ ticketId: ticket.id, status: action, adminNote: note }, {
      onSuccess: () => {
        toast.success(action === 'solved' ? 'Ticket marked solved' : 'Ticket marked not solved');
        setAction(null);
        setNote('');
        detail.refetch();
      },
      onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Could not update ticket'),
    });
  }

  return (
    <Modal open={Boolean(ticketId)} onClose={onClose} title="Support Ticket Details" size="xl">
      {detail.isLoading || !ticket ? (
        <Skeleton className="h-72" />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2">
            <Info label="Ticket No" value={ticket.ticketNo || ticket.ticket_no} />
            <Info label="Status" value={<StatusBadge status={ticket.status} />} />
            <Info label="Name" value={ticket.name} />
            <Info label="Role" value={humanize(ticket.role)} />
            <Info label="Email" value={ticket.email} />
            <Info label="Phone" value={ticket.phone} />
            <Info label="CP ID" value={ticket.cpId || ticket.cp_id || '-'} />
            <Info label="Submitted At" value={formatISTCompact(ticket.createdAt || ticket.created_at)} />
            <Info label="Solved At" value={ticket.solvedAt || ticket.solved_at ? formatISTCompact(ticket.solvedAt || ticket.solved_at || '') : '-'} />
            <Info label="Not Solved At" value={ticket.notSolvedAt || ticket.not_solved_at ? formatISTCompact(ticket.notSolvedAt || ticket.not_solved_at || '') : '-'} />
          </div>

          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-900">{ticket.subject}</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{ticket.body}</p>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Last admin note</div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-amber-900">{ticket.lastAdminNote || ticket.last_admin_note || 'No admin note yet.'}</p>
          </div>

          {isClosed ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              This ticket is already {humanize(ticket.status)}. The final status can be updated only once.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setAction('solved')} className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                <CheckCircle2 className="h-4 w-4" /> Mark as Solved
              </button>
              <button type="button" onClick={() => setAction('not_solved')} className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                <XCircle className="h-4 w-4" /> Mark as Not Solved
              </button>
            </div>
          )}

          {action && !isClosed && (
            <div className="rounded-xl border border-slate-200 p-4">
              <label className="space-y-1 text-sm">
                <span className="font-medium text-slate-700">Admin note for {humanize(action)}</span>
                <textarea className="input min-h-[100px] w-full" value={note} onChange={event => setNote(event.target.value)} placeholder="Required note for the ticket creator" />
              </label>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" className="btn-outline rounded-lg px-3 py-2 text-sm" onClick={() => { setAction(null); setNote(''); }}>Cancel</button>
                <button type="button" disabled={updateStatus.isPending} className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm" onClick={submit}>
                  {updateStatus.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Submit
                </button>
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">History</h3>
            <div className="space-y-2">
              {(ticket.history || []).map(item => (
                <div key={item.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-slate-800">{humanize(item.action)} {item.status ? `- ${humanize(item.status)}` : ''}</span>
                    <span className="text-xs text-slate-500">{formatISTCompact(item.createdAt || item.created_at)}</span>
                  </div>
                  {item.adminNote || item.admin_note ? <p className="mt-1 text-slate-600">{item.adminNote || item.admin_note}</p> : null}
                  {item.actorName && <p className="mt-1 text-xs text-slate-500">By {item.actorName}</p>}
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
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: SupportTicketStatus | string }) {
  return <span className={clsx('rounded-full px-2.5 py-1 text-xs font-medium', STATUS_CLASS[status] || STATUS_CLASS.open)}>{humanize(status)}</span>;
}

function resolvedAtLabel(ticket: SupportTicket) {
  const value = ticket.status === 'solved'
    ? ticket.solvedAt || ticket.solved_at
    : ticket.status === 'not_solved'
      ? ticket.notSolvedAt || ticket.not_solved_at
      : null;
  return value ? formatISTCompact(value) : '-';
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  return (
    <div className="flex items-center justify-end gap-2 text-sm">
      <button className="btn-outline rounded-lg px-3 py-1.5 disabled:opacity-50" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
      <span className="text-slate-500">Page {page} of {totalPages}</span>
      <button className="btn-outline rounded-lg px-3 py-1.5 disabled:opacity-50" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  );
}
