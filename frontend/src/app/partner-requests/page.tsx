'use client';
import { useState } from 'react';
import {
  HandMetal, Clock, CheckCircle2, XCircle, Truck, Package, Users,
  ChevronRight, Loader2, Send, X, History,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { EmptyState, Modal, Skeleton } from '@/components/ui/Modal';
import { useAuth } from '@/lib/auth';
import { fmtRelative, clsx, humanize } from '@/lib/format';
import { formatISTCompact, formatISTDateTime, formatISTTooltip } from '@/lib/date';
import {
  usePartnerRequests, usePartnerRequestDetail, usePartnerRequestStats,
  useSubmitPartnerRequest, useApprovePartnerRequest, useRejectPartnerRequest,
  useAutoAssignPartnerRequest, useCancelPartnerRequest,
  type PartnerRequest,
} from '@/hooks/usePartnerRequests';

const STATUS_CHIP: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-700',
  approved:  'bg-emerald-100 text-emerald-700',
  rejected:  'bg-rose-100 text-rose-700',
  assigned:  'bg-blue-100 text-blue-700',
  completed: 'bg-violet-100 text-violet-700',
};

const STATUS_ICON: Record<string, typeof Clock> = {
  pending: Clock,
  approved: CheckCircle2,
  rejected: XCircle,
  assigned: Truck,
  completed: Package,
};

export default function PartnerRequestsPage() {
  return (
    <AppShell title="Partner Requests" subtitle="Lead request workflow management">
      <PartnerRequestsInner />
    </AppShell>
  );
}

function PartnerRequestsInner() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const isPartner = user?.role === 'partner' || user?.role === 'member';
  const isAdmin = user?.role === 'super_admin';
  const isRM = user?.role === 'rm';
  const canManage = isAdmin || isRM;

  const stats = usePartnerRequestStats();
  const requests = usePartnerRequests(statusFilter || undefined, page);
  const detail = usePartnerRequestDetail(selectedId);

  const approve = useApprovePartnerRequest();
  const reject = useRejectPartnerRequest();
  const autoAssign = useAutoAssignPartnerRequest();
  const cancel = useCancelPartnerRequest();

  const s = stats.data;
  const rows = requests.data?.rows ?? [];
  const total = requests.data?.total ?? 0;
  const totalPages = Math.ceil(total / 25);

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {stats.isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <KpiCard label="Total Requests" value={s?.total_requests ?? 0} icon={<HandMetal className="h-5 w-5" />} accent="pink" />
            <KpiCard label="Pending" value={s?.pending ?? 0} icon={<Clock className="h-5 w-5" />} accent="amber" delta="Awaiting action" />
            <KpiCard label="Approved Today" value={s?.approved_today ?? 0} icon={<CheckCircle2 className="h-5 w-5" />} accent="green" />
            <KpiCard label="Leads Assigned" value={s?.total_leads_assigned ?? 0} icon={<Truck className="h-5 w-5" />} accent="blue" />
            <KpiCard label="Active Partners" value={s?.active_partners_week ?? 0} icon={<Users className="h-5 w-5" />} accent="slate" delta="Last 7 days" />
          </>
        )}
      </div>

      {/* Actions Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Filter:</span>
          {['', 'pending', 'approved', 'assigned', 'rejected', 'completed'].map(st => (
            <button
              key={st}
              onClick={() => { setStatusFilter(st); setPage(1); }}
              className={clsx(
                'rounded-full px-3 py-1 text-xs font-medium transition',
                statusFilter === st
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              )}
            >
              {st || 'All'}
            </button>
          ))}
        </div>

        {isPartner && (
          <button
            onClick={() => setShowNewForm(true)}
            className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
          >
            <Send className="h-4 w-4" /> Request Leads
          </button>
        )}
      </div>

      {/* New Request Form (Partners) */}
      {showNewForm && isPartner && (
        <NewRequestForm onClose={() => setShowNewForm(false)} />
      )}

      {/* Main Content */}
      <div className="flex gap-6">
        <div className="flex-1 min-w-0">
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Partner</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Request</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">RM</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Progress</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Time</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {requests.isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}><td colSpan={7} className="px-4 py-3"><Skeleton className="h-10" /></td></tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10">
                      <EmptyState title="No partner requests found" description="Try a different status filter or submit a new request." icon={<HandMetal className="h-6 w-6" />} />
                    </td>
                  </tr>
                ) : rows.map(r => (
                  <RequestRow key={r.id} req={r} selected={selectedId === r.id} onSelect={() => setSelectedId(r.id)} />
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                <span className="text-xs text-slate-500">{total} total requests</span>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setPage(i + 1)}
                      className={clsx(
                        'rounded-md px-2.5 py-1 text-xs font-medium transition',
                        page === i + 1 ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                      )}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      <Modal open={!!selectedId} onClose={() => setSelectedId(null)} title="Request Details" size="xl">
        {selectedId && (
          <DetailPanel
            id={selectedId}
            detail={detail.data ?? null}
            loading={detail.isLoading}
            canManage={canManage}
            onClose={() => setSelectedId(null)}
            onApprove={(note) => approve.mutate({ id: selectedId, note }, {
              onSuccess: () => { toast.success('Request approved'); setSelectedId(null); },
              onError: (e: any) => toast.error(e?.response?.data?.error?.message || 'Failed'),
            })}
            onReject={(note) => reject.mutate({ id: selectedId, note }, {
              onSuccess: () => { toast.success('Request rejected'); setSelectedId(null); },
              onError: (e: any) => toast.error(e?.response?.data?.error?.message || 'Failed'),
            })}
            onAutoAssign={() => autoAssign.mutate(selectedId, {
              onSuccess: (d: any) => { toast.success(`${d.assigned} leads assigned`); setSelectedId(null); },
              onError: (e: any) => toast.error(e?.response?.data?.error?.message || 'Failed'),
            })}
            onCancel={() => cancel.mutate(selectedId, {
              onSuccess: () => { toast.success('Request cancelled'); setSelectedId(null); },
              onError: (e: any) => toast.error(e?.response?.data?.error?.message || 'Failed'),
            })}
            isPending={approve.isPending || reject.isPending || autoAssign.isPending}
          />
        )}
      </Modal>
    </div>
  );
}

function RequestRow({ req: r, selected, onSelect }: { req: PartnerRequest; selected: boolean; onSelect: () => void }) {
  const Icon = STATUS_ICON[r.status] || Clock;
  const pct = r.quantity > 0 ? Math.round((r.leads_assigned / r.quantity) * 100) : 0;

  return (
    <tr
      onClick={onSelect}
      className={clsx(
        'cursor-pointer transition',
        selected ? 'bg-brand-50' : 'hover:bg-slate-50'
      )}
    >
      <td className="px-4 py-3">
        <div className="font-medium text-slate-900">{r.partner_name || '—'}</div>
        <div className="text-xs text-slate-500">{r.partner_cp_id || r.partner_email || '—'}</div>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium tabular-nums text-slate-900">{r.quantity} leads</div>
        {r.category && <div className="text-xs text-slate-500">{humanize(r.category)}</div>}
      </td>
      <td className="px-4 py-3">
        <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', STATUS_CHIP[r.status])}>
          <Icon className="h-3 w-3" />
          {humanize(r.status)}
        </span>
      </td>
      <td className="px-4 py-3 text-slate-600">{r.rm_name || <span className="text-slate-400">—</span>}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 rounded-full bg-slate-200">
            <div className="h-1.5 rounded-full bg-brand-500 transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <span className="text-xs tabular-nums text-slate-500">{r.leads_assigned}/{r.quantity}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-slate-500" title={formatISTTooltip(r.created_at)}>{formatISTCompact(r.created_at)}</td>
      <td className="px-4 py-3">
        <ChevronRight className="h-4 w-4 text-slate-400" />
      </td>
    </tr>
  );
}

function DetailPanel({
  id: _id, detail, loading, canManage, onClose: _onClose, onApprove, onReject, onAutoAssign, onCancel, isPending,
}: {
  id: string;
  detail: (PartnerRequest & { timeline?: any[] }) | null;
  loading: boolean;
  canManage: boolean;
  onClose: () => void;
  onApprove: (note?: string) => void;
  onReject: (note?: string) => void;
  onAutoAssign: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const { user } = useAuth();
  const [note, setNote] = useState('');
  const r = detail;

  if (loading || !r) {
    return (
      <div className="w-full">
        <div className="card-padded space-y-4">
          <Skeleton className="h-8" />
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  const Icon = STATUS_ICON[r.status] || Clock;
  const isOwner = user?.id === r.partner_id;
  const pct = r.quantity > 0 ? Math.round((r.leads_assigned / r.quantity) * 100) : 0;

  return (
    <div className="space-y-4 pb-3">
      {/* Header */}
      <div className="card-padded">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{r.partner_name}</h3>
            <p className="text-xs text-slate-500">{r.partner_email} · {r.partner_phone}</p>
            {r.partner_cp_id && <p className="text-xs text-slate-500">CP ID: {r.partner_cp_id}</p>}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-lg font-bold tabular-nums text-slate-900">{r.quantity}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Requested</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-lg font-bold tabular-nums text-slate-900">{r.leads_assigned}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Delivered</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>Fulfillment</span>
            <span className="font-medium">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-200">
            <div className={clsx('h-2 rounded-full transition-all', pct >= 100 ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium', STATUS_CHIP[r.status])}>
            <Icon className="h-3 w-3" /> {humanize(r.status)}
          </span>
          {r.category && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {humanize(r.category)}
            </span>
          )}
          {r.team_name && (
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-700">
              {r.team_name}
            </span>
          )}
        </div>

        {r.note && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Note</div>
            <p className="mt-1 text-sm text-slate-700">{r.note}</p>
          </div>
        )}

        {r.resolve_note && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-amber-600">Resolution Note</div>
            <p className="mt-1 text-sm text-amber-800">{r.resolve_note}</p>
          </div>
        )}

        <div className="mt-3 space-y-1 text-xs text-slate-500">
          <div>Created: {formatISTDateTime(r.created_at)}</div>
          {r.rm_name && <div>Assigned RM: <span className="font-medium text-slate-700">{r.rm_name}</span></div>}
          {r.resolved_by_name && <div>Resolved by: <span className="font-medium text-slate-700">{r.resolved_by_name}</span></div>}
          {r.resolved_at && <div>Resolved: {formatISTDateTime(r.resolved_at)}</div>}
        </div>
      </div>

      {/* Action Buttons */}
      {(canManage && r.status === 'pending') && (
        <div className="card-padded space-y-3">
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Add a note (optional)..."
            rows={2}
            className="input w-full text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { onApprove(note || undefined); setNote(''); }}
              disabled={isPending}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Approve
            </button>
            <button
              onClick={() => { onReject(note || undefined); setNote(''); }}
              disabled={isPending}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 transition disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" /> Reject
            </button>
          </div>
        </div>
      )}

      {(canManage && (r.status === 'approved' || r.status === 'assigned') && r.leads_assigned < r.quantity) && (
        <div className="card-padded">
          <button
            onClick={onAutoAssign}
            disabled={isPending}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
            Auto Assign Leads ({r.quantity - r.leads_assigned} remaining)
          </button>
        </div>
      )}

      {isOwner && r.status === 'pending' && (
        <div className="card-padded">
          <button
            onClick={onCancel}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 transition"
          >
            <X className="h-4 w-4" /> Cancel Request
          </button>
        </div>
      )}

      {/* Timeline */}
      <div className="card-padded">
        <div className="flex items-center gap-2 mb-3">
          <History className="h-4 w-4 text-slate-500" />
          <h4 className="text-sm font-semibold text-slate-900">Activity Timeline</h4>
        </div>

        {(r.timeline?.length ?? 0) === 0 ? (
          <p className="text-xs text-slate-400">No activity yet</p>
        ) : (
          <div className="space-y-0">
            {r.timeline!.map((t: any, i: number) => (
              <div key={t.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={clsx(
                    'h-2.5 w-2.5 rounded-full mt-1.5',
                    t.action === 'created' ? 'bg-blue-500' :
                    t.action === 'approved' ? 'bg-emerald-500' :
                    t.action === 'rejected' ? 'bg-rose-500' :
                    t.action === 'assigned' || t.action === 'manual_assign' ? 'bg-violet-500' :
                    'bg-slate-400'
                  )} />
                  {i < r.timeline!.length - 1 && <div className="w-px flex-1 bg-slate-200 my-1" />}
                </div>
                <div className="pb-4 min-w-0">
                  <div className="text-sm text-slate-700">{t.detail}</div>
                  <div className="mt-0.5 text-[10px] text-slate-400">
                    {t.actor_name && <span className="font-medium text-slate-500">{t.actor_name}</span>}
                    {t.actor_name && ' · '}
                    {fmtRelative(t.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NewRequestForm({ onClose }: { onClose: () => void }) {
  const [qty, setQty] = useState(10);
  const [cat, setCat] = useState('');
  const [note, setNote] = useState('');
  const submit = useSubmitPartnerRequest();

  return (
    <div className="card-padded">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-brand-600" />
          <h3 className="text-sm font-semibold text-slate-900">New Lead Request</h3>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="label">How many leads?</label>
          <input
            type="number" min={1} max={500} value={qty}
            onChange={e => setQty(Math.max(1, Math.min(500, parseInt(e.target.value) || 1)))}
            className="input w-24"
          />
        </div>
        <div>
          <label className="label">Category</label>
          <select value={cat} onChange={e => setCat(e.target.value)} className="input w-36">
            <option value="">Any</option>
            <option value="partner">Partner</option>
            <option value="trader">Trader</option>
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="label">Note (optional)</label>
          <input
            type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder="e.g. Delhi NCR leads preferred"
            className="input w-full"
          />
        </div>
        <button
          onClick={() => {
            submit.mutate(
              { quantity: qty, ...(cat ? { category: cat } : {}), ...(note ? { note } : {}) },
              {
                onSuccess: () => { toast.success('Request submitted!'); onClose(); },
                onError: (e: any) => toast.error(e?.response?.data?.error?.message || 'Request failed'),
              }
            );
          }}
          disabled={submit.isPending}
          className="btn-primary inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Submit Request
        </button>
      </div>
    </div>
  );
}
