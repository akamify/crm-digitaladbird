'use client';
import { memo, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity, CheckCircle2, Clock, TrendingDown,
  Briefcase, ArrowRight, Users, Shield, AlertTriangle, Play, Pause,
  Inbox, UserX, HandMetal, Check, X, Trophy, Crown, Star, Award,
  Megaphone, Globe, GitBranch, ScrollText, FileSpreadsheet, PieChart,
  BarChart3, Target, Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  CartesianGrid,
} from 'recharts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { connectSocket } from '@/lib/socket';
import { format } from 'date-fns';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { Modal, Skeleton, EmptyState, PageLoader } from '@/components/ui/Modal';
import { useSummary, useDaily, useByUser } from '@/hooks/useReports';
import { useLeadList } from '@/hooks/useLeads';
import { useLeadRequestStats, usePendingLeadRequests, useApproveLeadRequest, useRejectLeadRequest, type LeadRequest } from '@/hooks/useLeadRequests';
import { useRankings, RANK_LABELS, type RankedEntry } from '@/hooks/useRankings';
import { useCampaignsEnriched, useFreshLeads } from '@/hooks/useAdminEnterprise';
import { MovementIndicator } from '@/components/rankings/RankBadge';
import { useAuth } from '@/lib/auth';
import { apiGet } from '@/lib/api';
import { AdminToolsPanel } from '@/components/dashboard/AdminToolsPanel';
import { fmtDate, fmtRelative, humanize, isOverdue, isDueToday, clsx } from '@/lib/format';
import type { DailyPoint, UserPerformance } from '@/types';

const dayFmt = (d: string) => { try { return format(new Date(d), 'd MMM'); } catch { return d; } };

export default function AdminDashboardPage() {
  return (
    <AppShell
      title="Super Admin Dashboard"
      subtitle="Full system overview — all teams, all leads"
      roles={['super_admin', 'admin']}
    >
      <AdminDashboardInner />
    </AppShell>
  );
}

interface DistStats {
  queued_leads: string;
  total_pending: string;
  today_distributed: string;
  today_received: string;
  blocked_members: string;
  pending_approvals: string;
  distribution_enabled: string;
}

const ADMIN_MODULES = [
  { href: '/dashboard/admin/fresh',         label: 'Fresh Leads',     Icon: Star,            color: 'text-amber-600',   bg: 'bg-amber-50',    border: 'border-amber-200',    desc: 'Today / Trader / Partner' },
  { href: '/dashboard/admin/campaigns',     label: 'Campaigns',      Icon: Megaphone,       color: 'text-rose-600',    bg: 'bg-rose-50',    border: 'border-rose-200',    desc: 'Create, edit, pause' },
  { href: '/dashboard/admin/users',         label: 'User Management', Icon: Users,           color: 'text-violet-600',  bg: 'bg-violet-50',  border: 'border-violet-200',  desc: 'Block, edit, caps' },
  { href: '/dashboard/admin/leads-manager', label: 'Lead Management', Icon: Briefcase,       color: 'text-brand-600',   bg: 'bg-brand-50',   border: 'border-brand-200',   desc: 'Bulk actions, assign' },
  { href: '/dashboard/admin/sources',       label: 'Lead Sources',    Icon: Globe,           color: 'text-cyan-600',    bg: 'bg-cyan-50',    border: 'border-cyan-200',    desc: 'Source monitoring' },
  { href: '/dashboard/admin/distribution',  label: 'Distribution',    Icon: GitBranch,       color: 'text-amber-600',   bg: 'bg-amber-50',   border: 'border-amber-200',   desc: 'Auto-assign rules' },
  { href: '/dashboard/admin/analytics',     label: 'Analytics',       Icon: PieChart,        color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', desc: 'Deep insights' },
  { href: '/dashboard/admin/sheets',        label: 'Google Sheets',   Icon: FileSpreadsheet, color: 'text-green-600',   bg: 'bg-green-50',   border: 'border-green-200',   desc: 'Sync & import' },
  { href: '/dashboard/admin/activity',      label: 'Activity Logs',   Icon: ScrollText,      color: 'text-slate-600',   bg: 'bg-slate-50',   border: 'border-slate-200',   desc: 'Full audit trail' },
  { href: '/reports',                       label: 'Reports',         Icon: BarChart3,       color: 'text-indigo-600',  bg: 'bg-indigo-50',  border: 'border-indigo-200',  desc: 'Team performance' },
  { href: '/leaderboard',                   label: 'Leaderboard',     Icon: Trophy,          color: 'text-orange-600',  bg: 'bg-orange-50',  border: 'border-orange-200',  desc: 'Rankings & badges' },
  { href: '/partner-requests',              label: 'Partner Requests', Icon: HandMetal,      color: 'text-pink-600',    bg: 'bg-pink-50',    border: 'border-pink-200',    desc: 'Approve & assign' },
  { href: '/settings',                      label: 'Settings',        Icon: Target,          color: 'text-gray-600',    bg: 'bg-gray-50',    border: 'border-gray-200',    desc: 'System config' },
];

function AdminDashboardInner() {
  const { user } = useAuth();
  const summary  = useSummary();
  const daily    = useDaily(14);
  const byUser   = useByUser();
  const followups = useLeadList({ followup: 'today', page: 1, page_size: 8 });
  const distStats = useQuery({
    queryKey: ['dist-stats'],
    queryFn: () => apiGet<DistStats>('/distribution/stats'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const lrStats   = useLeadRequestStats();
  const pendingReqs = usePendingLeadRequests();
  const approveReq  = useApproveLeadRequest();
  const rejectReq   = useRejectLeadRequest();
  const freshToday  = useFreshLeads('today', 1);  // we only need the .counts here, not rows
  const qc          = useQueryClient();
  const [selectedRequest, setSelectedRequest] = useState<LeadRequest | null>(null);
  const [approvedQuantity, setApprovedQuantity] = useState(1);

  // ── Live: whenever a new lead lands or a request lifecycle event fires,
  //    invalidate the cached queries so the headline counters & lists
  //    repaint immediately — no manual refresh needed.
  useEffect(() => {
    let cancelled = false;
    const off: Array<() => void> = [];
    connectSocket().then((s) => {
      if (cancelled) return;
      const refresh = () => {
        qc.invalidateQueries({ queryKey: ['reports', 'summary'] });
        qc.invalidateQueries({ queryKey: ['reports', 'daily'] });
        qc.invalidateQueries({ queryKey: ['dist-stats'] });
        qc.invalidateQueries({ queryKey: ['admin', 'fresh-leads'] });
        qc.invalidateQueries({ queryKey: ['admin', 'campaigns-enriched'] });
        qc.invalidateQueries({ queryKey: ['leads'] });
      };
      const onNewLead = () => refresh();
      const onReqEvent = () => {
        qc.invalidateQueries({ queryKey: ['lead-request-stats'] });
        qc.invalidateQueries({ queryKey: ['lead-requests', 'pending'] });
      };
      s.on('lead:new', onNewLead);
      s.on('lead-request:created', onReqEvent);
      s.on('lead-request:approved', onReqEvent);
      s.on('lead-request:rejected', onReqEvent);
      s.on('lead-request:fulfilled', onReqEvent);
      off.push(() => s.off('lead:new', onNewLead));
      off.push(() => s.off('lead-request:created', onReqEvent));
      off.push(() => s.off('lead-request:approved', onReqEvent));
      off.push(() => s.off('lead-request:rejected', onReqEvent));
      off.push(() => s.off('lead-request:fulfilled', onReqEvent));
    }).catch(() => { /* socket not available — fall back to poll */ });
    return () => { cancelled = true; off.forEach(fn => fn()); };
  }, [qc]);

  if (!user) return <PageLoader />;

  const k = summary.data;
  const totalLeads = Number(k?.total_leads ?? 0);
  const conv       = Number(k?.converted ?? 0);
  const convRate   = totalLeads > 0 ? Math.round((conv / totalLeads) * 1000) / 10 : 0;
  const ds = distStats.data;
  const lrs = lrStats.data;
  const availableForApproval = Number(lrs?.available_leads ?? 0);
  const approvalMax = selectedRequest
    ? Math.max(1, Math.min(selectedRequest.quantity, availableForApproval || selectedRequest.quantity))
    : 1;

  return (
    <div className="space-y-6">
      {/* Admin badge */}
      <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
        <Shield className="h-4 w-4 text-violet-600" />
        <span className="text-sm font-medium text-violet-800">
          Signed in as <strong>Super Admin</strong> — you can see all data across the entire organisation.
        </span>
      </div>

      {/* ═══ Enterprise Control Center Grid ═══ */}
      <div className="card-padded">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="h-4 w-4 text-brand-600" />
          <h2 className="text-sm font-semibold text-slate-900">Enterprise Control Center</h2>
          <span className="text-xs text-slate-500 ml-1">— Click any module to manage</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {ADMIN_MODULES.map(({ href, label, Icon, color, bg, border, desc }) => (
            <Link key={href} href={href}
              className={clsx('group flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition hover:shadow-md hover:scale-[1.02] active:scale-[0.98]', border, bg)}>
              <Icon className={clsx('h-6 w-6', color)} />
              <span className="text-xs font-semibold text-slate-800">{label}</span>
              <span className="text-[10px] text-slate-500 leading-tight">{desc}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Distribution Status Banner — each tile drills into its own filtered view */}
      {ds && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MiniStat icon={<Inbox className="h-4 w-4" />} label="Queued"            value={ds.queued_leads}      color="amber" href="/dashboard/admin/leads-manager?assigned=false" />
          <MiniStat icon={<Clock className="h-4 w-4" />} label="Pending Work"      value={ds.total_pending}     color="rose"  href="/dashboard/admin/leads-manager?pending=true" />
          <MiniStat icon={<ArrowRight className="h-4 w-4" />} label="Today Distributed" value={ds.today_distributed} color="green" href="/dashboard/admin/fresh?scope=today" />
          <MiniStat icon={<Briefcase className="h-4 w-4" />} label="Today Received"     value={ds.today_received}    color="blue"  href="/dashboard/admin/fresh?scope=today" />
          <MiniStat icon={<UserX className="h-4 w-4" />} label="Blocked Members"   value={ds.blocked_members}   color={Number(ds.blocked_members) > 0 ? 'red' : 'slate'} href="/dashboard/admin/users?status=blocked" />
          <MiniStat
            icon={ds.distribution_enabled === 'true' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            label="Distribution"
            value={ds.distribution_enabled === 'true' ? 'Active' : 'Paused'}
            color={ds.distribution_enabled === 'true' ? 'green' : 'amber'}
            href="/dashboard/admin/distribution"
          />
        </div>
      )}

      {/* Pending approvals alert */}
      {ds && Number(ds.pending_approvals) > 0 && (
        <Link href="/settings" className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100 transition">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <span className="text-sm font-medium text-amber-800">
            {ds.pending_approvals} member(s) blocked and awaiting approval — click to manage
          </span>
        </Link>
      )}

      {/* Lead Requests Queue */}
      {(lrs?.pending_requests ?? 0) > 0 && (
        <div className="card-padded">
          <div className="flex items-center gap-2 mb-3">
            <HandMetal className="h-4 w-4 text-brand-600" />
            <h2 className="text-sm font-semibold text-slate-900">
              Lead Requests
              <span className="ml-2 inline-flex items-center justify-center rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">
                {lrs!.pending_requests}
              </span>
            </h2>
            <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
              <Inbox className="h-3.5 w-3.5" />
              <span>{lrs?.available_leads ?? 0} leads in queue</span>
            </div>
          </div>
          {pendingReqs.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : !pendingReqs.data?.length ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-3 text-center text-xs text-slate-500">
              Counter shows pending requests but none returned — they may have just been resolved.
            </div>
          ) : (
            <div className="space-y-2">
              {pendingReqs.data.map(r => (
                <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">{r.full_name}</span>
                      {r.team_name && <span className="text-xs text-slate-500">{r.team_name}</span>}
                      {r.member_type && <span className="chip-slate">{humanize(r.member_type)}</span>}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Wants <strong>{r.quantity}</strong> lead{r.quantity > 1 ? 's' : ''}
                      {r.category && <span> · <span className="chip-blue">{humanize(r.category)}</span></span>}
                      {r.note && <span> · &quot;{r.note}&quot;</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => {
                        setSelectedRequest(r);
                        setApprovedQuantity(Math.max(1, Math.min(r.quantity, availableForApproval || r.quantity)));
                      }}
                      disabled={approveReq.isPending}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition"
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => rejectReq.mutate({ id: r.id }, {
                        onSuccess: () => toast.success('Rejected'),
                        onError: () => toast.error('Failed'),
                      })}
                      disabled={rejectReq.isPending}
                      className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 transition"
                    >
                      <X className="h-3.5 w-3.5" /> Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Modal
        open={!!selectedRequest}
        onClose={() => setSelectedRequest(null)}
        title="Approve Lead Request"
        size="md"
      >
        {selectedRequest ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">{selectedRequest.full_name || 'Member Request'}</div>
              <div className="mt-1 text-xs text-slate-500">
                Requested {selectedRequest.quantity} lead{selectedRequest.quantity > 1 ? 's' : ''}
                {selectedRequest.category ? ` • ${humanize(selectedRequest.category)}` : ''}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Requested Quantity</div>
                  <div className="mt-1 font-semibold text-slate-900">{selectedRequest.quantity}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Available Leads</div>
                  <div className="mt-1 font-semibold text-slate-900">{availableForApproval}</div>
                </div>
              </div>
            </div>

            {availableForApproval <= 0 ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                No available leads are currently available for this request.
              </div>
            ) : null}

            {availableForApproval > 0 && availableForApproval < selectedRequest.quantity ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Only {availableForApproval} leads are currently available. You can approve a partial quantity or keep this request pending.
              </div>
            ) : null}

            <label className="block">
              <span className="text-xs font-medium text-slate-500">Approved Quantity</span>
              <input
                type="number"
                min={1}
                max={approvalMax}
                value={approvedQuantity}
                onChange={(e) => setApprovedQuantity(Math.max(1, Math.min(approvalMax, Number(e.target.value) || 1)))}
                className="input mt-1 h-10"
                disabled={availableForApproval <= 0}
              />
            </label>

            <div className="flex justify-end gap-2">
              <button onClick={() => setSelectedRequest(null)} className="btn-ghost rounded-lg px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!selectedRequest) return;
                  approveReq.mutate({ id: selectedRequest.id, approvedQuantity }, {
                    onSuccess: (data: any) => {
                      toast.success(`Approved. ${Number(data?.data?.assigned_now ?? data?.data?.leads_assigned ?? 0)} lead(s) assigned now.`);
                      setSelectedRequest(null);
                    },
                    onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Approval failed'),
                  });
                }}
                disabled={approveReq.isPending || availableForApproval <= 0}
                className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
              >
                {approveReq.isPending ? <Check className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                Approve Request
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Admin Tools Panel */}
      <AdminToolsPanel />

      {/* KPIs — clickable drill-down. The "today" trio (Fresh / Partner / Trader)
          links straight to the Fresh Leads page scoped to each tab. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
        {summary.isLoading ? (
          Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <Link href="/dashboard/admin/leads-manager">
              <KpiCard label="Total leads" value={totalLeads.toLocaleString()} delta={`${k?.today_leads ?? 0} today`} accent="pink" icon={<Briefcase className="h-5 w-5" />} />
            </Link>
            <Link href="/dashboard/admin/fresh?scope=today">
              <KpiCard
                label="New Today"
                value={Number(freshToday.data?.counts?.today_total ?? k?.today_leads ?? 0).toLocaleString()}
                delta="Live · click to open" trend="up" accent="amber" icon={<Star className="h-5 w-5" />}
              />
            </Link>
            <Link href="/dashboard/admin/fresh?scope=partner">
              <KpiCard
                label="Partner Today"
                value={Number(freshToday.data?.counts?.today_partner ?? 0).toLocaleString()}
                delta="Today's partner leads" accent="pink" icon={<HandMetal className="h-5 w-5" />}
              />
            </Link>
            <Link href="/dashboard/admin/fresh?scope=trader">
              <KpiCard
                label="Trader Today"
                value={Number(freshToday.data?.counts?.today_trader ?? 0).toLocaleString()}
                delta="Today's trader leads" accent="blue" icon={<Briefcase className="h-5 w-5" />}
              />
            </Link>
            <Link href="/dashboard/admin/leads-manager?pending=true">
              <KpiCard label="Pending" value={Number(k?.pending ?? 0).toLocaleString()} delta="Awaiting first call" accent="amber" icon={<Clock className="h-5 w-5" />} />
            </Link>
            <Link href="/dashboard/admin/analytics">
              <KpiCard label="Conversions" value={conv.toLocaleString()} delta={`${convRate}% conv rate`} trend="up" accent="green" icon={<CheckCircle2 className="h-5 w-5" />} />
            </Link>
            <Link href="/dashboard/admin/leads-manager?stage=lost">
              <KpiCard label="Lost / Not interested" value={Number(k?.lost ?? 0).toLocaleString()} accent="slate" icon={<TrendingDown className="h-5 w-5" />} />
            </Link>
          </>
        )}
      </div>

      {/* Chart + followups */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card-padded lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Leads — last 14 days</h2>
              <p className="text-xs text-slate-500">Daily volume vs conversions</p>
            </div>
            <Link href="/dashboard/admin/analytics" className="text-xs text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
              Full analytics <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="h-72">
            {daily.isLoading ? (
              <Skeleton className="h-full" />
            ) : !daily.data?.length || daily.data.every(d => Number(d.leads) === 0 && Number(d.conversions) === 0) ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  title="No lead activity yet"
                  description="The 14-day chart will populate as leads come in."
                  icon={<BarChart3 className="h-6 w-6" />}
                />
              </div>
            ) : (
              <DailyChart data={daily.data} />
            )}
          </div>
        </div>

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
            <EmptyState title="Nothing scheduled" description="No followups due today." icon={<Activity className="h-6 w-6" />} />
          ) : (
            <ul className="space-y-2">
              {followups.data.rows.map(l => (
                <li key={l.id}>
                  <Link href={`/leads/${l.id}`} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 hover:bg-slate-50">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">{l.full_name || 'Unnamed lead'}</div>
                      <div className="truncate text-xs text-slate-500">{l.phone || '—'} · {l.source || 'manual'}</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-xs ${isOverdue(l.next_followup_at) ? 'text-rose-600' : isDueToday(l.next_followup_at) ? 'text-amber-600' : 'text-slate-500'}`}>
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

      {/* Leaderboard Quick View */}
      <AdminLeaderboardWidget />

      {/* Campaign → Lead Tracking — which campaigns are bringing in leads */}
      <CampaignLeadsTracker />

      {/* All-team performance */}
      <div className="card-padded">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">All teams — performance breakdown</h2>
            <p className="text-xs text-slate-500">Every RM and member across the organisation</p>
          </div>
          <Link href="/dashboard/admin/users" className="text-xs text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
            Manage users <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {byUser.isLoading ? (
          <Skeleton className="h-64" />
        ) : !byUser.data?.length ? (
          <EmptyState title="No team data yet" description="Stats appear once leads are assigned." icon={<Users className="h-6 w-6" />} />
        ) : (
          <TeamTable data={byUser.data} />
        )}
      </div>
    </div>
  );
}

const DailyChart = memo(function DailyChart({ data }: { data: DailyPoint[] }) {
  const series = data.map(d => ({ day: dayFmt(d.day), leads: Number(d.leads), conversions: Number(d.conversions) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={series} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="gLeads" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gConv" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
        <Area type="monotone" dataKey="leads"       stroke="#2563eb" strokeWidth={2} fill="url(#gLeads)" />
        <Area type="monotone" dataKey="conversions" stroke="#10b981" strokeWidth={2} fill="url(#gConv)" />
      </AreaChart>
    </ResponsiveContainer>
  );
});

const COLOR_MAP: Record<string, string> = {
  pink: 'bg-blue-50 text-blue-700 border-blue-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blue: 'bg-sky-50 text-sky-700 border-sky-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  slate: 'bg-slate-50 text-slate-600 border-slate-200',
};

const MiniStat = memo(function MiniStat({ icon, label, value, color, href }: { icon: React.ReactNode; label: string; value: string; color: string; href?: string }) {
  const cls = COLOR_MAP[color] || COLOR_MAP.slate;
  const inner = (
    <div className={clsx(
      `flex items-center gap-2.5 rounded-lg border px-3 py-2.5 ${cls}`,
      href && 'cursor-pointer hover:shadow-md hover:scale-[1.02] active:scale-[0.98] transition',
    )}>
      {icon}
      <div>
        <div className="text-lg font-bold leading-none tabular-nums">{value}</div>
        <div className="mt-0.5 text-[10px] uppercase tracking-wide opacity-80">{label}</div>
      </div>
      {href && <ArrowRight className="ml-auto h-3 w-3 opacity-60" />}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
});

function AdminLeaderboardWidget() {
  const topMembers = useRankings('member');
  const topRms = useRankings('rm');
  const topTeams = useRankings('team');
  const topPartners = useRankings('partner');

  const sections: { title: string; icon: React.ReactNode; data: RankedEntry[] | undefined; loading: boolean }[] = [
    { title: 'Top Members', icon: <Users className="h-4 w-4 text-blue-600" />, data: topMembers.data, loading: topMembers.isLoading },
    { title: 'Top RMs', icon: <Award className="h-4 w-4 text-violet-600" />, data: topRms.data, loading: topRms.isLoading },
    { title: 'Top Teams', icon: <Crown className="h-4 w-4 text-amber-600" />, data: topTeams.data, loading: topTeams.isLoading },
    { title: 'Top Partners', icon: <Star className="h-4 w-4 text-emerald-600" />, data: topPartners.data, loading: topPartners.isLoading },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-500" />
          <h2 className="text-sm font-semibold text-slate-900">Company Leaderboard</h2>
        </div>
        <Link href="/leaderboard" className="text-xs text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
          Full leaderboard <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {sections.map(sec => (
          <div key={sec.title} className="card-padded">
            <div className="flex items-center gap-1.5 mb-3">
              {sec.icon}
              <h3 className="text-xs font-semibold text-slate-700">{sec.title}</h3>
            </div>
            {sec.loading ? (
              <Skeleton className="h-32" />
            ) : !sec.data?.length ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 text-center">
                <Trophy className="h-5 w-5 text-slate-300" />
                <div className="text-xs font-medium text-slate-600">No rankings for today yet</div>
                <div className="text-[10px] leading-tight text-slate-400">Updates after the daily ranking job runs.</div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {sec.data.slice(0, 5).map((entry, i) => {
                  const label = RANK_LABELS[i];
                  return (
                    <div key={entry.user_id || i} className={clsx(
                      'flex items-center gap-2 rounded-lg px-2 py-1.5',
                      i === 0 ? 'bg-amber-50' : 'hover:bg-slate-50',
                    )}>
                      <span className={clsx(
                        'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                        i === 0 ? 'bg-amber-500 text-white' : i === 1 ? 'bg-slate-300 text-white' : i === 2 ? 'bg-orange-400 text-white' : 'bg-slate-100 text-slate-600',
                      )}>
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-medium text-slate-900 truncate">
                            {sec.title === 'Top Teams' ? entry.team_name : entry.full_name}
                          </span>
                          <span className="text-xs">{label?.emoji}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-bold tabular-nums text-slate-600">{Number(entry.score).toFixed(0)}</span>
                        <MovementIndicator movement={entry.movement} prev={entry.prev_position} current={entry.rank_position} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const TeamTable = memo(function TeamTable({ data }: { data: UserPerformance[] }) {
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
            <th className="py-2 pr-3 font-medium">Member</th>
            <th className="py-2 pr-3 font-medium">Role</th>
            <th className="py-2 pr-3 font-medium text-right">Leads</th>
            <th className="py-2 pr-3 font-medium text-right">Pending</th>
            <th className="py-2 pr-3 font-medium text-right">Converted</th>
            <th className="py-2 font-medium text-right">Conv %</th>
          </tr>
        </thead>
        <tbody>
          {data.map(u => (
            <tr key={u.id} className="table-row">
              <td className="py-2.5 pr-3">
                <div className="font-medium text-slate-900">{u.full_name}</div>
                {u.team_name && <div className="text-xs text-slate-500">{u.team_name}</div>}
              </td>
              <td className="py-2.5 pr-3">
                <span className={u.role === 'rm' ? 'chip-blue' : 'chip-slate'}>{humanize(u.role)}</span>
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{u.leads}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-amber-700">{u.pending}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-emerald-700">{u.conversions}</td>
              <td className="py-2.5 text-right tabular-nums text-slate-700">{u.conv_rate ?? '0.00'}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

/* ═══════════════════ CAMPAIGN → LEADS TRACKER ═══════════════════
 * Shows: which Meta campaigns are bringing in leads + recent leads stream
 * with campaign name + arrival time. Admin can click into any lead.
 */
function CampaignLeadsTracker() {
  const campaigns = useCampaignsEnriched();
  const recentMeta = useLeadList({ source: 'meta', page: 1, page_size: 10, sort: 'created_at', order: 'desc' });

  const topCampaigns = (campaigns.data || [])
    .filter(c => Number(c.lead_count) > 0)
    .sort((a, b) => Number(b.today_leads) - Number(a.today_leads) || Number(b.lead_count) - Number(a.lead_count))
    .slice(0, 6);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-rose-500" />
          <h2 className="text-sm font-semibold text-slate-900">Campaign → Leads Tracking</h2>
          <span className="chip-slate text-[10px]">Live</span>
        </div>
        <Link href="/settings?tab=campaigns" className="text-xs text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
          Manage campaigns <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Top campaigns by activity */}
        <div className="card-padded lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-700">Top Campaigns by Volume</h3>
            <span className="text-[10px] text-slate-500">{(campaigns.data || []).length} total</span>
          </div>
          {campaigns.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : !topCampaigns.length ? (
            <EmptyState
              title="No campaign activity yet"
              description="Meta campaigns will appear once leads are ingested via webhooks or sync."
              icon={<Megaphone className="h-6 w-6" />}
            />
          ) : (
            <div className="space-y-2">
              {topCampaigns.map(c => (
                <Link
                  key={c.id}
                  href={`/leads?campaign=${encodeURIComponent(c.campaign_name)}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 hover:bg-slate-50 transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className={clsx('h-2 w-2 rounded-full shrink-0', c.is_active ? 'bg-emerald-500' : 'bg-slate-300')} />
                      <span className="text-sm font-medium text-slate-900 truncate">{c.campaign_name}</span>
                      {c.internal_label && <span className="chip-blue text-[10px]">{c.internal_label}</span>}
                    </div>
                    {(c.connected_page || c.connected_form) && (
                      <div className="ml-4 mt-0.5 text-[10px] text-slate-500 truncate">
                        {c.connected_page && <span>📄 {c.connected_page}</span>}
                        {c.connected_page && c.connected_form && <span> · </span>}
                        {c.connected_form && <span>📋 {c.connected_form}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="text-sm font-bold tabular-nums text-brand-700">{c.today_leads}</div>
                      <div className="text-[9px] uppercase tracking-wide text-slate-500">Today</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold tabular-nums text-slate-900">{c.lead_count}</div>
                      <div className="text-[9px] uppercase tracking-wide text-slate-500">Total</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold tabular-nums text-emerald-700">{c.conversions}</div>
                      <div className="text-[9px] uppercase tracking-wide text-slate-500">Conv</div>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-300" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent meta leads stream */}
        <div className="card-padded">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-700">Recent Meta Leads</h3>
            <Link href="/leads?source=meta" className="text-[11px] text-brand-600 hover:text-brand-700">View all</Link>
          </div>
          {recentMeta.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : !recentMeta.data?.rows.length ? (
            <EmptyState
              title="No Meta leads yet"
              description="Live leads will appear here as Meta webhooks fire."
              icon={<Inbox className="h-6 w-6" />}
            />
          ) : (
            <ul className="space-y-1.5">
              {recentMeta.data.rows.slice(0, 6).map(l => (
                <li key={l.id}>
                  <Link
                    href={`/leads/${l.id}`}
                    className="block rounded-lg border border-slate-200 bg-white px-2.5 py-2 hover:bg-slate-50 transition"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-900 truncate">{l.full_name || 'Unnamed'}</span>
                      <span className="text-[10px] text-slate-500 shrink-0">{fmtRelative(l.created_at)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500">
                      {l.campaign_name ? (
                        <span className="truncate">📣 {l.campaign_name}</span>
                      ) : l.campaign_label ? (
                        <span className="chip-blue text-[9px]">{l.campaign_label}</span>
                      ) : (
                        <span className="text-slate-400">No campaign</span>
                      )}
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
