'use client';
import Link from 'next/link';
import { useState } from 'react';
import {
  Activity, CheckCircle2, Clock, PhoneCall, ArrowRight, Star, User,
  HandMetal, Inbox, Loader2, XCircle, Package, Trophy,
  MessageSquare, BarChart3, Target,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { Skeleton, EmptyState, PageLoader, StatusChip } from '@/components/ui/Modal';
import { useSummary } from '@/hooks/useReports';
import { useLeadList } from '@/hooks/useLeads';
import { useLeadRequestStats, useSubmitLeadRequest, useCancelLeadRequest } from '@/hooks/useLeadRequests';
import { useMyRank, RANK_LABELS, BADGE_MAP } from '@/hooks/useRankings';
import { useWorkflowStats } from '@/hooks/useWorkflow';
import { MovementIndicator, ScoreBadge } from '@/components/rankings/RankBadge';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtRelative, isOverdue, isDueToday, clsx } from '@/lib/format';
import type { LeadCategory } from '@/types';

export default function MemberDashboardPage() {
  return (
    <AppShell
      title="My Dashboard"
      subtitle="Your assigned leads & daily targets"
      roles={['member', 'partner']}
    >
      <MemberDashboardInner />
    </AppShell>
  );
}

function MemberDashboardInner() {
  const { user } = useAuth();
  const [category, setCategory] = useState<LeadCategory | 'all'>('all');
  const [reqQty, setReqQty] = useState(10);
  const [reqCat, setReqCat] = useState<string>('');

  const summary   = useSummary();
  const myLeads   = useLeadList({ page: 1, page_size: 10, ...(category !== 'all' ? { category } : {}) });
  const followups = useLeadList({ followup: 'today', page: 1, page_size: 6 });
  const lrStats   = useLeadRequestStats();
  const submitReq = useSubmitLeadRequest();
  const cancelReq = useCancelLeadRequest();

  if (!user) return <PageLoader />;

  const k = summary.data;
  const memberTypeLabel = user.memberType === 'veteran' ? 'Veteran' : 'Fresher';
  const memberTypeBadge = user.memberType === 'veteran' ? 'chip-amber' : 'chip-blue';
  const stats = lrStats.data;
  const hasPending = !!stats?.my_pending_request;

  return (
    <div className="space-y-6">
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
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <Clock className="h-4 w-4 text-amber-600" />
            <div>
              <div className="text-lg font-bold tabular-nums text-slate-900">{stats?.my_pending ?? '—'}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Pending Work</div>
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

        {/* Request form or pending status */}
        {hasPending ? (
          <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 text-amber-600 animate-spin" />
              <div>
                <span className="text-sm font-medium text-amber-800">
                  Request pending — {stats.my_pending_request!.quantity} lead{stats.my_pending_request!.quantity > 1 ? 's' : ''}
                  {stats.my_pending_request!.category && ` (${stats.my_pending_request!.category})`}
                </span>
                <div className="text-xs text-amber-600">Auto-assigning from queue — leads will appear shortly</div>
              </div>
            </div>
            <button
              onClick={() => cancelReq.mutate(stats.my_pending_request!.id, {
                onSuccess: () => toast.success('Request cancelled'),
                onError: () => toast.error('Failed to cancel'),
              })}
              disabled={cancelReq.isPending}
              className="rounded-md p-1.5 text-amber-600 hover:bg-amber-100 transition"
              title="Cancel request"
            >
              <XCircle className="h-4 w-4" />
            </button>
          </div>
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
              disabled={submitReq.isPending || (stats?.available_leads ?? 0) === 0}
              className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {summary.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <KpiCard label="My leads"       value={Number(k?.total_leads ?? 0).toLocaleString()} delta={`${k?.today_leads ?? 0} assigned today`} accent="pink"  icon={<PhoneCall className="h-5 w-5" />} />
            <KpiCard label="Pending calls"  value={Number(k?.pending ?? 0).toLocaleString()} delta="Not yet called"                            accent="amber" icon={<Clock className="h-5 w-5" />} />
            <KpiCard label="Converted"      value={Number(k?.converted ?? 0).toLocaleString()} delta="Closed deals"                           accent="green" icon={<CheckCircle2 className="h-5 w-5" />} />
            <KpiCard label="Follow-ups"     value={Number(k?.followups ?? 0).toLocaleString()} delta="Due soon"                               accent="slate" icon={<Activity className="h-5 w-5" />} />
          </>
        )}
      </div>

      {/* Workflow Progress — 4 Big Cards */}
      <WorkflowProgressCards />

      {/* Lead category filter */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Lead type:</span>
        {(['all', 'partner', 'trader'] as const).map(c => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              category === c
                ? c === 'partner' ? 'bg-violet-600 text-white' : c === 'trader' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {c === 'all' ? 'All' : c === 'partner' ? 'Partners' : 'Traders'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* My leads */}
        <div className="card-padded lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              My leads {category !== 'all' && <span className="ml-1 font-normal text-slate-500">— {category === 'partner' ? 'Partners' : 'Traders'}</span>}
            </h2>
            <Link href="/leads" className="text-xs text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
              All leads <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {myLeads.isLoading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : !myLeads.data?.rows.length ? (
            <EmptyState title="No leads" description={`No ${category !== 'all' ? category + ' ' : ''}leads assigned yet.`} icon={<PhoneCall className="h-6 w-6" />} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {myLeads.data.rows.map(l => (
                <li key={l.id}>
                  <Link href={`/leads/${l.id}`} className="flex items-center justify-between py-3 hover:bg-slate-50 rounded-lg px-2 -mx-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-900">{l.full_name || 'Unnamed lead'}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          (l as any).category === 'partner' ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700'
                        }`}>
                          {(l as any).category || 'trader'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">{l.phone || '—'} · {l.source || 'manual'}</div>
                    </div>
                    <div className="shrink-0 ml-3">
                      <StatusChip status={l.call_status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Today's followups */}
        <div className="card-padded">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Today&apos;s followups</h2>
            <Link href="/leads?followup=today" className="text-xs text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {followups.isLoading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : !followups.data?.rows.length ? (
            <EmptyState title="All caught up!" description="No followups scheduled for today." icon={<CheckCircle2 className="h-6 w-6" />} />
          ) : (
            <ul className="space-y-2">
              {followups.data.rows.map(l => (
                <li key={l.id}>
                  <Link href={`/leads/${l.id}`} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 hover:bg-slate-50">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">{l.full_name || 'Unnamed'}</div>
                      <div className="truncate text-xs text-slate-500">{l.phone || '—'}</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-xs ${isOverdue(l.next_followup_at) ? 'text-rose-600 font-medium' : isDueToday(l.next_followup_at) ? 'text-amber-600' : 'text-slate-500'}`}>
                        {fmtRelative(l.next_followup_at)}
                      </div>
                      <div className="text-[10px] text-slate-400">{fmtDate(l.next_followup_at, 'h:mm a')}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

const WF_CARDS = [
  { key: 'step1_pending', label: 'Remark', desc: 'Pending remarks', icon: MessageSquare, gradient: 'from-violet-500 to-purple-600', light: 'border-violet-200 bg-violet-50', text: 'text-violet-700' },
  { key: 'step2_pending', label: 'Lead Level', desc: 'Pending levels', icon: BarChart3, gradient: 'from-blue-500 to-indigo-600', light: 'border-blue-200 bg-blue-50', text: 'text-blue-700' },
  { key: 'step3_pending', label: 'Follow-up', desc: 'Pending follow-ups', icon: Target, gradient: 'from-emerald-500 to-teal-600', light: 'border-emerald-200 bg-emerald-50', text: 'text-emerald-700' },
  { key: 'step4_pending', label: 'Conversion', desc: 'Pending conversions', icon: Trophy, gradient: 'from-amber-500 to-orange-600', light: 'border-amber-200 bg-amber-50', text: 'text-amber-700' },
] as const;

function WorkflowProgressCards() {
  const { data: stats, isLoading } = useWorkflowStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }

  if (!stats) return null;

  const total = stats.total_assigned || 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 shadow-sm">
            <Activity className="h-3.5 w-3.5 text-white" />
          </div>
          <h2 className="text-sm font-semibold text-slate-900">Workflow Progress</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{stats.completed}/{stats.total_assigned} completed</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
            {stats.today_actions} today
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {WF_CARDS.map(card => {
          const Icon = card.icon;
          const pending = (stats as any)[card.key] ?? 0;
          const done = card.key === 'step1_pending'
            ? total - pending
            : card.key === 'step4_pending'
              ? stats.completed
              : total - pending;
          const pct = Math.round((done / total) * 100);

          return (
            <Link
              key={card.key}
              href="/leads"
              className={clsx(
                'group relative overflow-hidden rounded-2xl border-2 p-4 transition-all duration-200 hover:shadow-lg hover:scale-[1.02]',
                card.light
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <div className={clsx(
                  'flex h-10 w-10 items-center justify-center rounded-xl shadow-lg text-white bg-gradient-to-br',
                  card.gradient
                )}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className={clsx('text-2xl font-extrabold tabular-nums', card.text)}>
                  {pending}
                </span>
              </div>
              <p className={clsx('text-xs font-bold', card.text)}>{card.label}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{card.desc}</p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/60">
                <div
                  className={clsx('h-full rounded-full bg-gradient-to-r transition-all duration-500', card.gradient)}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1 text-[9px] font-semibold text-slate-400">{pct}% done</p>
            </Link>
          );
        })}
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
