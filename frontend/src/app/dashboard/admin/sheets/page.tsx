'use client';
import Link from 'next/link';
import { FileSpreadsheet, ArrowLeft, RefreshCw, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Skeleton, EmptyState } from '@/components/ui/Modal';
import { useSheetsConfig, useTriggerSheetSync } from '@/hooks/useAdminEnterprise';
import { fmtDate, clsx } from '@/lib/format';

export default function SheetsPage() {
  return (
    <AppShell title="Google Sheets Control" subtitle="Manage sheet connections, sync settings, and logs" roles={['super_admin']}>
      <SheetsInner />
    </AppShell>
  );
}

function SheetsInner() {
  const { data, isLoading, refetch } = useSheetsConfig();
  const triggerSync = useTriggerSheetSync();

  if (isLoading) return <Skeleton className="h-64" />;
  if (!data) return <EmptyState title="No data" description="Could not load sheets config." icon={<FileSpreadsheet className="h-6 w-6" />} />;

  const { config, sync_logs } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="h-4 w-4" /></Link>
        <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
        <h1 className="text-lg font-semibold text-slate-900">Google Sheets</h1>
      </div>

      {/* Connection Status */}
      <div className="card-padded">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-900">Connection Status</h2>
          <div className="flex items-center gap-2">
            {config.configured ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
                <XCircle className="h-3.5 w-3.5" /> Not Configured
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoRow label="Sheet ID" value={config.sheet_id || 'Not set'} />
          <InfoRow label="Sheet Name" value={config.sheet_name} />
          <InfoRow label="Service Account" value={config.service_account_email || 'Not set'} />
          <InfoRow label="Key Path" value={config.key_path || 'Not set'} />
        </div>
      </div>

      {/* Sync Actions */}
      <div className="card-padded">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-900">Sync Actions</h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => triggerSync.mutate(undefined, {
              onSuccess: (d: any) => { toast.success(d.message || 'Sync triggered'); refetch(); },
              onError: () => toast.error('Sync failed'),
            })}
            disabled={triggerSync.isPending || !config.configured}
            className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2"
          >
            {triggerSync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Trigger Manual Sync
          </button>
          {config.sheet_id && (
            <a href={`https://docs.google.com/spreadsheets/d/${config.sheet_id}`} target="_blank" rel="noopener noreferrer"
              className="btn-outline rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" /> Open Sheet
            </a>
          )}
        </div>
      </div>

      {/* Sync Logs */}
      <div className="card-padded">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Sync Logs ({sync_logs.length})</h2>
        {sync_logs.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">No sync logs yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium">Action</th>
                  <th className="py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sync_logs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(log.created_at, 'dd MMM HH:mm')}</td>
                    <td className="py-2.5 pr-3"><span className="chip-blue">{log.action}</span></td>
                    <td className="py-2.5 text-xs text-slate-500 max-w-[300px] truncate">{log.metadata ? JSON.stringify(log.metadata) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-slate-900 truncate">{value}</div>
    </div>
  );
}
