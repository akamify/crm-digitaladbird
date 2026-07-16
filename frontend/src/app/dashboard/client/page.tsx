'use client';

import Link from 'next/link';
import { BarChart3, FileText, Globe2, Megaphone, MousePointerClick, PhoneCall, TrendingUp, WalletCards } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { EmptyState, Skeleton } from '@/components/ui/Modal';
import { useClientDashboard } from '@/hooks/useClients';

export default function ClientDashboardPage() {
  return (
    <AppShell title="Client Dashboard" subtitle="Your business Meta assets, campaigns, and leads" roles={['client']}>
      <ClientDashboardInner />
    </AppShell>
  );
}

function ClientDashboardInner() {
  const dashboard = useClientDashboard();
  const stats = dashboard.data || {};

  if (dashboard.isLoading) {
    return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-28" />)}</div>;
  }

  if (dashboard.isError) {
    return <EmptyState title="Dashboard could not be loaded" action={<button className="btn-outline rounded-lg px-3 py-2 text-sm" onClick={() => dashboard.refetch()}>Retry</button>} />;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Leads" value={Number(stats.total_leads || 0).toLocaleString()} accent="pink" icon={<PhoneCall className="h-5 w-5" />} />
        <KpiCard label="Today Leads" value={Number(stats.today_leads || 0).toLocaleString()} accent="blue" icon={<TrendingUp className="h-5 w-5" />} />
        <KpiCard label="Active Campaigns" value={Number(stats.active_campaigns || 0).toLocaleString()} accent="green" icon={<Megaphone className="h-5 w-5" />} />
        <KpiCard label="Total Campaigns" value={Number(stats.total_campaigns || 0).toLocaleString()} accent="slate" icon={<BarChart3 className="h-5 w-5" />} />
        <KpiCard label="Spend" value={Number(stats.spend || 0).toLocaleString()} accent="amber" icon={<WalletCards className="h-5 w-5" />} />
        <KpiCard label="Reach" value={Number(stats.reach || 0).toLocaleString()} accent="blue" icon={<Globe2 className="h-5 w-5" />} />
        <KpiCard label="Impressions" value={Number(stats.impressions || 0).toLocaleString()} accent="blue" icon={<MousePointerClick className="h-5 w-5" />} />
        <KpiCard label="CPL" value={Number(stats.cpl || 0).toFixed(2)} accent="slate" icon={<FileText className="h-5 w-5" />} />
        <KpiCard label="Conversion" value={`${Number(stats.conversion_rate || 0).toFixed(1)}%`} accent="green" icon={<TrendingUp className="h-5 w-5" />} />
        <KpiCard label="Forms" value={Number(stats.forms || 0).toLocaleString()} accent="blue" icon={<FileText className="h-5 w-5" />} />
        <KpiCard label="Pages" value={Number(stats.pages || 0).toLocaleString()} accent="blue" icon={<Globe2 className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Link href="/leads" className="card-padded block hover:border-brand-200 hover:bg-brand-50/30">
          <h2 className="text-sm font-semibold text-slate-900">Leads</h2>
          <p className="mt-1 text-sm text-slate-500">Search and work only your owned Meta leads.</p>
        </Link>
        <Link href="/settings" className="card-padded block hover:border-brand-200 hover:bg-brand-50/30">
          <h2 className="text-sm font-semibold text-slate-900">Meta Settings</h2>
          <p className="mt-1 text-sm text-slate-500">View assigned pages, forms, ad accounts, campaigns, and sync state.</p>
        </Link>
        <Link href="/support" className="card-padded block hover:border-brand-200 hover:bg-brand-50/30">
          <h2 className="text-sm font-semibold text-slate-900">Support</h2>
          <p className="mt-1 text-sm text-slate-500">Raise a ticket for any CRM or Meta data issue.</p>
        </Link>
      </div>
    </div>
  );
}
