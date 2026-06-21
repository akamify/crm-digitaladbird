'use client';

import Link from 'next/link';
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Loader2, RefreshCw, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, Skeleton } from '@/components/ui/Modal';
import { useSheetsConfig, useTriggerSheetSync } from '@/hooks/useAdminEnterprise';
import { formatISTCompact, formatISTDateTime } from '@/lib/date';

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

      <div className="card-padded">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Connection Status</h2>
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoRow label="Sheet ID" value={config.sheet_id || 'Not set'} />
          <InfoRow label="Default Sheet Name" value={config.sheet_name || 'Not set'} />
          <InfoRow label="Service Account" value={config.service_account_email || 'Not set'} />
          <InfoRow label="Key Path" value={config.key_path || 'Not set'} />
        </div>
      </div>

      <div className="card-padded">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Sync Actions</h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => triggerSync.mutate(undefined, {
              onSuccess: (response: any) => { toast.success(response.message || 'Sync triggered'); refetch(); },
              onError: () => toast.error('Sync failed'),
            })}
            disabled={triggerSync.isPending || !config.configured}
            className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2"
          >
            {triggerSync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Trigger Manual Sync
          </button>
          {config.sheet_id && (
            <a
              href={`https://docs.google.com/spreadsheets/d/${config.sheet_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2"
            >
              <FileSpreadsheet className="h-4 w-4" /> Open Sheet
            </a>
          )}
        </div>
      </div>

      <div className="card-padded">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Sync Logs ({sync_logs.length})</h2>
        {sync_logs.length === 0 ? (
          <EmptyState title="No sync history found yet." description="Google Sheet sync activity will appear here after imports or exports run." icon={<FileSpreadsheet className="h-6 w-6" />} />
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
                {sync_logs.slice(0, 10).map((log: any) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-3 text-xs text-slate-500 whitespace-nowrap" title={formatISTDateTime(log.created_at)}>{formatISTCompact(log.created_at)}</td>
                    <td className="py-2.5 pr-3"><span className="chip-blue">{log.action}</span></td>
                    <td className="py-2.5 text-xs text-slate-500">
                      {log.metadata ? (
                        <details>
                          <summary className="cursor-pointer list-none text-brand-700 hover:text-brand-800">View details</summary>
                          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">{JSON.stringify(log.metadata, null, 2)}</pre>
                        </details>
                      ) : '—'}
                    </td>
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
      <div className="mt-0.5 truncate text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}
