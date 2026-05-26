'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Globe, ArrowLeft, TrendingUp, Zap, Clock } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Skeleton, EmptyState } from '@/components/ui/Modal';
import { useLeadSources } from '@/hooks/useAdminEnterprise';
import { fmtDate, fmtRelative, clsx, humanize } from '@/lib/format';

export default function LeadSourcesPage() {
  return (
    <AppShell title="Lead Source Monitoring" subtitle="Track where leads are coming from in real-time" roles={['super_admin']}>
      <SourcesInner />
    </AppShell>
  );
}

function SourcesInner() {
  const { data, isLoading } = useLeadSources();
  const [tab, setTab] = useState<'sources' | 'campaigns'>('sources');

  if (isLoading) return <Skeleton className="h-96" />;
  if (!data) return <EmptyState title="No data" description="No lead source data available." icon={<Globe className="h-6 w-6" />} />;

  const totalLeads = data.sources.reduce((s, r) => s + r.total_leads, 0);
  const todayLeads = data.sources.reduce((s, r) => s + r.today_leads, 0);
  const totalConv = data.sources.reduce((s, r) => s + r.conversions, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="h-4 w-4" /></Link>
        <Globe className="h-5 w-5 text-brand-600" />
        <h1 className="text-lg font-semibold text-slate-900">Lead Sources</h1>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-2xl font-bold text-slate-900 tabular-nums">{totalLeads.toLocaleString()}</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Total Leads</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-2xl font-bold text-emerald-700 tabular-nums">{todayLeads}</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Today</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-2xl font-bold text-green-700 tabular-nums">{totalConv}</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Conversions</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 w-fit">
        <button onClick={() => setTab('sources')} className={clsx('rounded-md px-4 py-1.5 text-xs font-medium transition', tab === 'sources' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>By Source</button>
        <button onClick={() => setTab('campaigns')} className={clsx('rounded-md px-4 py-1.5 text-xs font-medium transition', tab === 'campaigns' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>By Campaign</button>
      </div>

      {tab === 'sources' ? (
        <div className="card-padded overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pr-3 font-medium text-right">Total</th>
                <th className="py-2 pr-3 font-medium text-right">Today</th>
                <th className="py-2 pr-3 font-medium text-right">Conversions</th>
                <th className="py-2 pr-3 font-medium text-right">Pending</th>
                <th className="py-2 pr-3 font-medium text-right">Conv %</th>
                <th className="py-2 font-medium text-right">Last Lead</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.sources.map(s => (
                <tr key={s.source || 'null'} className="hover:bg-slate-50">
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-2">
                      <span className={clsx('h-2 w-2 rounded-full', s.source === 'meta' ? 'bg-blue-500' : s.source === 'google' ? 'bg-red-500' : s.source === 'website' ? 'bg-green-500' : 'bg-slate-400')} />
                      <span className="font-medium text-slate-900">{humanize(s.source || 'unknown')}</span>
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums font-medium">{s.total_leads}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-emerald-700">{s.today_leads}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-green-700">{s.conversions}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-amber-700">{s.pending}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{s.conv_rate ?? 0}%</td>
                  <td className="py-3 text-right text-xs text-slate-500">{s.last_lead_at ? fmtRelative(s.last_lead_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card-padded overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-medium">Campaign</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pr-3 font-medium text-right">Total</th>
                <th className="py-2 pr-3 font-medium text-right">Today</th>
                <th className="py-2 pr-3 font-medium text-right">Conversions</th>
                <th className="py-2 font-medium text-right">Conv %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.campaigns.map((c, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="py-3 pr-3 font-medium text-slate-900 max-w-[200px] truncate">{c.campaign}</td>
                  <td className="py-3 pr-3 text-slate-600">{humanize(c.source || 'unknown')}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{c.total_leads}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-emerald-700">{c.today_leads}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-green-700">{c.conversions}</td>
                  <td className="py-3 text-right tabular-nums">{c.conv_rate ?? 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
