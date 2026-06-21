'use client';

import Link from 'next/link';
import { ArrowLeft, GitBranch, Loader2, Play, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { useAssignmentOverview, useRunDistributionNow, useRunReassignmentNow, useUpdateAssignmentSettings } from '@/hooks/useAdminEnterprise';
import { clsx } from '@/lib/format';

export default function DistributionPage() {
  return (
    <AppShell title="Lead Auto Distribution" subtitle="Round robin controls for new leads" roles={['super_admin', 'admin']}>
      <DistributionInner />
    </AppShell>
  );
}

function DistributionInner() {
  const overview = useAssignmentOverview();
  const updateSettings = useUpdateAssignmentSettings();
  const runDistribution = useRunDistributionNow();
  const runReassignment = useRunReassignmentNow();

  const settings = overview.data?.settings;
  const stats = overview.data?.stats || {};

  function saveSetting(body: Record<string, boolean | number>) {
    updateSettings.mutate(body, {
      onSuccess: () => toast.success('Distribution settings updated'),
      onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Update failed'),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="text-slate-400 hover:text-slate-600">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <GitBranch className="h-5 w-5 text-brand-600" />
        <h1 className="text-lg font-semibold text-slate-900">Lead Auto Distribution</h1>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-900">Auto Distribution</h2>
            <p className="text-sm text-slate-500">Automatically assign new leads by round robin.</p>
            <p className="text-xs text-slate-500">Leads will be assigned only to active Members and Partners.</p>
            <p className="text-xs text-slate-500">Manual assignment and request approval will continue to work even when auto distribution is off.</p>
          </div>
          <label className="flex items-center gap-3 rounded-full border border-slate-200 px-3 py-2">
            <span className={clsx('text-sm font-medium', settings?.autoAssignEnabled ? 'text-emerald-700' : 'text-slate-600')}>
              {settings?.autoAssignEnabled ? 'ON' : 'OFF'}
            </span>
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={!!settings?.autoAssignEnabled}
              onChange={(e) => saveSetting({ autoAssignEnabled: e.target.checked })}
              disabled={updateSettings.isPending || overview.isLoading}
            />
          </label>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <InfoCard label="Current Method" value="Round Robin" hint="Readonly" />
          <InfoCard label="Unassigned Leads" value={String(stats.unassigned_leads ?? 0)} hint="Queue waiting for assignment" />
          <InfoCard
            label="Current State"
            value={settings?.autoAssignEnabled
              ? 'New leads will be assigned by round robin to active Members and Partners.'
              : 'New leads will remain unassigned until manually assigned or approved through a request.'}
          />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={() => runDistribution.mutate(undefined, {
              onSuccess: (data: any) => {
                const assigned = Number(data?.data?.request?.assigned || 0) + Number(data?.data?.auto?.assigned || 0);
                toast.success(assigned > 0 ? `Assigned ${assigned} lead(s)` : 'Distribution run completed');
              },
              onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Distribution run failed'),
            })}
            disabled={runDistribution.isPending}
            className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
          >
            {runDistribution.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run Distribution Now
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-900">Auto Reassignment</h2>
            <p className="text-sm text-slate-500">Reassign leads that have no meaningful contact activity after assignment.</p>
            <p className="text-xs text-slate-500">This setting is separate from auto distribution and remains off by default.</p>
          </div>
          <label className="flex items-center gap-3 rounded-full border border-slate-200 px-3 py-2">
            <span className={clsx('text-sm font-medium', settings?.autoReassignEnabled ? 'text-emerald-700' : 'text-slate-600')}>
              {settings?.autoReassignEnabled ? 'ON' : 'OFF'}
            </span>
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={!!settings?.autoReassignEnabled}
              onChange={(e) => saveSetting({ autoReassignEnabled: e.target.checked })}
              disabled={updateSettings.isPending || overview.isLoading}
            />
          </label>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <InfoCard label="Reassign After" value={`${settings?.reassignAfterHours ?? 24} hours`} />
          <InfoCard label="Reassigned Today" value={String(stats.reassigned_today ?? 0)} />
          <InfoCard label="Manual Reassigned Today" value={String(stats.manual_reassigned_today ?? 0)} />
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Not contacted after hours</span>
            <input
              type="number"
              min={1}
              defaultValue={settings?.reassignAfterHours ?? 24}
              onBlur={(e) => saveSetting({ reassignAfterHours: Math.max(1, Number(e.target.value) || 24) })}
              className="input mt-1 h-10 w-40"
            />
          </label>
          <button
            onClick={() => runReassignment.mutate(undefined, {
              onSuccess: (data: any) => toast.success(`Reassigned ${Number(data?.data?.reassigned || 0)} lead(s)`),
              onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Reassignment run failed'),
            })}
            disabled={runReassignment.isPending}
            className="btn-outline inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
          >
            {runReassignment.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Run Reassignment Now
          </button>
        </div>
      </section>
    </div>
  );
}

function InfoCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}
