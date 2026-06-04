'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ScrollText, ArrowLeft, Search, Filter } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Skeleton, EmptyState } from '@/components/ui/Modal';
import { useActivityLogs } from '@/hooks/useAdmin';
import { fmtDate, clsx, humanize } from '@/lib/format';

/**
 * Compact device label from a raw User-Agent header.
 * Returns something like "Chrome / Windows" or "Safari / iPhone".
 * Keeps the rendering cheap — full UA is still in `title=` for the column cell.
 */
function deviceFromUA(ua: string | null | undefined): string {
  if (!ua) return '';
  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua) || /Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari/.test(ua)) browser = 'Safari';
  else if (/curl\//i.test(ua)) browser = 'curl';
  else if (/Postman/i.test(ua)) browser = 'Postman';
  let os = '';
  if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = /iPad/.test(ua) ? 'iPad' : 'iPhone';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  return os ? `${browser} / ${os}` : browser;
}

export default function ActivityPage() {
  return (
    <AppShell title="Activity Logs" subtitle="Full audit trail of all system activity" roles={['super_admin']}>
      <ActivityInner />
    </AppShell>
  );
}

function ActivityInner() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const logs = useActivityLogs({ page, page_size: 25, entity: entity || undefined, action: action || undefined });

  const totalPages = Math.ceil((logs.data?.total ?? 0) / 25);

  const filtered = logs.data?.rows.filter(l =>
    !search || l.user_name?.toLowerCase().includes(search.toLowerCase()) || l.action?.toLowerCase().includes(search.toLowerCase()) || l.entity?.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="h-4 w-4" /></Link>
        <ScrollText className="h-5 w-5 text-brand-600" />
        <h1 className="text-lg font-semibold text-slate-900">Activity Logs</h1>
        <span className="chip-slate ml-1">{logs.data?.total ?? 0} entries</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input className="input pl-10" placeholder="Search user, action, entity..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-36" value={entity} onChange={e => { setEntity(e.target.value); setPage(1); }}>
          <option value="">All Entities</option>
          <option value="session">Session</option>
          <option value="user">User</option>
          <option value="lead">Lead</option>
          <option value="lead_request">Lead Request</option>
          <option value="lead_ingestion">Lead Ingest</option>
          <option value="meta_page">Meta Page</option>
          <option value="campaign">Campaign</option>
          <option value="broadcast">Broadcast</option>
          <option value="sheets">Sheets</option>
          <option value="distribution">Distribution</option>
        </select>
        <select className="input w-40" value={action} onChange={e => { setAction(e.target.value); setPage(1); }}>
          <option value="">All Actions</option>
          <option value="login">Login</option>
          <option value="logout">Logout</option>
          <option value="created">Created</option>
          <option value="reassigned">Reassigned</option>
          <option value="approved">Approved</option>
          <option value="partially_approved">Partially Approved</option>
          <option value="rejected">Rejected</option>
          <option value="remark_saved">Remark Saved</option>
          <option value="added_or_updated">Page Added/Updated</option>
          <option value="token_updated">Token Updated</option>
          <option value="block">Block</option>
          <option value="unblock">Unblock</option>
          <option value="delete">Delete</option>
        </select>
      </div>

      {/* Table */}
      {logs.isLoading ? <Skeleton className="h-96" /> : filtered.length === 0 ? (
        <EmptyState title="No activity logs" description="Activity will appear here as actions are performed." icon={<ScrollText className="h-6 w-6" />} />
      ) : (
        <div className="card-padded overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-medium">Time</th>
                <th className="py-2 pr-3 font-medium">User</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 pr-3 font-medium">Action</th>
                <th className="py-2 pr-3 font-medium">Entity</th>
                <th className="py-2 pr-3 font-medium">Old → New</th>
                <th className="py-2 pr-3 font-medium">IP / Device</th>
                <th className="py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(log => (
                <tr key={log.id} className="hover:bg-slate-50 align-top">
                  <td className="py-3 pr-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(log.created_at, 'dd MMM HH:mm:ss')}</td>
                  <td className="py-3 pr-3 font-medium text-slate-900 whitespace-nowrap">{log.user_name || '—'}</td>
                  <td className="py-3 pr-3"><span className="chip-slate">{humanize(log.user_role || '')}</span></td>
                  <td className="py-3 pr-3 whitespace-nowrap"><span className={clsx('chip',
                    /(create|approve|login)/.test(log.action) ? 'chip-green'
                    : /(delete|reject|logout|block)/.test(log.action) ? 'chip-red'
                    : /(reassign|update|partial)/.test(log.action) ? 'chip-amber'
                    : 'chip-blue'
                  )}>{humanize(log.action)}</span></td>
                  <td className="py-3 pr-3 text-slate-600">
                    <div>{humanize(log.entity || '')}</div>
                    {log.entity_id && <div className="text-[10px] text-slate-400 font-mono truncate max-w-[110px]" title={log.entity_id}>{log.entity_id.slice(0,8)}…</div>}
                  </td>
                  <td className="py-3 pr-3 text-xs text-slate-600 max-w-[180px]">
                    {(log.old_value || log.new_value) ? (
                      <div className="space-y-0.5">
                        {log.old_value && <div className="truncate" title={log.old_value}><span className="text-slate-400">−</span> {log.old_value}</div>}
                        {log.new_value && <div className="truncate font-medium text-slate-800" title={log.new_value}><span className="text-emerald-500">+</span> {log.new_value}</div>}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="py-3 pr-3 text-xs whitespace-nowrap">
                    <div className="text-slate-500 tabular-nums">{log.ip_address || '—'}</div>
                    {log.user_agent && <div className="text-[10px] text-slate-400 truncate max-w-[160px]" title={log.user_agent}>{deviceFromUA(log.user_agent)}</div>}
                  </td>
                  <td className="py-3 text-xs text-slate-500 max-w-[260px] truncate" title={log.metadata ? JSON.stringify(log.metadata) : ''}>
                    {log.metadata && Object.keys(log.metadata).length > 0 ? JSON.stringify(log.metadata).slice(0, 110) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="btn-ghost rounded-lg px-4 py-2 text-sm disabled:opacity-40">Previous</button>
          <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="btn-ghost rounded-lg px-4 py-2 text-sm disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
