'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  Briefcase, ArrowLeft, Search, Filter, Download, Trash2, ArrowRightLeft,
  Loader2, Eye, CheckCircle2, Clock, XCircle, ChevronLeft, ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Modal, Skeleton, EmptyState } from '@/components/ui/Modal';
import { LeadActions } from '@/components/leads/LeadActions';
import { useLeadList } from '@/hooks/useLeads';
import { useBulkLeadAction, useForceAssign, useActiveMembers, exportLeadsCsv } from '@/hooks/useAdmin';
import { fmtDate, fmtRelative, clsx, humanize, isOverdue } from '@/lib/format';
import type { LeadFilters, Lead } from '@/types';

export default function LeadsManagerPage() {
  return (
    <AppShell title="Lead Management" subtitle="View, filter, bulk-edit, and export all leads" roles={['super_admin']}>
      <LeadsInner />
    </AppShell>
  );
}

function LeadsInner() {
  const [filters, setFilters] = useState<LeadFilters>({ page: 1, page_size: 25 });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [targetUser, setTargetUser] = useState('');
  const [exporting, setExporting] = useState(false);

  const leads = useLeadList({ ...filters, q: search || undefined });
  const members = useActiveMembers();
  const bulkAction = useBulkLeadAction();
  const forceAssign = useForceAssign();

  const rows = leads.data?.rows ?? [];
  const total = leads.data?.total ?? 0;
  const totalPages = Math.ceil(total / (filters.page_size || 25));
  const currentPage = filters.page || 1;

  function toggleSelect(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function selectAll() {
    if (selected.length === rows.length) setSelected([]);
    else setSelected(rows.map(l => l.id));
  }

  function handleBulkAction(action: string) {
    if (selected.length === 0) { toast.error('Select leads first'); return; }
    if (action === 'delete' && !confirm(`Delete ${selected.length} lead(s)?`)) return;
    bulkAction.mutate({ action, lead_ids: selected }, {
      onSuccess: (d: any) => { toast.success(d.message || `${action} done`); setSelected([]); },
      onError: () => toast.error('Action failed'),
    });
  }

  function handleAssign() {
    if (!targetUser || selected.length === 0) return;
    forceAssign.mutate({ lead_ids: selected, user_id: targetUser }, {
      onSuccess: (d: any) => { toast.success(`${d.assigned} leads assigned`); setSelected([]); setAssignOpen(false); setTargetUser(''); },
      onError: () => toast.error('Assign failed'),
    });
  }

  async function handleExport() {
    setExporting(true);
    try {
      const f: Record<string, string> = {};
      if (filters.stage) f.stage = filters.stage;
      if (filters.call_status) f.call_status = filters.call_status;
      if (filters.source) f.source = filters.source;
      if (filters.category) f.category = filters.category;
      await exportLeadsCsv(f);
      toast.success('CSV downloaded');
    } catch { toast.error('Export failed'); }
    setExporting(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="h-4 w-4" /></Link>
        <Briefcase className="h-5 w-5 text-brand-600" />
        <h1 className="text-lg font-semibold text-slate-900">All Leads</h1>
        <span className="chip-slate ml-1">{total.toLocaleString()} total</span>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input className="input pl-10" placeholder="Search name, phone, email..." value={search}
            onChange={e => { setSearch(e.target.value); setFilters(f => ({ ...f, page: 1 })); }} />
        </div>
        <select className="input w-32" value={filters.stage || ''} onChange={e => setFilters(f => ({ ...f, stage: e.target.value as any, page: 1 }))}>
          <option value="">All Stages</option>
          <option value="new">New</option><option value="contacted">Contacted</option><option value="qualified">Qualified</option>
          <option value="follow_up">Follow-up</option><option value="won">Won</option><option value="lost">Lost</option>
        </select>
        <select className="input w-32" value={filters.call_status || ''} onChange={e => setFilters(f => ({ ...f, call_status: e.target.value as any, page: 1 }))}>
          <option value="">All Status</option>
          <option value="not_called">Not Called</option><option value="interested">Interested</option><option value="converted">Converted</option>
          <option value="not_interested">Not Interested</option><option value="follow_up">Follow-up</option><option value="busy">Busy</option>
        </select>
        <select className="input w-32" value={filters.category || ''} onChange={e => setFilters(f => ({ ...f, category: e.target.value as any, page: 1 }))}>
          <option value="">All Categories</option><option value="partner">Partner</option><option value="trader">Trader</option>
        </select>
        <select className="input w-32" value={filters.pending || ''} onChange={e => setFilters(f => ({ ...f, pending: e.target.value as any, page: 1 }))}>
          <option value="">Assigned</option><option value="true">Pending Only</option><option value="false">Worked Only</option>
        </select>
      </div>

      {/* Bulk actions bar */}
      {selected.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
          <span className="text-sm font-medium text-brand-800">{selected.length} selected</span>
          <button onClick={() => setAssignOpen(true)} className="btn-primary rounded-lg px-3 py-1.5 text-xs inline-flex items-center gap-1.5">
            <ArrowRightLeft className="h-3.5 w-3.5" /> Assign
          </button>
          <button onClick={() => handleBulkAction('unassign')} className="btn-outline rounded-lg px-3 py-1.5 text-xs">Unassign</button>
          <button onClick={() => handleBulkAction('delete')} className="btn-danger rounded-lg px-3 py-1.5 text-xs inline-flex items-center gap-1.5">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          <button onClick={() => setSelected([])} className="ml-auto text-xs text-slate-500 hover:text-slate-700">Clear</button>
        </div>
      )}

      {/* Export */}
      <div className="flex justify-end">
        <button onClick={handleExport} disabled={exporting} className="btn-outline rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export CSV
        </button>
      </div>

      {/* Table */}
      {leads.isLoading ? <Skeleton className="h-64" /> : rows.length === 0 ? (
        <EmptyState title="No leads found" description="Adjust filters or wait for new leads." icon={<Briefcase className="h-6 w-6" />} />
      ) : (
        <div className="card-padded overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-2 font-medium"><input type="checkbox" checked={selected.length === rows.length && rows.length > 0} onChange={selectAll} className="rounded border-slate-300" /></th>
                <th className="py-2 pr-3 font-medium">Lead</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pr-3 font-medium">Stage</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Assigned To</th>
                <th className="py-2 pr-3 font-medium">Follow-up</th>
                <th className="py-2 pr-3 font-medium">Created</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(l => (
                <tr key={l.id} className={clsx('hover:bg-slate-50 transition', selected.includes(l.id) && 'bg-brand-50')}>
                  <td className="py-3 pr-2"><input type="checkbox" checked={selected.includes(l.id)} onChange={() => toggleSelect(l.id)} className="rounded border-slate-300" /></td>
                  <td className="py-3 pr-3">
                    <Link href={`/leads/${l.id}`} className="hover:text-brand-600">
                      <div className="font-medium text-slate-900">{l.full_name || 'Unnamed'}</div>
                      <div className="text-xs text-slate-500">{l.phone || '—'} {l.email ? `· ${l.email}` : ''}</div>
                    </Link>
                  </td>
                  <td className="py-3 pr-3 text-xs text-slate-600">{humanize(l.source || 'manual')}{l.campaign_name ? <div className="text-slate-400 truncate max-w-[100px]">{l.campaign_name}</div> : null}</td>
                  <td className="py-3 pr-3"><span className={clsx('chip', l.stage === 'won' ? 'chip-green' : l.stage === 'lost' ? 'chip-red' : 'chip-slate')}>{humanize(l.stage)}</span></td>
                  <td className="py-3 pr-3"><span className={clsx('chip', l.call_status === 'converted' ? 'chip-green' : l.call_status === 'not_called' ? 'chip-amber' : l.call_status === 'interested' ? 'chip-blue' : 'chip-slate')}>{humanize(l.call_status)}</span></td>
                  <td className="py-3 pr-3 text-xs text-slate-600">{l.assigned_to_name || <span className="text-amber-600">Unassigned</span>}</td>
                  <td className="py-3 pr-3 text-xs">{l.next_followup_at ? <span className={isOverdue(l.next_followup_at) ? 'text-rose-600 font-medium' : 'text-slate-500'}>{fmtRelative(l.next_followup_at)}</span> : '—'}</td>
                  <td className="py-3 pr-3 text-xs text-slate-500">{fmtDate(l.created_at, 'dd MMM')}</td>
                  <td className="py-3"><LeadActions phone={l.phone} email={l.email} name={l.full_name} compact /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button disabled={currentPage <= 1} onClick={() => setFilters(f => ({ ...f, page: currentPage - 1 }))}
            className="btn-ghost rounded-lg px-3 py-2 text-sm inline-flex items-center gap-1 disabled:opacity-40">
            <ChevronLeft className="h-4 w-4" /> Previous
          </button>
          <span className="text-xs text-slate-500">Page {currentPage} of {totalPages} ({total} leads)</span>
          <button disabled={currentPage >= totalPages} onClick={() => setFilters(f => ({ ...f, page: currentPage + 1 }))}
            className="btn-ghost rounded-lg px-3 py-2 text-sm inline-flex items-center gap-1 disabled:opacity-40">
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Assign Modal */}
      <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title={`Assign ${selected.length} Lead(s)`} size="sm">
        <div>
          <label className="label">Assign To *</label>
          <select className="input" value={targetUser} onChange={e => setTargetUser(e.target.value)}>
            <option value="">— Select member —</option>
            {members.data?.map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.role}) — {m.lead_count} leads</option>)}
          </select>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setAssignOpen(false)} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button onClick={handleAssign} disabled={forceAssign.isPending || !targetUser}
            className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
            {forceAssign.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Assign
          </button>
        </div>
      </Modal>
    </div>
  );
}
