'use client';

import { useState } from 'react';
import { ExternalLink, Eye, FileSpreadsheet, Loader2, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal, Skeleton } from '@/components/ui/Modal';
import { formatISTCompact } from '@/lib/date';
import { humanize } from '@/lib/format';
import {
  useAdminSyncUserSheet,
  useAdminTestUserSheet,
  useAdminUserSheetConnections,
  useAdminUserSheetLogs,
  useAdminUserSheetPreview,
  type UserSheetConnection,
} from '@/hooks/useAdminUserGoogleSheets';
import { useMyGoogleSheetStatus } from '@/hooks/useMyGoogleSheets';

function errorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
}

function shortId(value?: string | null) {
  if (!value) return 'Not selected';
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

export function MyGoogleSheetProfileCard() {
  const status = useMyGoogleSheetStatus();
  if (status.isLoading) return <Skeleton className="h-28" />;
  const connection = status.data;
  return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-emerald-600" /><h2 className="font-semibold text-slate-900">Google Sheet Connection</h2></div><p className="mt-1 text-sm text-slate-500">{connection?.connected ? `${connection.google_email || 'Google account'} connected` : 'No personal Google account connected.'}</p></div><a href="/my-google-sheet" className="btn-outline rounded-lg px-3 py-2 text-sm">{connection?.connected ? 'Manage My Sheet' : 'Connect Google'}</a></div>
    {connection?.connected && <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><div><span className="text-slate-500">Spreadsheet: </span>{connection.spreadsheet_name || 'Not selected'}</div><div><span className="text-slate-500">Last sync: </span>{connection.last_sync_at ? formatISTCompact(connection.last_sync_at) : 'Never'}</div><div><span className="text-slate-500">Sync: </span>{connection.sync_enabled === false ? 'Disabled' : 'Enabled'}</div></div>}
  </section>;
}

export function AdminUserGoogleSheets({ userId }: { userId?: string }) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<UserSheetConnection | null>(null);
  const connections = useAdminUserSheetConnections({ page, search, role, status, user_id: userId });
  const logs = useAdminUserSheetLogs(userId);
  const test = useAdminTestUserSheet();
  const sync = useAdminSyncUserSheet();
  const rows = connections.data?.data || [];

  function runTest(id: string) {
    test.mutate(id, {
      onSuccess: () => toast.success('User Google Sheet connection is ready.'),
      onError: error => toast.error(errorMessage(error, 'Connection test failed.')),
    });
  }

  function runSync(id: string) {
    sync.mutate(id, {
      onSuccess: () => toast.success('Owner-scoped leads synced successfully.'),
      onError: error => toast.error(errorMessage(error, 'User sheet sync failed.')),
    });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-emerald-600" /><h2 className="font-semibold text-slate-900">User Google Sheets</h2></div>
          <p className="mt-1 text-xs text-slate-500">Opening a sheet uses your browser Google account. Preview and Sync use the user&apos;s authorized OAuth connection.</p>
        </div>
      </div>

      {!userId && (
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="relative min-w-52 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className="input pl-9" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Search user or Google email" /></div>
          <select className="input w-40" value={role} onChange={event => { setRole(event.target.value); setPage(1); }}><option value="">All roles</option><option value="rm">RM</option><option value="member">Member</option><option value="partner">Partner</option></select>
          <select className="input w-44" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option value="connected">Connected</option><option value="needs_reconnect">Needs reconnect</option><option value="disconnected">Disconnected</option></select>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <ShieldAlert className="mr-1 inline h-4 w-4" /> During Google OAuth testing, every RM/member Gmail must be added in Google Cloud Console under OAuth consent screen, Test users. Public access requires publishing and Google verification.
      </div>

      {connections.isLoading ? <Skeleton className="mt-4 h-40" /> : !rows.length ? (
        <p className="mt-4 py-8 text-center text-sm text-slate-500">No Google Sheet connections found.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1050px] w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-slate-500"><th className="p-2">User</th><th className="p-2">RM / Team</th><th className="p-2">Google account</th><th className="p-2">Spreadsheet</th><th className="p-2">Sync</th><th className="p-2">Last sync</th><th className="p-2">Status</th><th className="p-2 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map(connection => (
              <tr key={connection.id} className="align-top hover:bg-slate-50">
                <td className="p-2"><div className="font-medium text-slate-900">{connection.user_name}</div><div className="text-xs text-slate-500">{humanize(connection.role)}</div></td>
                <td className="p-2 text-xs text-slate-600">{connection.rm_name || connection.team_name || 'Not available'}</td>
                <td className="p-2 text-xs text-slate-600">{connection.google_email || 'Not available'}</td>
                <td className="p-2"><div className="max-w-44 truncate text-xs font-medium">{connection.spreadsheet_name || 'Not selected'}</div><div title={connection.spreadsheet_id || ''} className="text-[11px] text-slate-500">{shortId(connection.spreadsheet_id)}</div></td>
                <td className="p-2 text-xs">{connection.sync_enabled ? 'Enabled' : 'Disabled'}</td>
                <td className="p-2 text-xs text-slate-500">{connection.last_sync_at ? formatISTCompact(connection.last_sync_at) : 'Never'}</td>
                <td className="p-2"><span className={connection.status === 'connected' ? 'chip-green' : connection.status === 'needs_reconnect' ? 'chip-red' : 'chip-slate'}>{humanize(connection.status)}</span>{connection.last_error && <div title={connection.last_error} className="mt-1 max-w-40 truncate text-[11px] text-red-600">{connection.last_error}</div>}</td>
                <td className="p-2"><div className="flex justify-end gap-1">
                  {connection.spreadsheet_id && <a title="Open Sheet" href={`https://docs.google.com/spreadsheets/d/${connection.spreadsheet_id}/edit`} target="_blank" rel="noopener noreferrer" className="rounded-md p-2 hover:bg-slate-100"><ExternalLink className="h-4 w-4" /></a>}
                  <button title="Preview Data" onClick={() => setPreview(connection)} disabled={!connection.spreadsheet_id} className="rounded-md p-2 hover:bg-slate-100 disabled:opacity-40"><Eye className="h-4 w-4" /></button>
                  <button title="Test Connection" onClick={() => runTest(connection.id)} disabled={test.isPending} className="rounded-md p-2 hover:bg-slate-100"><RefreshCw className="h-4 w-4" /></button>
                  <button title="Sync Now" onClick={() => runSync(connection.id)} disabled={sync.isPending || connection.status !== 'connected'} className="rounded-md p-2 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">{sync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {!userId && connections.data?.pagination && connections.data.pagination.total_pages > 1 && <div className="mt-3 flex items-center justify-end gap-2"><button className="btn-outline rounded-md px-3 py-1.5 text-xs" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><span className="text-xs text-slate-500">Page {page} of {connections.data.pagination.total_pages}</span><button className="btn-outline rounded-md px-3 py-1.5 text-xs" disabled={!connections.data.pagination.has_more} onClick={() => setPage(value => value + 1)}>Next</button></div>}
      <div className="mt-5 border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">Recent Sync Logs</h3>
        {logs.isLoading ? <Skeleton className="mt-3 h-24" /> : !(logs.data?.data || []).length ? <p className="mt-3 text-sm text-slate-500">No user sheet sync logs found.</p> : <div className="mt-2 overflow-x-auto"><table className="min-w-[760px] w-full text-xs"><thead><tr className="border-b text-left text-slate-500"><th className="p-2">Time</th>{!userId && <th className="p-2">User</th>}<th className="p-2">Type</th><th className="p-2">Status</th><th className="p-2">Attempted</th><th className="p-2">Synced</th><th className="p-2">Failed</th><th className="p-2">Error</th></tr></thead><tbody className="divide-y divide-slate-100">{(logs.data?.data || []).map(log => <tr key={log.id}><td className="p-2 text-slate-500">{log.started_at ? formatISTCompact(log.started_at) : 'Not available'}</td>{!userId && <td className="p-2">{log.user_name || 'System'}</td>}<td className="p-2">{humanize(log.sync_type)}</td><td className="p-2"><span className={log.status === 'success' ? 'chip-green' : log.status === 'failed' ? 'chip-red' : 'chip-blue'}>{humanize(log.status)}</span></td><td className="p-2">{log.records_attempted || 0}</td><td className="p-2">{log.records_synced || 0}</td><td className="p-2">{log.records_failed || 0}</td><td title={log.error_message || ''} className="max-w-52 truncate p-2 text-red-600">{log.error_message || '-'}</td></tr>)}</tbody></table></div>}
      </div>
      <UserSheetPreviewModal connection={preview} onClose={() => setPreview(null)} onSync={runSync} onTest={runTest} />
    </section>
  );
}

function UserSheetPreviewModal({ connection, onClose, onSync, onTest }: { connection: UserSheetConnection | null; onClose: () => void; onSync: (id: string) => void; onTest: (id: string) => void }) {
  const [sheetName, setSheetName] = useState('Leads');
  const [page, setPage] = useState(1);
  const preview = useAdminUserSheetPreview(connection?.id || null, sheetName, page);
  const data = preview.data;
  return <Modal open={!!connection} onClose={onClose} title={`${connection?.user_name || 'User'} Google Sheet`} size="xl">
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><select className="input w-48" value={sheetName} onChange={event => { setSheetName(event.target.value); setPage(1); }}>{[connection?.default_sheet_name || 'Leads', connection?.trader_sheet_name || 'Traders', connection?.partner_sheet_name || 'Partners', connection?.unknown_sheet_name || 'Unknown Leads'].map(name => <option key={name} value={name}>{name}</option>)}</select>{connection && <><button className="btn-outline rounded-lg px-3 py-2 text-sm" onClick={() => onTest(connection.id)}>Test</button><button className="btn-outline rounded-lg px-3 py-2 text-sm" onClick={() => onSync(connection.id)}>Sync Now</button>{connection.spreadsheet_id && <a className="btn-outline rounded-lg px-3 py-2 text-sm" target="_blank" rel="noopener noreferrer" href={`https://docs.google.com/spreadsheets/d/${connection.spreadsheet_id}/edit`}>Open Sheet</a>}</>}</div>
      {preview.isLoading ? <Skeleton className="h-52" /> : preview.isError ? <p className="py-8 text-center text-sm text-red-600">{errorMessage(preview.error, 'Could not preview this sheet.')}</p> : <div className="max-h-[55vh] overflow-auto rounded-lg border"><table className="min-w-max w-full text-xs"><thead className="sticky top-0 bg-slate-50"><tr>{(data?.headers || []).map(header => <th key={header} className="border-b p-2 text-left font-medium text-slate-600">{header}</th>)}</tr></thead><tbody>{(data?.rows || []).map((row, index) => <tr key={`${page}-${index}`} className="border-b last:border-0">{(data?.headers || []).map(header => <td key={header} className="max-w-52 truncate p-2" title={row[header]}>{row[header] || '-'}</td>)}</tr>)}</tbody></table>{!data?.rows.length && <p className="p-8 text-center text-sm text-slate-500">No rows found.</p>}</div>}
      <div className="flex justify-end gap-2"><button className="btn-outline rounded-md px-3 py-1.5 text-xs" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><button className="btn-outline rounded-md px-3 py-1.5 text-xs" disabled={!data?.pagination.has_more} onClick={() => setPage(value => value + 1)}>Load More</button></div>
    </div>
  </Modal>;
}
