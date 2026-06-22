'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, ExternalLink, FileSpreadsheet, Loader2, PlugZap, RefreshCw, Unplug, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, Skeleton } from '@/components/ui/Modal';
import {
  useConnectExistingMyGoogleSheet,
  useCreateMyGoogleSheet,
  useDisconnectMyGoogleSheet,
  useMyGoogleSheetLogs,
  useMyGoogleSheetStatus,
  useStartMyGoogleOAuth,
  useSyncMyGoogleSheetNow,
  useTestMyGoogleSheet,
  useUpdateMyGoogleSheetSettings,
  type MyGoogleSheetSyncLog,
} from '@/hooks/useMyGoogleSheets';
import { useAuth } from '@/lib/auth';
import { formatISTCompact } from '@/lib/date';

function errorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
}

export default function MyGoogleSheetPage() {
  return (
    <AppShell
      title="My Google Sheet"
      subtitle="Connect your Google account and sync only leads you are allowed to see"
      roles={['super_admin', 'admin', 'rm', 'member', 'partner']}
    >
      <MyGoogleSheetInner />
    </AppShell>
  );
}

function MyGoogleSheetInner() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const status = useMyGoogleSheetStatus();
  const logs = useMyGoogleSheetLogs();
  const startOAuth = useStartMyGoogleOAuth();
  const createSheet = useCreateMyGoogleSheet();
  const connectExisting = useConnectExistingMyGoogleSheet();
  const updateSettings = useUpdateMyGoogleSheetSettings();
  const testSheet = useTestMyGoogleSheet();
  const syncNow = useSyncMyGoogleSheetNow();
  const disconnect = useDisconnectMyGoogleSheet();
  const [sheetInput, setSheetInput] = useState('');
  const [form, setForm] = useState({
    default_sheet_name: 'Leads',
    trader_sheet_name: 'Traders',
    partner_sheet_name: 'Partners',
    unknown_sheet_name: 'Unknown Leads',
    sync_enabled: true,
  });

  const oauthError = searchParams.get('googleSheets') === 'error' ? searchParams.get('code') : null;

  useEffect(() => {
    const data = status.data;
    if (!data?.connected) return;
    setForm({
      default_sheet_name: data.default_sheet_name || 'Leads',
      trader_sheet_name: data.trader_sheet_name || 'Traders',
      partner_sheet_name: data.partner_sheet_name || 'Partners',
      unknown_sheet_name: data.unknown_sheet_name || 'Unknown Leads',
      sync_enabled: data.sync_enabled !== false,
    });
  }, [status.data]);

  const roleMessage = useMemo(() => {
    if (user?.role === 'rm') return 'Only leads assigned to members in your RM team will sync.';
    if (user?.role === 'member' || user?.role === 'partner') return 'Only leads assigned to you will sync.';
    return 'Your personal sheet is separate from the company master sheet.';
  }, [user?.role]);

  if (status.isLoading) return <Skeleton className="h-64" />;
  if (status.isError) {
    return <EmptyState title="Could not load Google Sheet status" description="Please try again." icon={<FileSpreadsheet className="h-6 w-6" />} />;
  }

  const connected = !!status.data?.connected;

  function handleConnect() {
    startOAuth.mutate(undefined, {
      onSuccess: ({ url }) => {
        window.location.href = url;
      },
      onError: (error) => toast.error(errorMessage(error, 'Could not start Google OAuth.')),
    });
  }

  function saveSettings() {
    updateSettings.mutate(form, {
      onSuccess: () => toast.success('My Google Sheet settings saved.'),
      onError: (error) => toast.error(errorMessage(error, 'Could not save settings.')),
    });
  }

  return (
    <div className="space-y-6">
      {oauthError && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-semibold">Google account connection was blocked</div>
          <p className="mt-1">Google blocked access because this OAuth app is still in testing or not verified. Ask admin to add your Gmail as a Google OAuth test user, or complete Google app verification for production use.</p>
        </div>
      )}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
              <h2 className="text-base font-semibold text-slate-900">Personal Google Sheet</h2>
              {connected ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                  <XCircle className="h-3.5 w-3.5" /> Not connected
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-slate-600">{roleMessage}</p>
            {status.data?.last_error && <p className="mt-2 text-sm text-red-600">{status.data.last_error}</p>}
          </div>

          <div className="flex flex-wrap gap-2">
            {!connected && (
              <button type="button" onClick={handleConnect} disabled={startOAuth.isPending} className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
                {startOAuth.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                Connect Google Account
              </button>
            )}
            {connected && status.data?.open_url && (
              <a href={status.data.open_url} target="_blank" rel="noopener noreferrer" className="btn-outline rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
                <ExternalLink className="h-4 w-4" /> Open Sheet
              </a>
            )}
          </div>
        </div>

        {connected && (
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Info label="Google Account" value={status.data?.google_email || 'Connected account'} />
            <Info label="Spreadsheet" value={status.data?.spreadsheet_name || status.data?.spreadsheet_id || 'Not selected'} />
            <Info label="Last Sync" value={status.data?.last_sync_at ? formatISTCompact(status.data.last_sync_at) : 'Not synced yet'} />
            <Info label="Sync" value={status.data?.sync_enabled === false ? 'Disabled' : 'Enabled'} />
          </div>
        )}
      </div>

      {connected && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Sheet Setup</h3>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <input className="input" placeholder="Existing spreadsheet URL or ID" value={sheetInput} onChange={(e) => setSheetInput(e.target.value)} />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => createSheet.mutate('DigitalADbird CRM Leads', {
                    onSuccess: () => toast.success('New CRM sheet created.'),
                    onError: (error) => toast.error(errorMessage(error, 'Could not create sheet.')),
                  })}
                  disabled={createSheet.isPending}
                  className="btn-outline flex-1 rounded-lg px-4 py-2 text-sm"
                >
                  Create New CRM Sheet
                </button>
                <button
                  type="button"
                  onClick={() => connectExisting.mutate(sheetInput, {
                    onSuccess: () => toast.success('Existing sheet connected.'),
                    onError: (error) => toast.error(errorMessage(error, 'Could not connect sheet.')),
                  })}
                  disabled={connectExisting.isPending || !sheetInput.trim()}
                  className="btn-primary flex-1 rounded-lg px-4 py-2 text-sm"
                >
                  Connect Existing
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Tab Names</h3>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Default Sheet" value={form.default_sheet_name} onChange={(value) => setForm(prev => ({ ...prev, default_sheet_name: value }))} />
              <Field label="Traders Sheet" value={form.trader_sheet_name} onChange={(value) => setForm(prev => ({ ...prev, trader_sheet_name: value }))} />
              <Field label="Partners Sheet" value={form.partner_sheet_name} onChange={(value) => setForm(prev => ({ ...prev, partner_sheet_name: value }))} />
              <Field label="Unknown Sheet" value={form.unknown_sheet_name} onChange={(value) => setForm(prev => ({ ...prev, unknown_sheet_name: value }))} />
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.sync_enabled} onChange={(e) => setForm(prev => ({ ...prev, sync_enabled: e.target.checked }))} />
              Enable sync for this connection
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={saveSettings} disabled={updateSettings.isPending} className="btn-primary rounded-lg px-4 py-2 text-sm">Save Settings</button>
              <button
                type="button"
                onClick={() => testSheet.mutate(undefined, {
                  onSuccess: () => toast.success('Google Sheet test completed.'),
                  onError: (error) => toast.error(errorMessage(error, 'Google Sheet test failed.')),
                })}
                disabled={testSheet.isPending || !status.data?.spreadsheet_id}
                className="btn-outline rounded-lg px-4 py-2 text-sm"
              >
                Test Connection
              </button>
              <button
                type="button"
                onClick={() => syncNow.mutate(undefined, {
                  onSuccess: () => toast.success('Your leads synced to Google Sheets.'),
                  onError: (error) => toast.error(errorMessage(error, 'Sync failed.')),
                })}
                disabled={syncNow.isPending || !status.data?.spreadsheet_id}
                className="btn-outline rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2"
              >
                {syncNow.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Sync My Leads Now
              </button>
              <button
                type="button"
                onClick={() => disconnect.mutate(undefined, {
                  onSuccess: () => toast.success('Google Sheet disconnected.'),
                  onError: (error) => toast.error(errorMessage(error, 'Disconnect failed.')),
                })}
                disabled={disconnect.isPending}
                className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 inline-flex items-center gap-2"
              >
                <Unplug className="h-4 w-4" /> Disconnect
              </button>
            </div>
          </div>
        </>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Sync Logs</h3>
        {logs.isLoading ? <Skeleton className="mt-4 h-24" /> : (logs.data?.data || []).length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No personal sheet sync logs yet.</p>
        ) : (
          <div className="mt-3 divide-y divide-slate-100">
            {(logs.data?.data || []).map((log: MyGoogleSheetSyncLog) => (
              <div key={log.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <div className="font-medium text-slate-900">{log.sync_type}</div>
                  <div className="text-xs text-slate-500">{formatISTCompact(log.started_at)} · {log.records_synced || 0} synced</div>
                </div>
                <span className={log.status === 'success' ? 'chip-green' : log.status === 'failed' ? 'chip-red' : 'chip-blue'}>{log.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
