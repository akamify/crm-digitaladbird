'use client';
import { useState } from 'react';
import {
  Activity, CheckCircle2, Star, User,
  HandMetal, Inbox, Loader2, XCircle, Package, Trophy,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { LeadCostCard } from '@/components/dashboard/LeadCostCard';
import { PageLoader } from '@/components/ui/Modal';
import { type LeadRequest, useLeadRequestStats, useSubmitLeadRequest, useCancelLeadRequest } from '@/hooks/useLeadRequests';
import { useMyRank, RANK_LABELS, BADGE_MAP } from '@/hooks/useRankings';
import { MovementIndicator, ScoreBadge } from '@/components/rankings/RankBadge';
import { useAuth } from '@/lib/auth';
import { clsx } from '@/lib/format';
import { CounselorDashboardAnalytics } from '@/components/dashboard/CounselorDashboardAnalytics';

export default function MemberDashboardPage() {
  return (
    <AppShell
      title="My Dashboard"
      subtitle="Your lead queues, remarks and work summary"
      roles={['member', 'partner']}
    >
      <MemberDashboardInner />
    </AppShell>
  );
}

function MemberDashboardInner() {
  const { user } = useAuth();
  const [reqQty, setReqQty] = useState(10);
  const [reqCat, setReqCat] = useState<string>('');
  const [hiddenRequestIds, setHiddenRequestIds] = useState<string[]>([]);

  const lrStats   = useLeadRequestStats();
  const submitReq = useSubmitLeadRequest();
  const cancelReq = useCancelLeadRequest();

  if (!user) return <PageLoader />;

  const memberTypeLabel = user.memberType === 'veteran' ? 'Veteran' : 'Fresher';
  const memberTypeBadge = user.memberType === 'veteran' ? 'chip-amber' : 'chip-blue';
  const stats = lrStats.data;
  const activeRequest = stats?.my_pending_request && !hiddenRequestIds.includes(stats.my_pending_request.id)
    ? stats.my_pending_request
    : null;

  return (
    <div className="space-y-6">
      <LeadCostCard />
      {/* Member identity badge */}
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <User className="h-4 w-4 text-emerald-600" />
        <span className="text-sm font-medium text-emerald-800">
          Welcome, <strong>{user.name}</strong>
        </span>
        <span className={memberTypeBadge}>{memberTypeLabel}</span>
        {user.memberType === 'veteran' && <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-400" />}
        <span className="ml-auto text-xs text-emerald-700">Showing only your assigned leads</span>
      </div>

      {/* My Ranking */}
      <MyRankingBanner />

      {/* Lead Request Section */}
      <div className="card-padded">
        <div className="flex items-center gap-2 mb-4">
          <HandMetal className="h-4 w-4 text-brand-600" />
          <h2 className="text-sm font-semibold text-slate-900">Request Leads</h2>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <Inbox className="h-4 w-4 text-amber-600" />
            <div>
              <div className="text-lg font-bold tabular-nums text-slate-900">{stats?.available_leads ?? '—'}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Available</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <Package className="h-4 w-4 text-brand-600" />
            <div>
              <div className="text-lg font-bold tabular-nums text-slate-900">{stats?.my_leads ?? '—'}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">My Leads</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <div>
              <div className="text-lg font-bold tabular-nums text-emerald-700">{stats?.my_assigned_today ?? 'â€”'}</div>
              <div className="text-[10px] uppercase tracking-wide text-emerald-700">Assigned Today</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <Activity className="h-4 w-4 text-emerald-600" />
            <div>
              <div className={clsx('text-lg font-bold', stats?.distribution_enabled ? 'text-emerald-600' : 'text-amber-600')}>
                {stats?.distribution_enabled ? 'Active' : 'Paused'}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Auto Dist.</div>
            </div>
          </div>
        </div>

        {/* Request form or request status */}
        {activeRequest ? (
          <RequestStatusBanner
            request={activeRequest}
            cancelling={cancelReq.isPending}
            onCancel={() => cancelReq.mutate(activeRequest.id, {
              onSuccess: () => toast.success('Request cancelled'),
              onError: () => toast.error('Failed to cancel'),
            })}
            onDismiss={() => setHiddenRequestIds(ids => [...new Set([...ids, activeRequest.id])])}
          />
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Quantity</label>
              <input
                type="number" min={1} max={500} value={reqQty}
                onChange={e => setReqQty(Math.max(1, Math.min(500, parseInt(e.target.value) || 1)))}
                className="input w-20"
              />
            </div>
            <div>
              <label className="label">Category</label>
              <select
                value={reqCat} onChange={e => setReqCat(e.target.value)}
                className="input w-32"
              >
                <option value="">Both Leads</option>
                <option value="partner">Partner Leads</option>
                <option value="trader">Trader Leads</option>
              </select>
            </div>
            <button
              onClick={() => {
                submitReq.mutate(
                  { quantity: reqQty, ...(reqCat ? { category: reqCat } : {}) },
                  {
                    onSuccess: (data: any) => toast.success(data.leads_assigned > 0
                      ? `${data.leads_assigned} lead(s) assigned!`
                      : 'Request queued — leads will be assigned during active hours'),
                    onError: (err: any) => toast.error(err?.response?.data?.error?.message || 'Request failed'),
                  },
                );
              }}
              disabled={submitReq.isPending}
              className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
              title="Request leads. If your queue is empty, the request becomes pending and auto-fulfills when leads arrive."
            >
              {submitReq.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <HandMetal className="h-4 w-4" />
              )}
              Request Leads
            </button>
          </div>
        )}
      </div>

      <CounselorDashboardAnalytics />

    </div>
  );
}

function RequestStatusBanner({
  request,
  cancelling,
  onCancel,
  onDismiss,
}: {
  request: LeadRequest;
  cancelling: boolean;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const requested = Number(request.requested_quantity ?? request.quantity ?? 0);
  const approved = Number(request.approved_quantity ?? request.quantity ?? requested);
  const fulfilled = Number(request.fulfilled_quantity ?? request.leads_assigned ?? 0);
  const remaining = Math.max(0, approved - fulfilled);
  const progress = approved > 0 ? Math.min(100, Math.round((fulfilled / approved) * 100)) : 0;
  const status = request.status || 'pending';
  const isPending = status === 'pending';
  const isRejected = status === 'rejected' || status === 'cancelled';
  const tone = isRejected
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : isPending
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-emerald-200 bg-emerald-50 text-emerald-800';
  const icon = isRejected ? <XCircle className="h-4 w-4" /> : isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />;
  const title = isRejected
    ? `Your lead request was ${status}.`
    : isPending
      ? `Request pending - ${requested} lead${requested === 1 ? '' : 's'}`
      : `Your request has been approved.`;
  const detail = isRejected
    ? request.resolve_note || 'You can submit a new request when eligible.'
    : isPending
      ? 'Admin approval is pending.'
      : remaining > 0
        ? `${fulfilled}/${approved} leads assigned. ${remaining} remaining.`
        : `${fulfilled}/${approved} leads assigned.`;

  return (
    <div className={clsx('rounded-lg border px-4 py-3', tone)}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-0.5 text-xs opacity-90">
            {detail}
            {request.category ? ` Category: ${request.category}.` : ''}
          </div>
          {!isRejected && !isPending && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/70">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-[11px] font-medium">{progress}%</span>
            </div>
          )}
        </div>
        {isPending ? (
          <button
            onClick={onCancel}
            disabled={cancelling}
            className="rounded-md p-1.5 transition hover:bg-white/50 disabled:opacity-50"
            title="Cancel request"
          >
            <XCircle className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={onDismiss}
            className="rounded-md p-1.5 transition hover:bg-white/50"
            title="Close"
          >
            <XCircle className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function MyRankingBanner() {
  const myRank = useMyRank();
  const d = myRank.data;
  if (!d?.ranks?.length) return null;

  const overall = d.ranks.find(r => r.scope === 'overall');
  const member = d.ranks.find(r => r.scope === 'member') || d.ranks.find(r => r.scope === 'partner');
  const show = overall || member;
  if (!show) return null;

  const label = RANK_LABELS[(show.rank_position || 99) - 1];

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className={clsx(
          'grid h-10 w-10 place-items-center rounded-full text-sm font-bold text-white shadow-sm',
          show.rank_position <= 3 ? 'bg-amber-500' : 'bg-slate-500',
        )}>
          #{show.rank_position}
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <Trophy className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-semibold text-slate-900">
              {label ? `${label.emoji} ${label.label}` : `Rank #${show.rank_position}`}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <ScoreBadge score={show.score} />
            <MovementIndicator movement={show.movement} prev={show.prev_position} current={show.rank_position} />
          </div>
        </div>
      </div>
      {d.badges.length > 0 && (
        <div className="ml-auto flex items-center gap-1">
          {d.badges.map(b => (
            <span key={b.badge_type} className={clsx('inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium', BADGE_MAP[b.badge_type]?.color || 'bg-slate-100 text-slate-600')}>
              {BADGE_MAP[b.badge_type]?.emoji} ×{b.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
