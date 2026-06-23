'use client';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';
import { AppShell } from '@/components/layout/AppShell';
import { Skeleton, EmptyState } from '@/components/ui/Modal';
import { useDaily, useByUser, useFunnel, useSources, useCategories } from '@/hooks/useReports';
import { LeadCategoryBadge } from '@/components/leads/LeadCategoryBadge';
import { humanize } from '@/lib/format';
import { format } from 'date-fns';
import { useAuth } from '@/lib/auth';

const PIE_COLORS = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#1d4ed8', '#1e40af'];

export default function ReportsPage() {
  const { user } = useAuth();
  const isRm = user?.role === 'rm';
  return (
    <AppShell title={isRm ? 'Team Reports' : 'Reports'} subtitle={isRm ? 'Performance metrics for your assigned team only' : 'Conversion funnel, source mix, and team performance'} roles={['super_admin', 'admin', 'rm']}>
      <ReportsInner />
    </AppShell>
  );
}

function ReportsInner() {
  const daily   = useDaily(30);
  const byUser  = useByUser();
  const funnel  = useFunnel();
  const sources = useSources();
  const categories = useCategories();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(['trader', 'partner', 'unknown'] as const).map(category => {
          const stat = categories.data?.find(item => item.category === category);
          return <div key={category} className="card-padded"><LeadCategoryBadge category={category} /><div className="mt-3 text-2xl font-bold text-slate-900">{stat?.total || 0}</div><div className="mt-1 text-xs text-slate-500">{stat?.conversions || 0} converted · {stat?.pending || 0} pending · {stat?.followups_due || 0} follow-ups due</div></div>;
        })}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card-padded">
          <Header title="Daily activity (30d)" subtitle="Leads vs conversions per day" />
          <div className="h-72">
            {daily.isLoading ? <Skeleton className="h-full" /> : daily.data?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={daily.data.map(d => ({
                    day: format(new Date(d.day), 'd MMM'),
                    leads: Number(d.leads),
                    conversions: Number(d.conversions),
                  }))}
                  margin={{ top: 6, right: 12, left: -8, bottom: 0 }}
                >
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="leads"       stroke="#2563eb" strokeWidth={2} dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="conversions" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No data yet" />}
          </div>
        </div>

        <div className="card-padded">
          <Header title="Funnel by stage" subtitle="How leads are progressing through the pipeline" />
          <div className="h-72">
            {funnel.isLoading ? <Skeleton className="h-full" /> : funnel.data?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={funnel.data.map(f => ({ stage: humanize(f.stage), count: Number(f.count) }))}
                  layout="vertical"
                  margin={{ top: 6, right: 16, left: 8, bottom: 0 }}
                >
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="stage" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} width={90} />
                  <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="count" fill="#2563eb" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No data yet" />}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:sticky lg;top-6 lg:shrink-0 card-padded">
          <Header title="Lead sources" subtitle="Channel-wise mix" />
          <div className="h-72">
            {sources.isLoading ? <Skeleton className="h-full" /> : sources.data?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sources.data.map(s => ({ name: humanize(s.source || 'unknown'), value: Number(s.count) }))}
                    dataKey="value" nameKey="name"
                    cx="50%" cy="50%" outerRadius={88} innerRadius={50}
                    paddingAngle={2}
                  >
                    {sources.data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No data yet" />}
          </div>
        </div>

        <div className="card-padded lg:col-span-2">
          <Header title="Per-user performance" subtitle="Conversion rate and call status mix" />
          {byUser.isLoading ? (
            <Skeleton className="h-64" />
          ) : !byUser.data?.length ? <EmptyState title="No data yet" /> : (
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3 font-medium">Member</th>
                    <th className="py-2 pr-3 font-medium text-right">Leads</th>
                    <th className="py-2 pr-3 font-medium text-right">Pending</th>
                    <th className="py-2 pr-3 font-medium text-right">Converted</th>
                    <th className="py-2 pr-3 font-medium text-right">RNR</th>
                    <th className="py-2 pr-3 font-medium text-right">Not Int.</th>
                    <th className="py-2 font-medium text-right">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {byUser.data.map(u => (
                    <tr key={u.id} className="table-row">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-slate-900">{u.full_name}</div>
                        <div className="text-xs text-slate-500">{humanize(u.role)}{u.team_name ? ` · ${u.team_name}` : ''}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-slate-800">{u.leads}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-amber-700">{u.pending}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-emerald-700">{u.conversions}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">{u.rnr}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-rose-700">{u.not_interested}</td>
                      <td className="py-2.5 text-right tabular-nums text-slate-800 font-medium">{u.conv_rate ?? '0.00'}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <p className="text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}
