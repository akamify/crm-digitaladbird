'use client';
import { useState } from 'react';
import Link from 'next/link';
import { BarChart3, ArrowLeft, TrendingUp, Users, Target, Clock } from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell,
} from 'recharts';
import { format } from 'date-fns';
import { AppShell } from '@/components/layout/AppShell';
import { Skeleton, EmptyState } from '@/components/ui/Modal';
import { useAnalyticsOverview, useConversionAnalytics } from '@/hooks/useAdminEnterprise';
import { clsx, humanize } from '@/lib/format';

const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
const dayFmt = (d: string) => { try { return format(new Date(d), 'd MMM'); } catch { return d; } };

export default function AnalyticsPage() {
  return (
    <AppShell title="Analytics Dashboard" subtitle="Deep insights into leads, conversions, and team performance" roles={['super_admin']}>
      <AnalyticsInner />
    </AppShell>
  );
}

function AnalyticsInner() {
  const { data: overview, isLoading: loadingOverview } = useAnalyticsOverview();
  const { data: convData, isLoading: loadingConv } = useConversionAnalytics();
  const [tab, setTab] = useState<'overview' | 'conversions'>('overview');

  if (loadingOverview) return <Skeleton className="h-96" />;

  const c = overview?.counts;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="h-4 w-4" /></Link>
        <BarChart3 className="h-5 w-5 text-brand-600" />
        <h1 className="text-lg font-semibold text-slate-900">Analytics</h1>
      </div>

      {/* Top counters */}
      {c && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Counter label="Total Leads" value={c.total_leads} color="text-slate-900" />
          <Counter label="Unassigned" value={c.unassigned_leads} color="text-amber-700" />
          <Counter label="Pending" value={c.pending_leads} color="text-rose-700" />
          <Counter label="Converted" value={c.converted_leads} color="text-emerald-700" />
          <Counter label="Today Leads" value={c.today_leads} color="text-brand-700" />
          <Counter label="Today Conv" value={c.today_conversions} color="text-green-700" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 w-fit">
        <button onClick={() => setTab('overview')} className={clsx('rounded-md px-4 py-1.5 text-xs font-medium transition', tab === 'overview' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>Overview</button>
        <button onClick={() => setTab('conversions')} className={clsx('rounded-md px-4 py-1.5 text-xs font-medium transition', tab === 'conversions' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>Conversions</button>
      </div>

      {tab === 'overview' ? (
        <div className="space-y-6">
          {/* 30-day trend chart */}
          <div className="card-padded">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">30-Day Lead Trend</h2>
            <div className="h-72">
              {overview?.dailyTrend ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={overview.dailyTrend.map(d => ({ day: dayFmt(d.day), leads: d.leads, conversions: d.conversions, remarks: d.remarks }))}>
                    <defs>
                      <linearGradient id="ag1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity={0.3} /><stop offset="100%" stopColor="#2563eb" stopOpacity={0} /></linearGradient>
                      <linearGradient id="ag2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
                    <Area type="monotone" dataKey="leads" stroke="#2563eb" strokeWidth={2} fill="url(#ag1)" />
                    <Area type="monotone" dataKey="conversions" stroke="#10b981" strokeWidth={2} fill="url(#ag2)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <Skeleton className="h-full" />}
            </div>
          </div>

          {/* Stage + Status breakdown */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="card-padded">
              <h2 className="text-sm font-semibold text-slate-900 mb-4">Lead Stage Breakdown</h2>
              {overview?.stageBreakdown && overview.stageBreakdown.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={overview.stageBreakdown} dataKey="count" nameKey="stage" cx="50%" cy="50%" outerRadius={80} label={({ stage, count }: any) => `${humanize(stage)} (${count})`}>
                        {overview.stageBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : <div className="py-8 text-center text-sm text-slate-500">No data</div>}
            </div>

            <div className="card-padded">
              <h2 className="text-sm font-semibold text-slate-900 mb-4">Today&apos;s Hourly Inflow</h2>
              {overview?.hourlyToday && overview.hourlyToday.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={overview.hourlyToday.map(h => ({ hour: `${h.hour}:00`, count: h.count }))}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="hour" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <div className="py-8 text-center text-sm text-slate-500">No leads today</div>}
            </div>
          </div>

          {/* Top Performers */}
          <div className="card-padded">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">Top Performers</h2>
            {overview?.topPerformers && overview.topPerformers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="py-2 pr-3 font-medium">#</th>
                      <th className="py-2 pr-3 font-medium">Member</th>
                      <th className="py-2 pr-3 font-medium">Role</th>
                      <th className="py-2 pr-3 font-medium text-right">Leads</th>
                      <th className="py-2 pr-3 font-medium text-right">Conv</th>
                      <th className="py-2 font-medium text-right">Conv %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {overview.topPerformers.map((p, i) => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="py-2.5 pr-3 font-bold text-slate-400">{i + 1}</td>
                        <td className="py-2.5 pr-3"><div className="font-medium text-slate-900">{p.full_name}</div>{p.team_name && <div className="text-xs text-slate-500">{p.team_name}</div>}</td>
                        <td className="py-2.5 pr-3"><span className="chip-slate">{humanize(p.role)}</span></td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{p.total_leads}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-emerald-700">{p.conversions}</td>
                        <td className="py-2.5 text-right tabular-nums">{p.conv_rate ?? 0}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="py-8 text-center text-sm text-slate-500">No data yet</div>}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {loadingConv ? <Skeleton className="h-96" /> : convData ? (
            <>
              {/* By User */}
              <div className="card-padded">
                <h2 className="text-sm font-semibold text-slate-900 mb-4">Conversion by Team Member</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                        <th className="py-2 pr-3 font-medium">Member</th>
                        <th className="py-2 pr-3 font-medium">Team</th>
                        <th className="py-2 pr-3 font-medium text-right">Leads</th>
                        <th className="py-2 pr-3 font-medium text-right">Conv</th>
                        <th className="py-2 pr-3 font-medium text-right">Conv %</th>
                        <th className="py-2 font-medium text-right">Avg Response (hrs)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {convData.byUser.map(u => (
                        <tr key={u.id} className="hover:bg-slate-50">
                          <td className="py-2.5 pr-3 font-medium text-slate-900">{u.full_name}</td>
                          <td className="py-2.5 pr-3 text-slate-600">{u.team_name || '—'}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{u.total_leads}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums text-emerald-700">{u.conversions}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{u.conv_rate ?? 0}%</td>
                          <td className="py-2.5 text-right tabular-nums text-slate-500">{u.avg_response_hours != null ? `${u.avg_response_hours}h` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* By Source + Campaign side by side */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="card-padded">
                  <h2 className="text-sm font-semibold text-slate-900 mb-4">Conversion by Source</h2>
                  <div className="space-y-2">
                    {convData.bySource.map(s => (
                      <div key={s.source} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                        <span className="text-sm font-medium text-slate-900">{humanize(s.source || 'unknown')}</span>
                        <div className="flex items-center gap-4 text-xs tabular-nums">
                          <span className="text-slate-600">{s.total} leads</span>
                          <span className="text-emerald-700">{s.conversions} conv</span>
                          <span className="font-medium">{s.conv_rate ?? 0}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card-padded">
                  <h2 className="text-sm font-semibold text-slate-900 mb-4">Conversion by Campaign</h2>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {convData.byCampaign.map((c, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                        <span className="text-sm font-medium text-slate-900 truncate max-w-[180px]">{c.campaign}</span>
                        <div className="flex items-center gap-4 text-xs tabular-nums">
                          <span className="text-slate-600">{c.total}</span>
                          <span className="text-emerald-700">{c.conversions}</span>
                          <span className="font-medium">{c.conv_rate ?? 0}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : <EmptyState title="No conversion data" description="Data appears once leads are assigned." icon={<Target className="h-6 w-6" />} />}
        </div>
      )}
    </div>
  );
}

function Counter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <div className={clsx('text-xl font-bold tabular-nums', color)}>{value?.toLocaleString?.() ?? 0}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
