'use client';

import Link from 'next/link';
import { ArrowLeft, GitBranch, Loader2, Play, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { useAssignmentOverview, useRunDistributionNow, useRunReassignmentNow, useUpdateAssignmentSettings } from '@/hooks/useAdminEnterprise';
import { clsx } from '@/lib/format';
import { formatISTDateTime } from '@/lib/date';

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
  const [scheduledTime, setScheduledTime] = useState('');
  const [maxLeads, setMaxLeads] = useState(100);

  useEffect(() => {
    if (!settings) return;
    setScheduledTime(settings.scheduledAssignmentTime || '');
    setMaxLeads(Number(settings.maxLeadsPerScheduledRun || settings.assignmentTickLimit || 100));
  }, [settings]);

  function errorMessage(error: unknown, fallback: string) {
    const payload = error as { response?: { data?: { error?: { message?: string } } } };
    return payload.response?.data?.error?.message || fallback;
  }

  function saveSetting(body: Record<string, boolean | number | string>) {
    updateSettings.mutate(body, {
      onSuccess: () => toast.success('Distribution settings updated'),
      onError: (error) => toast.error(errorMessage(error, 'Update failed')),
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
            <h2 className="text-sm font-semibold text-slate-900">Scheduled Lead Assignment</h2>
            <p className="text-sm text-slate-500">Saved leads are assigned once per day at the configured IST time.</p>
            <p className="text-xs text-slate-500">Leads are first divided among eligible RMs, then each RM&apos;s leads are assigned to available team members using round robin.</p>
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
          <InfoCard label="Current Method" value="RM Team Round Robin" hint="Readonly" />
          <InfoCard label="Unassigned Leads" value={String(stats.unassigned_leads ?? 0)} hint="Queue waiting for assignment" />
          <InfoCard label="Eligible RMs" value={String(stats.eligible_rms ?? 0)} hint="RMs with available team members" />
          <InfoCard label="Available team members" value={String(stats.available_team_members ?? 0)} hint="Members and partners only" />
          <InfoCard
            label="Current State"
            value={settings?.autoAssignEnabled
              ? `Saved leads will be assigned daily at ${settings.scheduledAssignmentTime || 'not set'} IST.`
              : 'Scheduled assignment is disabled. Saved leads will not auto-assign.'}
          />
          <InfoCard label="Last Run" value={settings?.lastScheduledRunAt ? formatISTDateTime(settings.lastScheduledRunAt) : 'Not run yet'} />
          <InfoCard label="Last Result" value={settings?.lastDistributionStatus || 'Not available'} />
          <InfoCard label="Last Error" value={settings?.lastDistributionError || 'No error'} />
        </div>

        {Number(stats.unassigned_leads || 0) === 0 && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            No saved/unassigned leads are waiting for distribution.
          </div>
        )}
        {Number(stats.eligible_rms || 0) === 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No eligible RMs with available team members were found. Scheduled distribution will not assign leads.
          </div>
        )}

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Assignment Time</span>
            <input
              type="time"
              value={scheduledTime}
              onChange={(event) => setScheduledTime(event.target.value)}
              className="input mt-1 h-10"
            />
            <span className="mt-1 block text-xs text-slate-400">Timezone: Asia/Kolkata (IST)</span>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Max leads per run</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={maxLeads}
              onChange={(event) => setMaxLeads(Math.max(1, Number(event.target.value) || 1))}
              className="input mt-1 h-10"
            />
          </label>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Eligible users</div>
            <div className="mt-1 text-sm font-medium text-slate-900">Members and Partners</div>
            <div className="mt-1 text-xs text-slate-500">RM, Admin, and Super Admin are excluded.</div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={() => saveSetting({
              scheduledAssignmentTime: scheduledTime,
              scheduledTimezone: 'Asia/Kolkata',
              maxLeadsPerScheduledRun: maxLeads,
            })}
            disabled={updateSettings.isPending || overview.isLoading}
            className="btn-outline inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
          >
            {updateSettings.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save Settings
          </button>
          <button
            onClick={() => runDistribution.mutate(undefined, {
              onSuccess: (data: unknown) => {
                const payload = data as { data?: { assigned?: number }; assigned?: number };
                const assigned = Number(payload?.data?.assigned || payload?.assigned || 0);
                toast.success(assigned > 0 ? `Assigned ${assigned} lead(s)` : 'Distribution run completed');
              },
              onError: (error) => toast.error(errorMessage(error, 'Distribution run failed')),
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
              onSuccess: (data: unknown) => {
                const payload = data as { data?: { reassigned?: number } };
                toast.success(`Reassigned ${Number(payload?.data?.reassigned || 0)} lead(s)`);
              },
              onError: (error) => toast.error(errorMessage(error, 'Reassignment run failed')),
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
