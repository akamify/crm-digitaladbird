'use client';

import { useEffect, useState } from 'react';
import { LifeBuoy, Loader2, RefreshCw, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, Modal, Skeleton } from '@/components/ui/Modal';
import { useAuth } from '@/lib/auth';
import { clsx, humanize } from '@/lib/format';
import { formatISTCompact, formatISTTooltip } from '@/lib/date';
import { useCreateSupportTicket, useMySupportTickets, type SupportTicket } from '@/hooks/useSupportTickets';

const STATUS_CLASS: Record<string, string> = {
  open: 'bg-amber-100 text-amber-800',
  solved: 'bg-emerald-100 text-emerald-800',
  not_solved: 'bg-rose-100 text-rose-800',
};

export default function SupportPage() {
  return (
    <AppShell title="Support" subtitle="Raise a ticket for any CRM issue." roles={['rm', 'member', 'partner']}>
      <SupportInner />
    </AppShell>
  );
}

function SupportInner() {
  const { user } = useAuth();
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [phone, setPhone] = useState(user?.phone || '');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [filters, setFilters] = useState({ status: '', search: '', sort: 'newest', page: 1, page_size: 10 });
  const tickets = useMySupportTickets(filters);
  const create = useCreateSupportTicket();

  const rows = tickets.data?.rows || [];
  const pagination = tickets.data?.pagination || { page: 1, page_size: 10, total: 0 };
  const totalPages = Math.max(1, Math.ceil((pagination.total || 0) / pagination.page_size));

  useEffect(() => {
    if (user?.phone) setPhone(user.phone);
  }, [user?.phone]);

  function submit() {
    if (!phone.trim()) {
      toast.error('Phone number is required');
      return;
    }
    if (!subject.trim() || !description.trim()) {
      toast.error('Subject and problem description are required');
      return;
    }
    create.mutate({ phone, subject, description }, {
      onSuccess: (ticket) => {
        toast.success(`Ticket created: ${ticket.ticketNo}`);
        setSubject('');
        setDescription('');
        setRaiseOpen(false);
        tickets.refetch();
      },
      onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Could not create support ticket'),
    });
  }

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">My Tickets</h2>
            <p className="text-sm text-slate-500">Track your support ticket status and admin notes.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setRaiseOpen(true)} className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
              <LifeBuoy className="h-4 w-4" />
              Raise Ticket
            </button>
            <button type="button" onClick={() => tickets.refetch()} disabled={tickets.isFetching} className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
              <RefreshCw className={clsx('h-4 w-4', tickets.isFetching && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap gap-3">
          <select className="input w-full sm:w-44" value={filters.status} onChange={event => setFilters(prev => ({ ...prev, status: event.target.value, page: 1 }))}>
            <option value="">All Status</option>
            <option value="open">Open</option>
            <option value="solved">Solved</option>
            <option value="not_solved">Not Solved</option>
          </select>
          <select className="input w-full sm:w-44" value={filters.sort} onChange={event => setFilters(prev => ({ ...prev, sort: event.target.value, page: 1 }))}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input w-full pl-10" value={filters.search} onChange={event => setFilters(prev => ({ ...prev, search: event.target.value, page: 1 }))} placeholder="Search tickets..." />
          </div>
        </div>

        {tickets.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-16" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState title="No support tickets yet" description="Submitted support tickets will appear here." icon={<LifeBuoy className="h-6 w-6" />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-medium">Ticket No</th>
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Last Update</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(ticket => <TicketRow key={ticket.id} ticket={ticket} onView={() => setSelectedTicket(ticket)} />)}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={filters.page} totalPages={totalPages} onChange={page => setFilters(prev => ({ ...prev, page }))} />
      </div>

      <Modal
        open={raiseOpen}
        onClose={() => setRaiseOpen(false)}
        title="Raise Ticket"
        description="Tell admin what issue you are facing in CRM."
        footer={(
          <>
            <button type="button" onClick={() => setRaiseOpen(false)} className="btn-outline rounded-lg px-4 py-2 text-sm">Cancel</button>
            <button type="button" onClick={submit} disabled={create.isPending} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm">
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit Ticket
            </button>
          </>
        )}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <ReadOnly label="Name" value={user?.name || ''} />
          <ReadOnly label="Email" value={user?.email || ''} />
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium text-slate-700">Phone</span>
            <input className="input w-full" value={phone} onChange={event => setPhone(event.target.value)} placeholder="Enter phone number" readOnly={Boolean(user?.phone)} />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium text-slate-700">Subject</span>
            <input className="input w-full" value={subject} onChange={event => setSubject(event.target.value)} placeholder="Short issue title" />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium text-slate-700">Problem / Description</span>
            <textarea className="input min-h-[130px] w-full" value={description} onChange={event => setDescription(event.target.value)} placeholder="Explain the issue clearly" />
          </label>
        </div>
      </Modal>

      <Modal open={Boolean(selectedTicket)} onClose={() => setSelectedTicket(null)} title="Ticket Details" size="lg">
        {selectedTicket && (
          <div className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <Info label="Ticket No" value={selectedTicket.ticketNo || selectedTicket.ticket_no} />
              <Info label="Status" value={humanize(selectedTicket.status)} />
              <Info label="Submitted" value={formatISTCompact(selectedTicket.createdAt || selectedTicket.created_at)} />
              <Info label="Last Update" value={lastUpdateLabel(selectedTicket)} />
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <h3 className="font-semibold text-slate-900">{selectedTicket.subject}</h3>
              <p className="mt-2 whitespace-pre-wrap text-slate-700">{selectedTicket.body}</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-4 text-amber-900">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Last admin note</div>
              <p className="mt-1 whitespace-pre-wrap">{selectedTicket.lastAdminNote || selectedTicket.last_admin_note || 'No admin note yet.'}</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input className="input w-full bg-slate-50 text-slate-600" value={value || 'Not available'} readOnly />
    </label>
  );
}

function TicketRow({ ticket, onView }: { ticket: SupportTicket; onView: () => void }) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-3 font-medium text-slate-900">{ticket.ticketNo || ticket.ticket_no}</td>
      <td className="px-4 py-3">
        <div className="max-w-[260px] truncate font-medium text-slate-800">{ticket.subject}</div>
      </td>
      <td className="px-4 py-3"><StatusBadge status={ticket.status} /></td>
      <td className="px-4 py-3 text-xs text-slate-500" title={formatISTTooltip(ticket.createdAt || ticket.created_at)}>{formatISTCompact(ticket.createdAt || ticket.created_at)}</td>
      <td className="px-4 py-3 text-xs text-slate-500">{lastUpdateLabel(ticket)}</td>
      <td className="px-4 py-3"><button type="button" onClick={onView} className="btn-outline rounded-lg px-3 py-1.5 text-xs">View</button></td>
    </tr>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={clsx('rounded-full px-2.5 py-1 text-xs font-medium', STATUS_CLASS[status] || STATUS_CLASS.open)}>{humanize(status)}</span>;
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  return (
    <div className="mt-4 flex items-center justify-end gap-2 text-sm">
      <button className="btn-outline rounded-lg px-3 py-1.5 disabled:opacity-50" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
      <span className="text-slate-500">Page {page} of {totalPages}</span>
      <button className="btn-outline rounded-lg px-3 py-1.5 disabled:opacity-50" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  );
}

function lastUpdateLabel(ticket: SupportTicket) {
  const resolvedAt = ticket.status === 'solved' ? ticket.solvedAt || ticket.solved_at : ticket.status === 'not_solved' ? ticket.notSolvedAt || ticket.not_solved_at : null;
  return resolvedAt ? formatISTCompact(resolvedAt) : formatISTCompact(ticket.updatedAt || ticket.updated_at || ticket.createdAt || ticket.created_at);
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 font-medium text-slate-900">{value || '-'}</div>
    </div>
  );
}
