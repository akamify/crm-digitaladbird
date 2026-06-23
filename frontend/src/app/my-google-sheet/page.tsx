'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Unplug,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, Modal, Skeleton } from '@/components/ui/Modal';
import {
  useCreateMyGoogleSheet,
  useDisconnectMyGoogleSheet,
  useMyGoogleSheetLogs,
  useMyGoogleSheetStatus,
  useSetupMyGoogleSheet,
  useStartMyGoogleOAuth,
  useSyncMyGoogleSheetNow,
} from '@/hooks/useMyGoogleSheets';
import { useAuth } from '@/lib/auth';
import { formatISTCompact } from '@/lib/date';
import { humanize } from '@/lib/format';

const DEFAULT_SHEET_NAME = 'DigitalADbird CRM Leads';

function message(error: unknown, fallback: string) {
  const payload = (error as { response?: { data?: { code?: string; message?: string } } })?.response?.data;
  if (payload?.code === 'GOOGLE_SHEETS_QUOTA_EXCEEDED') return 'Google Sheets quota reached. Please wait a few minutes and try again.';
  if (payload?.code === 'GOOGLE_SHEETS_SYNC_ALREADY_RUNNING') return 'A sync is already running. Please wait.';
  if (payload?.code === 'GOOGLE_OAUTH_NOT_CONFIGURED') return 'Google OAuth is not configured. Please contact admin.';
  if (payload?.code === 'GOOGLE_SHEETS_ACCESS_DENIED') return 'Google Sheets access was denied. Please reconnect your Google account.';
  return payload?.message || fallback;
}

export default function MyGoogleSheetPage() {
  return (
    <AppShell title="My Google Sheet" subtitle="Secure, role-scoped CRM lead synchronization" roles={['super_admin', 'admin', 'rm', 'member', 'partner']}>
      <MyGoogleSheetContent />
    </AppShell>
  );
}

function MyGoogleSheetContent() {
  const { user } = useAuth();
  const params = useSearchParams();
  const [logPage, setLogPage] = useState(1);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const status = useMyGoogleSheetStatus();
  const logs = useMyGoogleSheetLogs(logPage);
  const oauth = useStartMyGoogleOAuth();
  const create = useCreateMyGoogleSheet();
  const createTabs = useSetupMyGoogleSheet('create-missing-tabs');
  const fixHeaders = useSetupMyGoogleSheet('fix-headers');
  const sync = useSyncMyGoogleSheetNow();
  const disconnect = useDisconnectMyGoogleSheet();

  const data = status.data;
  const connected = !!data?.connected;
  const hasSheet = !!data?.spreadsheet_id;
  const setup = data?.setup;
  const tabsValid = setup?.tabs_valid !== false;
  const headersValid = setup?.headers_valid !== false;
  const needsSetup = connected && (!hasSheet || !tabsValid || !headersValid);
  const retryAfterTime = data?.retry_after_at ? new Date(data.retry_after_at).getTime() : 0;
  const inCooldown = !!retryAfterTime && retryAfterTime > now;
  const busy = oauth.isPending || create.isPending || createTabs.isPending || fixHeaders.isPending || sync.isPending || disconnect.isPending;
  const syncDisabled = busy || inCooldown;

  const roleText = useMemo(() => {
    if (user?.role === 'rm') return 'Only your team leads will sync.';
    if (user?.role === 'member' || user?.role === 'partner') return 'Only your assigned leads will sync.';
    return 'Your personal Google Sheet remains separate from the company master sheet.';
  }, [user?.role]);

  useEffect(() => {
    const state = params.get('googleSheets');
    const code = params.get('code');
    if (state === 'connected') toast.success('Google Sheet connected and leads synced successfully.');
    if (state === 'partial_setup') {
      toast.error(code === 'FIRST_SYNC_FAILED'
        ? 'Sheet connected, but first sync failed. Click Sync Leads to try again.'
        : 'Google account connected, but sheet setup needs attention.');
    }
    if (state === 'error') {
      toast.error(code === 'access_denied'
        ? 'Google blocked access because this OAuth app is still in testing or not verified.'
        : 'Google Sheet connection failed.');
    }
  }, [params]);

  useEffect(() => {
    if (!inCooldown) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [inCooldown]);

  function startOAuth() {
    oauth.mutate(undefined, {
      onSuccess: response => { window.location.href = response.url; },
      onError: error => toast.error(message(error, 'Could not start Google OAuth.')),
    });
  }

  function createSheet() {
    create.mutate(
      { spreadsheet_name: DEFAULT_SHEET_NAME },
      { onSuccess: () => toast.success('Google Sheet created successfully.'), onError: error => toast.error(message(error, 'Could not create Google Sheet.')) },
    );
  }

  function repairTabs() {
    createTabs.mutate(undefined, {
      onSuccess: () => toast.success('Missing tabs created.'),
      onError: error => toast.error(message(error, 'Could not create missing tabs.')),
    });
  }

  function repairHeaders() {
    fixHeaders.mutate(undefined, {
      onSuccess: () => toast.success('Headers fixed successfully.'),
      onError: error => toast.error(message(error, 'Could not fix headers.')),
    });
  }

  function syncLeads() {
    sync.mutate(undefined, {
      onSuccess: () => toast.success('Leads synced successfully.'),
      onError: error => toast.error(message(error, 'Sync failed.')),
    });
  }

  function confirmDisconnectSheet() {
    disconnect.mutate(undefined, {
      onSuccess: () => {
        setConfirmDisconnect(false);
        toast.success('Google Sheet disconnected.');
      },
      onError: error => toast.error(message(error, 'Disconnect failed.')),
    });
  }

  if (status.isLoading) return <Skeleton className="h-64" />;
  if (status.isError) {
    return <EmptyState title="Google Sheet status unavailable" description="Please refresh and try again." icon={<FileSpreadsheet className="h-6 w-6" />} />;
  }

  return (
    <div className="space-y-5">
      {params.get('googleSheets') === 'error' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <strong>Google account connection was blocked.</strong>
          <p className="mt-1">Google blocked access because this OAuth app is still in testing or not verified. Ask admin to add your Gmail as a Google OAuth test user, or complete Google app verification for production use.</p>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
              <h2 className="font-semibold text-slate-950">Personal Google Sheet</h2>
              <ConnectionBadge connected={connected} needsSetup={needsSetup} status={data?.status} />
            </div>
            <p className="mt-2 text-sm text-slate-600">{roleText}</p>
            {!connected && (
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                Connect your Google account. A new Google Sheet named {DEFAULT_SHEET_NAME} will be created automatically with required tabs and headers.
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {!connected ? (
              <button className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm" onClick={startOAuth} disabled={busy}>
                {oauth.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                Connect Sheet
              </button>
            ) : (
              <>
                {hasSheet && (
                  <button className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm" onClick={syncLeads} disabled={syncDisabled}>
                    {sync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    {sync.isPending ? 'Syncing...' : 'Sync Leads'}
                  </button>
                )}
                {data?.open_url && (
                  <a className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm" href={data.open_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                    Open Sheet
                  </a>
                )}
                <button className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600" onClick={() => setConfirmDisconnect(true)} disabled={busy}>
                  <Unplug className="h-4 w-4" />
                  Disconnect
                </button>
              </>
            )}
          </div>

        </div>

        {connected ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
            <Info label="Connection Status" value={inCooldown ? 'Quota cooldown' : needsSetup ? 'Needs setup' : data?.last_error ? 'Sync failed' : 'Connected'} />
            <Info label="Spreadsheet Name" value={data?.spreadsheet_name || 'Not created yet'} />
            <Info label="Last Sync" value={data?.last_sync_at ? formatISTCompact(data.last_sync_at) : 'Not synced yet'} />
            <Info label="Sync Enabled" value={data?.sync_enabled === false ? 'Disabled' : 'Enabled'} />
            <Info label="Auto Sync" value={data?.auto_sync_enabled === false ? 'Disabled' : 'Enabled'} />
            <Info label="Last Auto Sync" value={data?.last_auto_sync_at ? formatISTCompact(data.last_auto_sync_at) : 'Waiting for first auto sync'} />
          </div>
        ) : (
          <div className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            After connecting, CRM will create Leads, Traders, Partners, and Unknown Leads tabs, write the required headers, and sync your allowed leads.
          </div>
        )}

        {connected && data?.last_error && (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <div className="font-medium">{inCooldown ? 'Google Sheets quota reached.' : 'Last sync failed.'}</div>
            <p className="mt-1">{inCooldown ? 'Try again after a few minutes.' : data.last_error}</p>
            {inCooldown && data.retry_after_at && <p className="mt-1 text-xs">Retry after {formatISTCompact(data.retry_after_at)}.</p>}
          </div>
        )}

        {connected && needsSetup && (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-2 text-sm text-amber-950">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium">Google Sheet setup needs attention.</div>
                <p className="mt-1">Use only the action required below. Existing rows will not be deleted.</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {!hasSheet && (
                <button className="btn-primary rounded-lg px-4 py-2 text-sm" onClick={createSheet} disabled={busy}>
                  {create.isPending ? 'Creating...' : 'Create Sheet'}
                </button>
              )}
              {hasSheet && !tabsValid && (
                <button className="btn-outline rounded-lg px-4 py-2 text-sm" onClick={repairTabs} disabled={busy}>
                  {createTabs.isPending ? 'Creating...' : 'Create Missing Tabs'}
                </button>
              )}
              {hasSheet && tabsValid && !headersValid && (
                <button className="btn-outline rounded-lg px-4 py-2 text-sm" onClick={repairHeaders} disabled={busy}>
                  {fixHeaders.isPending ? 'Fixing...' : 'Fix Headers'}
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-950">Sync Logs</h2>
          {logs.isFetching && !logs.isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        </div>
        {logs.isLoading ? (
          <Skeleton className="mt-4 h-28" />
        ) : !logs.data?.data.length ? (
          <p className="mt-4 text-sm text-slate-500">No sync logs yet.</p>
        ) : (
          <div className="mt-3 divide-y divide-slate-100">
            {logs.data.data.map(log => (
              <div key={log.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium capitalize text-slate-900">{humanize(log.sync_type)}</div>
                  <div className="text-xs text-slate-500">
                    {log.started_at ? formatISTCompact(log.started_at) : 'Time not available'} · {log.records_synced || 0} synced · {log.records_failed || 0} failed
                  </div>
                  {log.error_message && <p className="mt-1 max-w-2xl truncate text-xs text-red-600" title={log.error_message}>{log.error_message}</p>}
                </div>
                <LogStatus status={log.status} />
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn-outline rounded-md px-3 py-1.5 text-xs" disabled={logPage === 1 || logs.isFetching} onClick={() => setLogPage(value => Math.max(1, value - 1))}>Previous</button>
          <button className="btn-outline rounded-md px-3 py-1.5 text-xs" disabled={!logs.data?.pagination.has_more || logs.isFetching} onClick={() => setLogPage(value => value + 1)}>Load More</button>
        </div>
      </section>

      <Modal
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        title="Disconnect Google Sheet?"
        description="This will disconnect your Google account from DigitalADbird CRM. Your Google Sheet will not be deleted, but future syncing will stop."
        footer={(
          <>
            <button className="btn-outline rounded-lg px-4 py-2 text-sm" onClick={() => setConfirmDisconnect(false)} disabled={disconnect.isPending}>Cancel</button>
            <button className="btn-primary rounded-lg bg-red-600 px-4 py-2 text-sm hover:bg-red-700" onClick={confirmDisconnectSheet} disabled={disconnect.isPending}>
              {disconnect.isPending ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </>
        )}
      >
        <p className="text-sm text-slate-600">You can reconnect later. The existing spreadsheet remains in your Google Drive.</p>
      </Modal>
    </div>
  );
}

function ConnectionBadge({ connected, needsSetup, status }: { connected: boolean; needsSetup: boolean; status?: string }) {
  if (!connected) return <span className="chip-slate"><XCircle className="mr-1 inline h-3 w-3" />Not connected</span>;
  if (status === 'needs_reconnect') return <span className="chip-red"><XCircle className="mr-1 inline h-3 w-3" />Needs reconnect</span>;
  if (status === 'quota_cooldown') return <span className="chip-amber"><AlertTriangle className="mr-1 inline h-3 w-3" />Quota cooldown</span>;
  if (status === 'sync_failed') return <span className="chip-amber"><AlertTriangle className="mr-1 inline h-3 w-3" />Sync failed</span>;
  if (needsSetup) return <span className="chip-amber"><AlertTriangle className="mr-1 inline h-3 w-3" />Needs setup</span>;
  return <span className="chip-green"><CheckCircle2 className="mr-1 inline h-3 w-3" />Connected</span>;
}

function LogStatus({ status }: { status: string }) {
  const normalized = String(status || 'started').toLowerCase();
  const className = normalized === 'success'
    ? 'chip-green'
    : normalized === 'failed'
      ? 'chip-red'
      : normalized === 'conflict' || normalized === 'partial'
        ? 'chip-amber'
        : 'chip-blue';
  return <span className={className}>{humanize(normalized)}</span>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-slate-900" title={value}>{value}</div>
    </div>
  );
}
