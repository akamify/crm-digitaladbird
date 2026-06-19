'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Briefcase, ArrowLeft, Search, Download, ArrowRightLeft,
  Loader2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Modal, Skeleton, EmptyState } from '@/components/ui/Modal';
import { LeadActions } from '@/components/leads/LeadActions';
import { LeadCommunicationPanel } from '@/components/leads/LeadCommunicationPanel';
import { useLeadList, useMetaCampaigns } from '@/hooks/useLeads';
import { useForceAssign, useBulkReassignLeads, useActiveMembers, exportLeadsCsv } from '@/hooks/useAdmin';
import { fmtDate, fmtRelative, clsx, humanize, isOverdue } from '@/lib/format';
import type { LeadFilters, Lead } from '@/types';

type ApiErrorLike = { response?: { data?: { code?: string; message?: string; error?: { code?: string; message?: string } } } };
type BulkAssignResult = {
  requested_count?: number;
  assigned_count?: number;
  skipped_count?: number;
  failed_count?: number;
  assigned?: number;
  failed?: number;
  skipped?: Array<{ leadId: string; reason: string }>;
  results?: Array<{ leadId: string; assigned: boolean; reason?: string }>;
};
type CommunicationTab = 'chat' | 'calls';

function apiErrorMessage(error: unknown, fallback: string) {
  const data = (error as ApiErrorLike)?.response?.data;
  const code = data?.code || data?.error?.code;
  if (code === 'INVALID_LEAD_ASSIGNEE_ROLE') {
    return 'Lead assignment is allowed only for Members and Partners. RM users can manage teams but cannot receive direct leads.';
  }
  return data?.message || data?.error?.message || fallback;
}

function isLeadAssignable(lead: Lead) {
  const closedStages = new Set(['won', 'lost']);
  const closedCallStatuses = new Set(['converted', 'not_interested', 'wrong_number', 'invalid_number']);
  const locked = Boolean(lead.locked_by_user_id && lead.locked_until && new Date(lead.locked_until) > new Date());
  return !closedStages.has(lead.stage) && !closedCallStatuses.has(lead.call_status) && !locked;
}

export default function LeadsManagerPage() {
  return (
    <AppShell title="Lead Management" subtitle="View, filter, bulk-edit, and export all leads" roles={['super_admin', 'admin']}>
      <LeadsInner />
    </AppShell>
  );
}

function LeadsInner() {
  const [filters, setFilters] = useState<LeadFilters>({ page: 1, page_size: 25 });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignMode, setAssignMode] = useState<'assign' | 'reassign'>('assign');
  const [targetUser, setTargetUser] = useState('');
  const [assignReason, setAssignReason] = useState('');
  const [exporting, setExporting] = useState(false);
  const [communicationLead, setCommunicationLead] = useState<Lead | null>(null);
  const [communicationTab, setCommunicationTab] = useState<CommunicationTab>('chat');

  const leads = useLeadList({ ...filters, q: search || undefined });
  const campaigns = useMetaCampaigns();
  const members = useActiveMembers();
  const forceAssign = useForceAssign();
  const bulkReassign = useBulkReassignLeads();

  const rows = useMemo(() => leads.data?.rows ?? [], [leads.data?.rows]);
  const assignableUsers = useMemo(
    () => (members.data || []).filter(m => m.role === 'member' || m.role === 'partner'),
    [members.data],
  );
  const total = leads.data?.total ?? 0;
  const totalPages = Math.ceil(total / (filters.page_size || 25));
  const currentPage = filters.page || 1;
  const eligibleRows = useMemo(() => rows.filter(isLeadAssignable), [rows]);
  const eligibleIds = useMemo(() => eligibleRows.map(l => l.id), [eligibleRows]);
  const selectedOnPage = selected.filter(id => eligibleIds.includes(id));
  const allCurrentPageSelected = eligibleIds.length > 0 && selectedOnPage.length === eligibleIds.length;

  function updateFilters(patch: Partial<LeadFilters>) {
    setFilters(f => ({ ...f, ...patch, page: 1 }));
    setSelected([]);
  }

  function toggleSelect(id: string) {
    const lead = rows.find(l => l.id === id);
    if (lead && !isLeadAssignable(lead)) return;
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function selectAll() {
    if (allCurrentPageSelected) {
      setSelected(prev => prev.filter(id => !eligibleIds.includes(id)));
    } else {
      setSelected(prev => Array.from(new Set([...prev, ...eligibleIds])));
    }
  }

  function handleAssign() {
    if (!targetUser || selected.length === 0) return;
    if (assignMode === 'reassign' && !assignReason.trim()) {
      toast.error('Reason is required for reassignment');
      return;
    }
    const mutation = assignMode === 'reassign' ? bulkReassign : forceAssign;
    mutation.mutate({ lead_ids: selected, user_id: targetUser, reason: assignReason || (assignMode === 'assign' ? 'Manual bulk assignment from Admin Leads Manager' : undefined) }, {
      onSuccess: (d: BulkAssignResult) => {
        const assigned = d.assigned_count ?? d.assigned ?? 0;
        const skipped = d.skipped_count ?? d.failed ?? 0;
        toast.success(skipped ? `${assigned} lead(s) updated, ${skipped} skipped` : `${assigned} lead(s) ${assignMode === 'reassign' ? 'reassigned' : 'assigned'}`);
        setSelected([]);
        setAssignOpen(false);
        setTargetUser('');
        setAssignReason('');
        leads.refetch();
      },
      onError: (error: unknown) => toast.error(apiErrorMessage(error, `${assignMode === 'reassign' ? 'Reassign' : 'Assign'} failed`)),
    });
  }

  function openAssign(mode: 'assign' | 'reassign') {
    setAssignMode(mode);
    setAssignReason('');
    setAssignOpen(true);
  }

  function openCommunication(lead: Lead, tab: CommunicationTab) {
    setCommunicationLead(lead);
    setCommunicationTab(tab);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const f: Record<string, string> = {};
      if (filters.stage) f.stage = filters.stage;
      if (filters.call_status) f.call_status = filters.call_status;
      if (filters.source) f.source = filters.source;
      if (filters.category) f.category = filters.category;
      if (filters.campaign_id) f.campaign_id = filters.campaign_id;
      if (filters.assigned_to) f.assigned_to = filters.assigned_to;
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
            onChange={e => { setSearch(e.target.value); setFilters(f => ({ ...f, page: 1 })); setSelected([]); }} />
        </div>
        <select className="input w-48" value={filters.campaign_id || ''} onChange={e => updateFilters({ campaign_id: e.target.value || undefined, campaign: undefined })}>
          <option value="">All campaigns</option>
          {campaigns.isLoading && <option value="" disabled>Loading campaigns...</option>}
          {(campaigns.data || []).map(c => (
            <option key={c.campaign_id} value={c.campaign_id}>
              {c.internal_label || c.campaign_name}
            </option>
          ))}
        </select>
        <select className="input w-32" value={filters.source || ''} onChange={e => updateFilters({ source: e.target.value || undefined })}>
          <option value="">All Sources</option>
          <option value="meta">Meta</option><option value="google">Google</option><option value="manual">Manual</option>
          <option value="import">Import</option><option value="website">Website</option><option value="whatsapp">WhatsApp</option>
        </select>
        <select className="input w-32" value={filters.stage || ''} onChange={e => updateFilters({ stage: e.target.value as LeadFilters['stage'] })}>
          <option value="">All Stages</option>
          <option value="new">New</option><option value="contacted">Contacted</option><option value="qualified">Qualified</option>
          <option value="follow_up">Follow-up</option><option value="won">Won</option><option value="lost">Lost</option>
        </select>
        <select className="input w-32" value={filters.call_status || ''} onChange={e => updateFilters({ call_status: e.target.value as LeadFilters['call_status'] })}>
          <option value="">All Status</option>
          <option value="not_called">Not Called</option><option value="interested">Interested</option><option value="converted">Converted</option>
          <option value="not_interested">Not Interested</option><option value="follow_up">Follow-up</option><option value="busy">Busy</option>
        </select>
        <select className="input w-32" value={filters.category || ''} onChange={e => updateFilters({ category: e.target.value as LeadFilters['category'] })}>
          <option value="">All Categories</option><option value="partner">Partner</option><option value="trader">Trader</option>
        </select>
        <select className="input w-36" value={filters.assigned_to || ''} onChange={e => updateFilters({ assigned_to: e.target.value || undefined })}>
          <option value="">All assignees</option>
          <option value="__unassigned">Unassigned</option>
          {assignableUsers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
        </select>
        <select className="input w-32" value={filters.pending || ''} onChange={e => updateFilters({ pending: e.target.value as LeadFilters['pending'] })}>
          <option value="">All Work</option><option value="true">Pending Only</option><option value="false">Worked Only</option>
        </select>
        <button
          onClick={() => { setSearch(''); setFilters({ page: 1, page_size: filters.page_size || 25 }); setSelected([]); }}
          className="btn-outline rounded-lg px-3 py-2 text-sm"
        >
          Clear filters
        </button>
      </div>

      {/* Bulk actions bar */}
      {selected.length > 0 && (
        <div className="sticky top-20 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 shadow-sm">
          <span className="text-sm font-medium text-brand-800">{selected.length} selected</span>
          <button disabled={selected.length === 0} onClick={() => openAssign('assign')} className="btn-primary rounded-lg px-3 py-1.5 text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
            <ArrowRightLeft className="h-3.5 w-3.5" /> Assign
          </button>
          <button disabled={selected.length === 0} onClick={() => openAssign('reassign')} className="btn-outline rounded-lg px-3 py-1.5 text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
            <ArrowRightLeft className="h-3.5 w-3.5" /> Reassign
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
                <th className="py-2 pr-2 font-medium">
                  <input
                    type="checkbox"
                    checked={allCurrentPageSelected}
                    disabled={eligibleIds.length === 0}
                    onChange={selectAll}
                    className="rounded border-slate-300 disabled:opacity-40"
                    aria-label="Select eligible leads on this page"
                  />
                </th>
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
              {rows.map(l => {
                const assignable = isLeadAssignable(l);
                return (
                <tr key={l.id} className={clsx('hover:bg-slate-50 transition', selected.includes(l.id) && 'bg-brand-50', !assignable && 'opacity-70')}>
                  <td className="py-3 pr-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(l.id)}
                      disabled={!assignable}
                      onChange={() => toggleSelect(l.id)}
                      className="rounded border-slate-300 disabled:opacity-40"
                      title={assignable ? 'Select lead' : 'Closed, converted, invalid, or locked leads cannot be assigned'}
                    />
                  </td>
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
                  <td className="py-3">
                    <LeadActions
                      phone={l.phone}
                      email={l.email}
                      name={l.full_name}
                      compact
                      onChat={() => openCommunication(l, 'chat')}
                      onCall={() => openCommunication(l, 'calls')}
                    />
                  </td>
                </tr>
              );})}
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
      <Modal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title={assignMode === 'reassign' ? 'Reassign Selected Leads' : 'Assign Selected Leads'}
        description={`${selected.length} selected lead(s)`}
        size="sm"
      >
        <div className="space-y-3">
          <div>
          <label className="label">{assignMode === 'reassign' ? 'Reassign To' : 'Assign To'} *</label>
          <select className="input" value={targetUser} onChange={e => setTargetUser(e.target.value)} disabled={members.isLoading || members.isError}>
            <option value="">Select member or partner</option>
            {assignableUsers.map(m => <option key={m.id} value={m.id}>{m.full_name} - {humanize(m.role)} - {m.lead_count} leads</option>)}
          </select>
          {members.isLoading && <p className="mt-1 text-xs text-slate-500">Loading members...</p>}
          {members.isError && <p className="mt-1 text-xs text-red-600">Could not load eligible members.</p>}
          {!members.isLoading && !members.isError && assignableUsers.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">No eligible active members or partners are available.</p>
          )}
          </div>
          <div>
            <label className="label">Reason / note {assignMode === 'reassign' ? '*' : ''}</label>
            <textarea
              className="input min-h-[72px]"
              value={assignReason}
              onChange={e => setAssignReason(e.target.value)}
              placeholder={assignMode === 'reassign' ? 'Why are these leads being reassigned?' : 'Optional assignment note'}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setAssignOpen(false)} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button onClick={handleAssign} disabled={forceAssign.isPending || bulkReassign.isPending || !targetUser || (assignMode === 'reassign' && !assignReason.trim())}
            className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
            {(forceAssign.isPending || bulkReassign.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
            {assignMode === 'reassign' ? 'Reassign' : 'Assign'}
          </button>
        </div>
      </Modal>

      <Modal
        open={!!communicationLead}
        onClose={() => setCommunicationLead(null)}
        title="Lead Communication"
        size="lg"
      >
        {communicationLead && (
          <LeadCommunicationPanel
            leadId={communicationLead.id}
            lead={communicationLead}
            defaultTab={communicationTab}
          />
        )}
      </Modal>
    </div>
  );
}
