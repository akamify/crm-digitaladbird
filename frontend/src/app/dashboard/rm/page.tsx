'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { connectSocket } from '@/lib/socket';
import {
  Activity, CheckCircle2, Clock, TrendingDown, TrendingUp,
  Briefcase, ArrowRight, Users, HandMetal, Inbox, Trophy, Star, AlertTriangle, Zap,
  Eye, UserCheck, Send, CircleDot, BarChart3,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { format } from 'date-fns';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { Skeleton, EmptyState, PageLoader } from '@/components/ui/Modal';
import { useSummary, useDaily } from '@/hooks/useReports';
import { useLeadList } from '@/hooks/useLeads';
import { useRmInsights, RANK_LABELS } from '@/hooks/useRankings';
import { MovementIndicator, ScoreBadge } from '@/components/rankings/RankBadge';
import { useRmLiveCounters, useTeamOverview, useMemberRequests } from '@/hooks/useRmMonitoring';
import type { RmLiveCounters, TeamMemberOverview, MemberRequest } from '@/hooks/useRmMonitoring';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtRelative, isOverdue, isDueToday, humanize, initials, clsx } from '@/lib/format';
import type { DailyPoint } from '@/types';

const dayFmt = (d: string) => { try { return format(new Date(d), 'd MMM'); } catch { return d; } };

export default function RmDashboardPage() {
  return (
    <AppShell
      title="RM Dashboard"
      subtitle="Team monitoring & lead pipeline"
      roles={['rm']}
    >
      <RmDashboardInner />
    </AppShell>
  );
}

function RmDashboardInner() {
  const { user } = useAuth();
  const summary   = useSummary();
  const daily     = useDaily(14);
  const followups = useLeadList({ followup: 'today', page: 1, page_size: 6 });
  const counters  = useRmLiveCounters();
  const teamOverview = useTeamOverview();
  const [reqCategory, setReqCategory] = useState('');
  const memberRequests = useMemberRequests(reqCategory || undefined);
  const qc = useQueryClient();

  // Live: refresh team-scoped counters when a new lead lands for one of
  // our members, or when any request lifecycle event fires.
  useEffect(() => {
    let cancelled = false;
    const off: Array<() => void> = [];
    connectSocket().then((s) => {
      if (cancelled) return;
      const refresh = () => {
        qc.invalidateQueries({ queryKey: ['reports', 'summary'] });
        qc.invalidateQueries({ queryKey: ['reports', 'daily'] });
        qc.invalidateQueries({ queryKey: ['rm-monitoring'] });
        qc.invalidateQueries({ queryKey: ['leads'] });
      };
      const reqRefresh = () => {
        qc.invalidateQueries({ queryKey: ['rm-monitoring', 'member-requests'] });
        qc.invalidateQueries({ queryKey: ['rm-monitoring', 'live-counters'] });
      };
      s.on('lead:new', refresh);
      s.on('lead-request:created', reqRefresh);
      s.on('lead-request:approved', reqRefresh);
      s.on('lead-request:rejected', reqRefresh);
      s.on('lead-request:fulfilled', reqRefresh);
      off.push(() => s.off('lead:new', refresh));
      off.push(() => s.off('lead-request:created', reqRefresh));
      off.push(() => s.off('lead-request:approved', reqRefresh));
      off.push(() => s.off('lead-request:rejected', reqRefresh));
      off.push(() => s.off('lead-request:fulfilled', reqRefresh));
    }).catch(() => { /* socket unavailable — fall back to poll */ });
    return () => { cancelled = true; off.forEach(fn => fn()); };
  }, [qc]);

  if (!user) return <PageLoader />;

  const k = summary.data;
  const totalLeads = Number(k?.total_leads ?? 0);
  const conv       = Number(k?.converted ?? 0);
  const convRate   = totalLeads > 0 ? Math.round((conv / totalLeads) * 1000) / 10 : 0;

  return (
    <div className="space-y-6">
      {/* RM scope notice */}
      <div className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
        <Eye className="h-4 w-4 text-brand-600" />
        <span className="text-sm font-medium text-brand-800">
          <strong>Monitoring Mode</strong> — Viewing your team&apos;s real-time activity. Lead assignment runs automatically.
        </span>
      </div>

      {/* Live Monitoring Counters */}
      <MonitoringCounters data={counters.data ?? null} loading={counters.isLoading} />

      {/* Team Lead Requests Enhanced */}
      <TeamRequestsMonitor
        requests={memberRequests.data ?? []}
        loading={memberRequests.isLoading}
        category={reqCategory}
        onCategoryChange={setReqCategory}
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summary.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <KpiCard label="Team leads"    value={totalLeads.toLocaleString()} delta={`${k?.today_leads ?? 0} today`}   accent="pink"  icon={<Briefcase className="h-5 w-5" />} />
            <KpiCard label="Pending"       value={Number(k?.pending ?? 0).toLocaleString()} delta="Awaiting first call" accent="amber" icon={<Clock className="h-5 w-5" />} />
            <KpiCard label="Conversions"   value={conv.toLocaleString()} delta={`${convRate}% conv rate`} trend="up"    accent="green" icon={<CheckCircle2 className="h-5 w-5" />} />
            <KpiCard label="Lost / Not int." value={Number(k?.lost ?? 0).toLocaleString()}                               accent="slate" icon={<TrendingDown className="h-5 w-5" />} />
          </>
        )}
      </div>

      {/* Chart + followups */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card-padded lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Team leads — last 14 days</h2>
              <p className="text-xs text-slate-500">Your team&apos;s daily volume vs conversions</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-500" /> Leads</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Conversions</span>
            </div>
          </div>
          <div className="h-72">
            {daily.isLoading ? <Skeleton className="h-full" /> : <DailyChart data={daily.data ?? []} />}
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
                      <div className="truncate text-sm font-medium text-slate-900">{l.full_name || 'Unnamed'}</div>
                      <div className="truncate text-xs text-slate-500">{l.assigned_to_name || '—'}</div>
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

      {/* Team Member Activity Monitor */}
      <TeamActivityMonitor members={teamOverview.data ?? []} loading={teamOverview.isLoading} />

      {/* RM Ranking Insights */}
      <RmRankingInsights />
    </div>
  );
}

/* ─── Live Monitoring Counters ─────────────────────────────────── */

function MonitoringCounters({ data, loading }: { data: RmLiveCounters | null; loading: boolean }) {
  if (loading) return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* Each tile drills into the matching filtered view on /leads or /rm-teams.
            Filters use the same query-string contract the /leads page already supports. */}
        <CounterCard label="Requests Today" value={data.requests_today} sub={`${data.requests_pending} pending`} icon={<Send className="h-4 w-4" />} color="blue"   href="/partner-requests?status=pending" />
        <CounterCard label="Leads Distributed" value={data.leads_distributed_today} sub="today"        icon={<Briefcase className="h-4 w-4" />}  color="emerald" href="/leads?assigned=today" />
        <CounterCard label="Conversions"      value={data.conversions_today}        sub="today"        icon={<CheckCircle2 className="h-4 w-4" />} color="green"  href="/leads?call_status=converted" />
        <CounterCard label="Active Members"   value={data.active_today}             sub={`of ${data.team_size}`} icon={<UserCheck className="h-4 w-4" />} color="brand" href="/rm-teams?filter=active" />
        <CounterCard label="Pending Work"     value={data.pending_work_users}       sub="members"      icon={<Clock className="h-4 w-4" />}        color="amber"  href="/leads?pending=true" />
        <CounterCard label="Waiting for Leads" value={data.members_waiting}         sub="members"      icon={<Users className="h-4 w-4" />}        color="rose"   href="/partner-requests?status=pending" />
      </div>

      {/* Top highlights */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
            <Zap className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Top Active Today</div>
            {data.top_active_member ? (
              <>
                <div className="truncate text-sm font-semibold text-slate-900">{data.top_active_member.full_name}</div>
                <div className="text-xs text-emerald-700">{data.top_active_member.activity} actions today</div>
              </>
            ) : <div className="text-xs text-slate-500">No activity yet today</div>}
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50 px-4 py-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-500 text-white">
            <Trophy className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">Top Converter</div>
            {data.top_conversion_member ? (
              <>
                <div className="truncate text-sm font-semibold text-slate-900">{data.top_conversion_member.full_name}</div>
                <div className="text-xs text-amber-700">{data.top_conversion_member.conversions} conversions</div>
              </>
            ) : <div className="text-xs text-slate-500">No conversions yet</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function CounterCard({ label, value, sub, icon, color, href }: {
  label: string; value: number; sub: string;
  icon: React.ReactNode; color: string;
  href?: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    brand: 'bg-brand-50 text-brand-600 border-brand-200',
    amber: 'bg-amber-50 text-amber-600 border-amber-200',
    rose: 'bg-rose-50 text-rose-600 border-rose-200',
  };
  const cls = colorMap[color] || colorMap.blue;

  const inner = (
    <div className={clsx(
      'rounded-xl border p-3.5 transition',
      href ? 'hover:shadow-md hover:scale-[1.02] cursor-pointer active:scale-[0.98]' : 'hover:shadow-sm',
      cls,
    )}>
      <div className="flex items-center gap-2 mb-2 opacity-80">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
        {href && <ArrowRight className="ml-auto h-3 w-3 opacity-60" />}
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-[10px] opacity-70">{sub}</div>
    </div>
  );

  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

/* ─── Team Lead Requests Monitor (Enhanced) ────────────────────── */

const CATEGORY_TABS = [
  { key: '', label: 'All' },
  { key: 'partner', label: 'Partner Leads' },
  { key: 'trader', label: 'Trader Leads' },
];

function TeamRequestsMonitor({ requests, loading, category, onCategoryChange }: {
  requests: MemberRequest[]; loading: boolean; category: string; onCategoryChange: (v: string) => void;
}) {
  return (
    <div className="card-padded">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <HandMetal className="h-4 w-4 text-brand-600" />
          <h2 className="text-sm font-semibold text-slate-900">Team Lead Requests</h2>
        </div>

        {/* Category filter tabs */}
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          {CATEGORY_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => onCategoryChange(t.key)}
              className={clsx(
                'rounded-md px-3 py-1 text-xs font-medium transition',
                category === t.key ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <span className="ml-auto text-xs text-slate-500">{requests.length} requests</span>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : requests.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">No lead requests from your team yet.</div>
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-medium">Member/Partner</th>
                <th className="py-2 pr-3 font-medium">Category</th>
                <th className="py-2 pr-3 font-medium text-right">Qty</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium text-right">Received Today</th>
                <th className="py-2 pr-3 font-medium text-right">Total Received</th>
                <th className="py-2 pr-3 font-medium text-right">Pending</th>
                <th className="py-2 pr-3 font-medium text-right">Worked</th>
                <th className="py-2 pr-3 font-medium text-right">Converted</th>
                <th className="py-2 pr-3 font-medium text-right">Remaining</th>
                <th className="py-2 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(r => {
                const remaining = r.member_leads_total - r.member_leads_worked;
                return (
                  <tr key={r.id} className="table-row">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <div className={clsx(
                          'grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                          r.request_source === 'partner' ? 'bg-violet-100 text-violet-700' : 'bg-brand-100 text-brand-700',
                        )}>{initials(r.full_name)}</div>
                        <div>
                          <div className="font-medium text-slate-900">{r.full_name}</div>
                          <div className="text-[10px] text-slate-400">{r.request_source === 'partner' ? 'Partner' : humanize(r.member_type || r.role)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={r.category === 'partner' ? 'chip-blue' : r.category === 'trader' ? 'chip-amber' : 'chip-slate'}>
                        {r.category ? humanize(r.category) : 'Both'}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-medium">{r.quantity}</td>
                    <td className="py-2.5 pr-3">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-blue-700">{r.member_leads_today}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{r.member_leads_total}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-amber-700">{r.member_leads_pending}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{r.member_leads_worked}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-emerald-700">{r.member_leads_converted}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      <span className={remaining > 0 ? 'text-rose-600 font-medium' : 'text-slate-500'}>{remaining}</span>
                    </td>
                    <td className="py-2.5 text-xs text-slate-500">{fmtRelative(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'fulfilled' || status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
    status === 'pending' ? 'bg-amber-50 text-amber-700' :
    status === 'approved' || status === 'assigned' ? 'bg-blue-50 text-blue-700' :
    status === 'rejected' ? 'bg-rose-50 text-rose-700' :
    'bg-slate-100 text-slate-600';
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold', cls)}>
      {humanize(status)}
    </span>
  );
}

/* ─── Team Activity Monitor ────────────────────────────────────── */

function TeamActivityMonitor({ members, loading }: { members: TeamMemberOverview[]; loading: boolean }) {
  return (
    <div className="card-padded">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-brand-600" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Team Member Activity Monitor</h2>
            <p className="text-xs text-slate-500">Per-member lead handling, work status & request tracking</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <CircleDot className="h-3 w-3 text-emerald-500" />
          <span>{members.filter(m => m.is_active_today).length} active today</span>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-64" />
      ) : members.length === 0 ? (
        <EmptyState title="No team members" description="Members reporting to you will appear here." icon={<Users className="h-6 w-6" />} />
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-medium">Member</th>
                <th className="py-2 pr-3 font-medium text-center">Status</th>
                <th className="py-2 pr-3 font-medium text-right">Today</th>
                <th className="py-2 pr-3 font-medium text-right">Total</th>
                <th className="py-2 pr-3 font-medium text-right">Pending</th>
                <th className="py-2 pr-3 font-medium text-right">Worked</th>
                <th className="py-2 pr-3 font-medium text-right">Converted</th>
                <th className="py-2 pr-3 font-medium text-right">Conv %</th>
                <th className="py-2 pr-3 font-medium text-right">Remaining</th>
                <th className="py-2 pr-3 font-medium text-right">Requests</th>
                <th className="py-2 pr-3 font-medium text-right">Actions Today</th>
                <th className="py-2 font-medium">Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.id} className={clsx('table-row', !m.is_active_today && m.leads_remaining > 0 && 'bg-rose-50/40')}>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <div className={clsx(
                        'grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                        m.role === 'partner' ? 'bg-violet-100 text-violet-700' : 'bg-brand-100 text-brand-700',
                      )}>{initials(m.full_name)}</div>
                      <div>
                        <div className="font-medium text-slate-900">{m.full_name}</div>
                        <div className="text-[10px] text-slate-400">
                          {m.role === 'partner' ? 'Partner' : humanize(m.member_type || 'member')}
                          {m.team_name ? ` · ${m.team_name}` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-center">
                    {m.is_active_today ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <CircleDot className="h-2.5 w-2.5" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                        Idle
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-blue-700 font-medium">{m.leads_received_today}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{m.leads_received_total}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-amber-700">{m.leads_pending}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{m.leads_worked}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-emerald-700 font-medium">{m.leads_converted}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{m.conv_rate}%</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    <span className={m.leads_remaining > 5 ? 'text-rose-600 font-medium' : 'text-slate-500'}>{m.leads_remaining}</span>
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    <span>{m.requests_total}</span>
                    {m.requests_pending > 0 && <span className="ml-1 text-amber-600">({m.requests_pending})</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{m.remarks_today}</td>
                  <td className="py-2.5 text-xs text-slate-500">{m.last_remark_at ? fmtRelative(m.last_remark_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── RM Ranking Insights (existing) ──────────────────────────── */

function RmRankingInsights() {
  const insights = useRmInsights();
  const d = insights.data;

  if (insights.isLoading) return <Skeleton className="h-64" />;
  if (!d) return null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="card-padded">
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-semibold text-slate-900">Top Performing Members</h2>
        </div>
        {d.top_members.length > 0 ? (
          <div className="space-y-2">
            {d.top_members.map((m: any, i: number) => {
              const label = RANK_LABELS[i];
              return (
                <div key={m.user_id} className={clsx(
                  'flex items-center gap-3 rounded-lg border px-3 py-2.5',
                  i === 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white',
                )}>
                  <div className={clsx(
                    'grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold',
                    i === 0 ? 'bg-amber-500 text-white' : i === 1 ? 'bg-slate-300 text-white' : i === 2 ? 'bg-orange-400 text-white' : 'bg-slate-100 text-slate-700',
                  )}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-slate-900 truncate">{m.full_name}</span>
                      <span className="text-sm">{label?.emoji}</span>
                    </div>
                    <div className="text-[10px] text-slate-500">{label?.label}</div>
                  </div>
                  <ScoreBadge score={m.score} />
                  <MovementIndicator movement={m.movement} prev={m.prev_position} current={m.rank_position} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-slate-500">No ranking data yet. Rankings refresh daily.</div>
        )}
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Star className="h-4 w-4 text-emerald-600" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Best Converter</span>
            </div>
            {d.best_converter ? (
              <>
                <div className="text-sm font-semibold text-slate-900">{d.best_converter.full_name}</div>
                <div className="text-xs text-emerald-700">{d.best_converter.conversions} conversions / {d.best_converter.total} leads</div>
              </>
            ) : <div className="text-xs text-slate-500">No data yet</div>}
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Zap className="h-4 w-4 text-blue-600" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">Most Active</span>
            </div>
            {d.most_active ? (
              <>
                <div className="text-sm font-semibold text-slate-900">{d.most_active.full_name}</div>
                <div className="text-xs text-blue-700">{d.most_active.activity} actions this week</div>
              </>
            ) : <div className="text-xs text-slate-500">No data yet</div>}
          </div>
        </div>

        <div className="card-padded">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold text-slate-900">Needs Attention</h2>
          </div>
          {d.weak_members.length > 0 ? (
            <div className="space-y-1.5">
              {d.weak_members.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="text-sm text-slate-700">{m.full_name}</span>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{m.leads_total} leads</span>
                    <span className="text-emerald-600">{m.leads_converted} conv</span>
                    <span>{m.calls_made} calls</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-sm text-slate-500">All members performing well!</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────── */

function DailyChart({ data }: { data: DailyPoint[] }) {
  const series = data.map(d => ({ day: dayFmt(d.day), leads: Number(d.leads), conversions: Number(d.conversions) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={series} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="gLeadsRM" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gConvRM" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
        <Area type="monotone" dataKey="leads"       stroke="#2563eb" strokeWidth={2} fill="url(#gLeadsRM)" />
        <Area type="monotone" dataKey="conversions" stroke="#10b981" strokeWidth={2} fill="url(#gConvRM)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
