'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ScrollText, ArrowLeft, Search, Filter } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Skeleton, EmptyState } from '@/components/ui/Modal';
import { useActivityLogs } from '@/hooks/useAdmin';
import { fmtDate, clsx, humanize } from '@/lib/format';

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
          <option value="user">User</option>
          <option value="lead">Lead</option>
          <option value="campaign">Campaign</option>
          <option value="broadcast">Broadcast</option>
          <option value="auth">Auth</option>
          <option value="sheets">Sheets</option>
          <option value="distribution">Distribution</option>
        </select>
        <select className="input w-36" value={action} onChange={e => { setAction(e.target.value); setPage(1); }}>
          <option value="">All Actions</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
          <option value="login">Login</option>
          <option value="block">Block</option>
          <option value="unblock">Unblock</option>
          <option value="assign">Assign</option>
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
                <th className="py-2 pr-3 font-medium">IP</th>
                <th className="py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(log => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="py-3 pr-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(log.created_at, 'dd MMM HH:mm:ss')}</td>
                  <td className="py-3 pr-3 font-medium text-slate-900">{log.user_name || '—'}</td>
                  <td className="py-3 pr-3"><span className="chip-slate">{humanize(log.user_role)}</span></td>
                  <td className="py-3 pr-3"><span className={clsx('chip',
                    log.action.includes('create') ? 'chip-green' : log.action.includes('delete') ? 'chip-red' : log.action.includes('block') ? 'chip-red' : 'chip-blue'
                  )}>{humanize(log.action)}</span></td>
                  <td className="py-3 pr-3 text-slate-600">{log.entity}</td>
                  <td className="py-3 pr-3 text-xs text-slate-400 tabular-nums">{log.ip_address || '—'}</td>
                  <td className="py-3 text-xs text-slate-500 max-w-[200px] truncate">{log.metadata ? JSON.stringify(log.metadata).slice(0, 100) : '—'}</td>
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
