'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Clock, HandMetal, Loader2, RefreshCw, Send, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { EmptyState, Modal, Skeleton } from '@/components/ui/Modal';
import { useAuth } from '@/lib/auth';
import { clsx, humanize } from '@/lib/format';
import { formatISTCompact, formatISTTooltip } from '@/lib/date';
import {
  type LeadRequest,
  useApproveLeadRequest,
  useLeadRequests,
  useMyLeadRequests,
  useRejectLeadRequest,
  useSubmitLeadRequest,
} from '@/hooks/useLeadRequests';

const STATUS_FILTERS = ['', 'pending', 'approved', 'partially_fulfilled', 'fulfilled', 'rejected', 'cancelled'] as const;

const STATUS_CHIP: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  partially_fulfilled: 'bg-violet-100 text-violet-700',
  fulfilled: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
  cancelled: 'bg-slate-100 text-slate-700',
};

export default function LeadRequestsPage() {
  return (
    <AppShell title="Lead Requests" subtitle="Member lead requests, approvals, and fulfillment status">
      <LeadRequestsInner />
    </AppShell>
  );
}

function LeadRequestsInner() {
  const { user } = useAuth();
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<LeadRequest | null>(null);
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin';
  const isManager = isAdmin || user?.role === 'rm';
  const canSubmitRequest = user?.role === 'member' || user?.role === 'partner';

  const managerRequests = useLeadRequests(status || 'all');
  const ownRequests = useMyLeadRequests();
  const approve = useApproveLeadRequest();
  const reject = useRejectLeadRequest();
  const submit = useSubmitLeadRequest();
  const rows = isManager ? (managerRequests.data || []) : (ownRequests.data || []);
  const visibleRows = isManager || !status ? rows : rows.filter(request => request.status === status);
  const loading = isManager ? managerRequests.isLoading : ownRequests.isLoading;
  const fetching = isManager ? managerRequests.isFetching : ownRequests.isFetching;

  const stats = useMemo(() => {
    const pending = rows.filter(r => r.status === 'pending').length;
    const approved = rows.filter(r => ['approved', 'partially_fulfilled', 'fulfilled'].includes(r.status)).length;
    const rejected = rows.filter(r => r.status === 'rejected').length;
    const fulfilled = rows.reduce((sum, r) => sum + fulfilledQty(r), 0);
    return { total: rows.length, pending, approved, rejected, fulfilled };
  }, [rows]);

  function refresh() {
    if (isManager) managerRequests.refetch();
    else ownRequests.refetch();
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard label="Total Requests" value={stats.total} icon={<HandMetal className="h-5 w-5" />} accent="pink" />
        <KpiCard label="Pending" value={stats.pending} icon={<Clock className="h-5 w-5" />} accent="amber" />
        <KpiCard label="Approved" value={stats.approved} icon={<CheckCircle2 className="h-5 w-5" />} accent="blue" />
        <KpiCard label="Rejected" value={stats.rejected} icon={<XCircle className="h-5 w-5" />} accent="slate" />
        <KpiCard label="Leads Assigned" value={stats.fulfilled} icon={<CheckCircle2 className="h-5 w-5" />} accent="green" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Filter:</span>
          {STATUS_FILTERS.map(item => (
            <button
              key={item || 'all'}
              type="button"
              onClick={() => setStatus(item)}
              className={clsx(
                'rounded-full px-3 py-1 text-xs font-medium transition',
                status === item ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              {item ? humanize(item) : 'All'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={fetching}
            className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
          >
            <RefreshCw className={clsx('h-4 w-4', fetching && 'animate-spin')} />
            Refresh
          </button>
          {canSubmitRequest && (
            <button type="button" onClick={() => setRequestFormOpen(true)} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm">
              <Send className="h-4 w-4" />
              Request Leads
            </button>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, idx) => <Skeleton key={idx} className="h-14" />)}</div>
        ) : visibleRows.length === 0 ? (
          <EmptyState title="No lead requests found" description="Member lead requests will appear here after submission." icon={<HandMetal className="h-6 w-6" />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Request</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Progress</th>
                  <th className="px-4 py-3 font-medium">Resolved By</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.map(request => (
                  <LeadRequestRow
                    key={request.id}
                    request={request}
                    canManage={isAdmin}
                    onOpen={() => setSelected(request)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LeadRequestModal
        request={selected}
        canManage={isAdmin}
        loading={approve.isPending || reject.isPending}
        onClose={() => setSelected(null)}
        onApprove={(approvedQuantity, note) => {
          if (!selected) return;
          approve.mutate({ id: selected.id, approvedQuantity, note }, {
            onSuccess: () => {
              toast.success('Lead request approved');
              setSelected(null);
            },
            onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Could not approve request'),
          });
        }}
        onReject={(note) => {
          if (!selected) return;
          reject.mutate({ id: selected.id, note }, {
            onSuccess: () => {
              toast.success('Lead request rejected');
              setSelected(null);
            },
            onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Could not reject request'),
          });
        }}
      />

      <CreateLeadRequestModal
        open={requestFormOpen}
        submitting={submit.isPending}
        onClose={() => setRequestFormOpen(false)}
        onSubmit={(quantity, category, note) => {
          submit.mutate({ quantity, ...(category ? { category } : {}), ...(note ? { note } : {}) }, {
            onSuccess: () => {
              toast.success('Lead request submitted');
              setRequestFormOpen(false);
            },
            onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Could not submit lead request'),
          });
        }}
      />
    </div>
  );
}

function CreateLeadRequestModal({
  open,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (quantity: number, category: string, note: string) => void;
}) {
  const [quantity, setQuantity] = useState(10);
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');

  function submitRequest() {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
      toast.error('Enter a quantity between 1 and 500');
      return;
    }
    onSubmit(quantity, category, note.trim());
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request Leads"
      description="Submit a lead request for admin approval and fulfillment."
      size="md"
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={submitting} className="btn-outline rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button type="button" onClick={submitRequest} disabled={submitting} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Submit Request
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <label className="block">
          <span className="label">Lead Quantity</span>
          <input
            type="number"
            min={1}
            max={500}
            value={quantity}
            onChange={event => setQuantity(Math.max(1, Math.min(500, Number.parseInt(event.target.value, 10) || 1)))}
            className="input w-full"
            disabled={submitting}
          />
        </label>
        <label className="block">
          <span className="label">Lead Category</span>
          <select value={category} onChange={event => setCategory(event.target.value)} className="input w-full" disabled={submitting}>
            <option value="">Any available lead</option>
            <option value="partner">Partner leads</option>
            <option value="trader">Trader leads</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Note <span className="font-normal text-slate-400">(optional)</span></span>
          <textarea
            value={note}
            onChange={event => setNote(event.target.value)}
            maxLength={500}
            rows={4}
            className="input w-full resize-y"
            placeholder="Add any lead preference or context"
            disabled={submitting}
          />
        </label>
      </div>
    </Modal>
  );
}

function LeadRequestRow({ request, canManage, onOpen }: { request: LeadRequest; canManage: boolean; onOpen: () => void }) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-3">
        <div className="font-medium text-slate-900">{request.full_name || 'Member'}</div>
        <div className="text-xs text-slate-500">{request.email || request.team_name || 'Not available'}</div>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium text-slate-900">{requestedQty(request)} lead{requestedQty(request) === 1 ? '' : 's'}</div>
        <div className="text-xs text-slate-500">{request.category ? humanize(request.category) : 'Any category'}</div>
      </td>
      <td className="px-4 py-3">
        <span className={clsx('rounded-full px-2.5 py-1 text-xs font-medium', STATUS_CHIP[request.status] || STATUS_CHIP.pending)}>
          {humanize(request.status)}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${progressPct(request)}%` }} />
          </div>
          <span className="text-xs tabular-nums text-slate-500">{fulfilledQty(request)}/{approvedQty(request)}</span>
        </div>
        <div className="mt-1 text-[11px] text-slate-400">Remaining {remainingQty(request)}</div>
      </td>
      <td className="px-4 py-3 text-slate-600">{request.resolved_by_name || <span className="text-slate-400">-</span>}</td>
      <td className="px-4 py-3 text-xs text-slate-500" title={formatISTTooltip(request.created_at)}>{formatISTCompact(request.created_at)}</td>
      <td className="px-4 py-3">
        <button type="button" onClick={onOpen} className="btn-outline rounded-lg px-3 py-1.5 text-xs">
          {canManage && request.status === 'pending' ? 'Review' : 'View'}
        </button>
      </td>
    </tr>
  );
}

function LeadRequestModal({
  request,
  canManage,
  loading,
  onClose,
  onApprove,
  onReject,
}: {
  request: LeadRequest | null;
  canManage: boolean;
  loading: boolean;
  onClose: () => void;
  onApprove: (approvedQuantity: number, note?: string) => void;
  onReject: (note?: string) => void;
}) {
  const [approvedQuantity, setApprovedQuantity] = useState(1);
  const [note, setNote] = useState('');

  if (!request) return null;

  const requested = requestedQty(request);
  const canReview = canManage && request.status === 'pending';

  return (
    <Modal open={!!request} onClose={onClose} title="Lead Request Details" size="lg">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Info label="Member" value={request.full_name || 'Member'} />
          <Info label="Team" value={request.team_name || 'Not available'} />
          <Info label="Requested Quantity" value={requested} />
          <Info label="Approved Quantity" value={approvedQty(request)} />
          <Info label="Fulfilled Quantity" value={fulfilledQty(request)} />
          <Info label="Remaining" value={remainingQty(request)} />
          <Info label="Category" value={request.category ? humanize(request.category) : 'Any category'} />
          <Info label="Status" value={humanize(request.status)} />
        </div>

        {request.note && <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{request.note}</div>}
        {request.resolve_note && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{request.resolve_note}</div>}

        {canReview && (
          <div className="space-y-3 rounded-xl border border-slate-200 p-4">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Approved Quantity</span>
              <input
                type="number"
                min={1}
                value={approvedQuantity || requested}
                onChange={event => setApprovedQuantity(Math.max(1, Number(event.target.value) || 1))}
                className="input w-full"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Note</span>
              <textarea value={note} onChange={event => setNote(event.target.value)} className="input min-h-[80px] w-full" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => onReject(note || undefined)} disabled={loading} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                Reject
              </button>
              <button type="button" onClick={() => onApprove(approvedQuantity || requested, note || undefined)} disabled={loading} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Approve
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function requestedQty(request: LeadRequest) {
  return Number(request.requested_quantity ?? request.quantity ?? 0);
}

function approvedQty(request: LeadRequest) {
  return Number(request.approved_quantity ?? request.quantity ?? requestedQty(request));
}

function fulfilledQty(request: LeadRequest) {
  return Number(request.fulfilled_quantity ?? request.leads_assigned ?? 0);
}

function remainingQty(request: LeadRequest) {
  return Math.max(0, approvedQty(request) - fulfilledQty(request));
}

function progressPct(request: LeadRequest) {
  const approved = approvedQty(request);
  return approved > 0 ? Math.min(100, Math.round((fulfilledQty(request) / approved) * 100)) : 0;
}
