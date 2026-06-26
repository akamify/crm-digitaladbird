'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Briefcase, ChevronLeft, ChevronRight, Download, Loader2, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { LeadActions } from '@/components/leads/LeadActions';
import { LeadCategoryBadge } from '@/components/leads/LeadCategoryBadge';
import { LeadCommunicationPanel } from '@/components/leads/LeadCommunicationPanel';
import { EmptyState, Modal, Skeleton } from '@/components/ui/Modal';
import { useActiveMembers, useBulkReassignLeads, useForceAssign, exportLeadsCsv } from '@/hooks/useAdmin';
import { useBulkUpdateLeadCategory } from '@/hooks/useAdminEnterprise';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useLeadList, useMetaCampaigns } from '@/hooks/useLeads';
import { formatISTCompact, formatISTTooltip, formatStageUpdatedAt } from '@/lib/date';
import { clsx, humanize, isOverdue } from '@/lib/format';
import type { Lead, LeadFilters } from '@/types';

type ApiErrorLike = { response?: { data?: { code?: string; message?: string; error?: { code?: string; message?: string } } } };
type BulkAssignResult = {
  assigned_count?: number;
  skipped_count?: number;
  assigned?: number;
  failed?: number;
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
  const router = useRouter();
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

  const debouncedSearch = useDebouncedValue(search);
  const leads = useLeadList({ ...filters, q: debouncedSearch || undefined });
  const campaigns = useMetaCampaigns();
  const members = useActiveMembers();
  const forceAssign = useForceAssign();
  const bulkReassign = useBulkReassignLeads();
  const bulkCategory = useBulkUpdateLeadCategory();

  const rows = useMemo(() => leads.data?.rows ?? [], [leads.data?.rows]);
  const assignableUsers = useMemo(() => (members.data || []).filter(user => user.role === 'member' || user.role === 'partner'), [members.data]);
  const total = leads.data?.total ?? 0;
  const currentPage = filters.page || 1;
  const pageSize = filters.page_size || 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const eligibleRows = useMemo(() => rows.filter(isLeadAssignable), [rows]);
  const eligibleIds = useMemo(() => eligibleRows.map(lead => lead.id), [eligibleRows]);
  const selectedOnPage = selected.filter(id => eligibleIds.includes(id));
  const allCurrentPageSelected = eligibleIds.length > 0 && selectedOnPage.length === eligibleIds.length;

  function updateFilters(patch: Partial<LeadFilters>) {
    setFilters(current => ({ ...current, ...patch, page: 1 }));
    setSelected([]);
  }

  function toggleSelect(id: string) {
    const lead = rows.find(row => row.id === id);
    if (lead && !isLeadAssignable(lead)) return;
    setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  function selectAll() {
    if (allCurrentPageSelected) {
      setSelected(current => current.filter(id => !eligibleIds.includes(id)));
      return;
    }
    setSelected(current => Array.from(new Set([...current, ...eligibleIds])));
  }

  function openAssign(mode: 'assign' | 'reassign') {
    setAssignMode(mode);
    setAssignReason('');
    setAssignOpen(true);
  }

  function openCommunication(lead: Lead, tab: CommunicationTab) {
    if (tab === 'chat') {
      router.push(`/chat?leadId=${lead.id}`);
      return;
    }
    setCommunicationLead(lead);
    setCommunicationTab(tab);
  }

  function changeSelectedCategory(category: 'trader' | 'partner' | 'unknown') {
    if (!selected.length) return;
    if (!window.confirm(`Change ${selected.length} selected lead(s) to ${category === 'trader' ? 'Trader Lead' : category === 'partner' ? 'Partner Lead' : 'Unknown'}?`)) return;
    bulkCategory.mutate(
      { leadIds: selected, category, reason: 'Bulk update from Admin Leads Manager' },
      {
        onSuccess: () => {
          toast.success('Lead categories updated');
          setSelected([]);
        },
        onError: () => toast.error('Bulk category update failed'),
      },
    );
  }

  function handleAssign() {
    if (!targetUser || selected.length === 0) return;
    if (assignMode === 'reassign' && !assignReason.trim()) {
      toast.error('Reason is required for reassignment');
      return;
    }
    const mutation = assignMode === 'reassign' ? bulkReassign : forceAssign;
    mutation.mutate(
      {
        lead_ids: selected,
        user_id: targetUser,
        reason: assignReason || (assignMode === 'assign' ? 'Manual bulk assignment from Admin Leads Manager' : undefined),
      },
      {
        onSuccess: (data: BulkAssignResult) => {
          const assigned = data.assigned_count ?? data.assigned ?? 0;
          const skipped = data.skipped_count ?? data.failed ?? 0;
          toast.success(skipped ? `${assigned} lead(s) updated, ${skipped} skipped` : `${assigned} lead(s) ${assignMode === 'reassign' ? 'reassigned' : 'assigned'}`);
          setSelected([]);
          setAssignOpen(false);
          setTargetUser('');
          setAssignReason('');
          leads.refetch();
        },
        onError: (error: unknown) => toast.error(apiErrorMessage(error, `${assignMode === 'reassign' ? 'Reassign' : 'Assign'} failed`)),
      },
    );
  }

  async function handleExport() {
    setExporting(true);
    try {
      const payload: Record<string, string> = {};
      if (filters.stage) payload.stage = filters.stage;
      if (filters.call_status) payload.call_status = filters.call_status;
      if (filters.source) payload.source = filters.source;
      if (filters.category) payload.category = filters.category;
      if (filters.campaign_id) payload.campaign_id = filters.campaign_id;
      if (filters.assigned_to) payload.assigned_to = filters.assigned_to;
      await exportLeadsCsv(payload);
      toast.success('CSV downloaded');
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/dashboard" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="h-4 w-4" /></Link>
          <Briefcase className="h-5 w-5 text-brand-600" />
          <h1 className="truncate text-lg font-semibold text-slate-900">All Leads</h1>
          <span className="chip-slate ml-1">{total.toLocaleString()} total</span>
        </div>

        <div className="flex justify-start lg:justify-end">
          <button onClick={handleExport} disabled={exporting} className="btn-outline inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export CSV
          </button>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-10"
            placeholder="Search name, phone, email, city..."
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setFilters(current => ({ ...current, page: 1 }));
              setSelected([]);
            }}
          />
        </div>
        <select className="input w-48" value={filters.campaign_id || ''} onChange={e => updateFilters({ campaign_id: e.target.value || undefined, campaign: undefined })}>
          <option value="">All campaigns</option>
          {campaigns.isLoading && <option value="" disabled>Loading campaigns...</option>}
          {(campaigns.data || []).map(campaign => <option key={campaign.campaign_id} value={campaign.campaign_id}>{campaign.internal_label || campaign.campaign_name}</option>)}
        </select>
        <select className="input w-32" value={filters.source || ''} onChange={e => updateFilters({ source: e.target.value || undefined })}>
          <option value="">All Sources</option>
          <option value="meta">Meta</option>
          <option value="google">Google Sheet</option>
          <option value="manual">Manual</option>
          <option value="import">Import</option>
          <option value="website">Website</option>
          <option value="whatsapp">WhatsApp</option>
        </select>
        <select className="input w-32" value={filters.stage || ''} onChange={e => updateFilters({ stage: e.target.value as LeadFilters['stage'] })}>
          <option value="">All Stages</option>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="qualified">Qualified</option>
          <option value="follow_up">Follow-up</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </select>
        <select className="input w-36" value={filters.call_status || ''} onChange={e => updateFilters({ call_status: e.target.value as LeadFilters['call_status'] })}>
          <option value="">All Status</option>
          <option value="not_called">Not Called</option>
          <option value="interested">Interested</option>
          <option value="converted">Converted</option>
          <option value="not_interested">Not Interested</option>
          <option value="follow_up">Follow-up</option>
          <option value="busy">Busy</option>
        </select>
        <select className="input w-36" value={filters.category || ''} onChange={e => updateFilters({ category: e.target.value as LeadFilters['category'] })}>
          <option value="">All Categories</option>
          <option value="partner">Partner Leads</option>
          <option value="trader">Trader Leads</option>
          <option value="unknown">Unknown</option>
        </select>
        <select className="input w-40" value={filters.assigned_to || ''} onChange={e => updateFilters({ assigned_to: e.target.value || undefined })}>
          <option value="">All assignees</option>
          <option value="__unassigned">Unassigned</option>
          {assignableUsers.map(user => <option key={user.id} value={user.id}>{user.full_name}</option>)}
        </select>
        <select className="input w-32" value={filters.pending || ''} onChange={e => updateFilters({ pending: e.target.value as LeadFilters['pending'] })}>
          <option value="">All Work</option>
          <option value="true">Pending Only</option>
          <option value="false">Worked Only</option>
        </select>
        <select className="input w-28" value={String(pageSize)} onChange={e => updateFilters({ page_size: Number(e.target.value) })}>
          <option value="10">10 / page</option>
          <option value="25">25 / page</option>
          <option value="50">50 / page</option>
        </select>
        <button onClick={() => { setSearch(''); setFilters({ page: 1, page_size: pageSize }); setSelected([]); }} className="btn-outline rounded-lg px-3 py-2 text-sm">
          Clear filters
        </button>
      </div>
      </div>

      {selected.length > 0 && (
        <div className="sticky top-20 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 shadow-sm">
          <span className="text-sm font-medium text-brand-800">{selected.length} selected</span>
          <button onClick={() => openAssign('assign')} className="btn-primary rounded-lg px-3 py-1.5 text-xs">Assign</button>
          <button onClick={() => openAssign('reassign')} className="btn-outline rounded-lg px-3 py-1.5 text-xs">Reassign</button>
          <select className="input h-8 w-auto text-xs" defaultValue="" onChange={event => { if (event.target.value) changeSelectedCategory(event.target.value as 'trader' | 'partner' | 'unknown'); event.target.value = ''; }} disabled={bulkCategory.isPending}>
            <option value="">Change category...</option>
            <option value="trader">Trader Lead</option>
            <option value="partner">Partner Lead</option>
            <option value="unknown">Unknown</option>
          </select>
          <button onClick={() => setSelected([])} className="ml-auto text-xs text-slate-500 hover:text-slate-700">Clear</button>
        </div>
      )}

      {leads.isLoading ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <EmptyState title="No leads found" description="Adjust filters or wait for new leads." icon={<Briefcase className="h-6 w-6" />} />
      ) : (
        <div className="card-padded overflow-x-auto">
          <table className="w-full min-w-[1120px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-2 font-medium">
                  <input type="checkbox" checked={allCurrentPageSelected} disabled={eligibleIds.length === 0} onChange={selectAll} className="rounded border-slate-300 disabled:opacity-40" aria-label="Select eligible leads on this page" />
                </th>
                <th className="py-2 pr-3 font-medium">Lead</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pr-3 font-medium">Category</th>
                <th className="py-2 pr-3 font-medium">Stage</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Assigned To</th>
                <th className="py-2 pr-3 font-medium">Follow-up</th>
                <th className="py-2 pr-3 font-medium">Created</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((lead) => {
                const assignable = isLeadAssignable(lead);
                return (
                  <tr key={lead.id} className={clsx('hover:bg-slate-50 transition', selected.includes(lead.id) && 'bg-brand-50', !assignable && 'opacity-70')}>
                    <td className="py-3 pr-2">
                      <input
                        type="checkbox"
                        checked={selected.includes(lead.id)}
                        disabled={!assignable}
                        onChange={() => toggleSelect(lead.id)}
                        className="rounded border-slate-300 disabled:opacity-40"
                        title={assignable ? 'Select lead' : 'Closed, converted, invalid, or locked leads cannot be assigned'}
                      />
                    </td>
                    <td className="py-3 pr-3">
                      <Link href={`/leads/${lead.id}`} className="hover:text-brand-600">
                        <div className="font-medium text-slate-900">{lead.full_name || 'Unnamed'}</div>
                        <div className="text-xs text-slate-500">{lead.phone || 'Not available'} {lead.email ? `· ${lead.email}` : ''}</div>
                      </Link>
                    </td>
                    <td className="py-3 pr-3 text-xs text-slate-600">
                      {humanize(lead.source || 'manual')}
                      <div className="text-slate-400 truncate max-w-[180px]" title={lead.campaign_name || lead.ad_name || lead.meta_form_id || 'No campaign'}>
                        {lead.campaign_name || lead.ad_name || lead.meta_form_id || 'No campaign'}
                      </div>
                    </td>
                    <td className="py-3 pr-3"><LeadCategoryBadge category={lead.category} /></td>
                    <td className="py-3 pr-3">
                      <div className="space-y-1">
                        <span className={clsx('chip', lead.stage === 'won' ? 'chip-green' : lead.stage === 'lost' ? 'chip-red' : 'chip-slate')} title={formatISTTooltip(lead.stage_updated_at || lead.updated_at)}>{humanize(lead.stage)}</span>
                        <div className="text-[11px] text-slate-500" title={formatISTTooltip(lead.stage_updated_at || lead.updated_at)}>{formatStageUpdatedAt(lead.stage_updated_at || lead.updated_at || lead.created_at)}</div>
                      </div>
                    </td>
                    <td className="py-3 pr-3"><span className={clsx('chip', lead.call_status === 'converted' ? 'chip-green' : lead.call_status === 'not_called' ? 'chip-amber' : lead.call_status === 'interested' ? 'chip-blue' : 'chip-slate')}>{humanize(lead.call_status)}</span></td>
                    <td className="py-3 pr-3 text-xs text-slate-600">{lead.assigned_to_name || <span className="text-amber-600">Unassigned</span>}</td>
                    <td className="py-3 pr-3 text-xs">{lead.next_followup_at ? <span className={isOverdue(lead.next_followup_at) ? 'text-rose-600 font-medium' : 'text-slate-500'} title={formatISTTooltip(lead.next_followup_at)}>{formatISTCompact(lead.next_followup_at)}</span> : 'Not available'}</td>
                    <td className="py-3 pr-3 text-xs text-slate-500" title={formatISTTooltip(lead.created_at)}>{formatISTCompact(lead.created_at)}</td>
                    <td className="py-3">
                      <LeadActions phone={lead.phone} compact onCall={() => openCommunication(lead, 'calls')} onChat={() => openCommunication(lead, 'chat')} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Showing {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, total)} of {total.toLocaleString()}</span>
              <button onClick={() => setFilters(current => ({ ...current, page: Math.max(1, (current.page || 1) - 1) }))} disabled={currentPage === 1 || leads.isFetching} className="btn-outline rounded-md px-2 py-1 text-xs disabled:opacity-50">
                <ChevronLeft className="h-3 w-3" />
              </button>
              <button onClick={() => setFilters(current => ({ ...current, page: Math.min(totalPages, (current.page || 1) + 1) }))} disabled={currentPage >= totalPages || leads.isFetching} className="btn-outline rounded-md px-2 py-1 text-xs disabled:opacity-50">
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            <span className="text-xs text-slate-500">Page {currentPage} / {totalPages}</span>
          </div>
        </div>
      )}

      <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title={assignMode === 'assign' ? 'Assign Selected Leads' : 'Reassign Selected Leads'} size="md">
        <div className="space-y-4">
          <div className="text-sm text-slate-600">{selected.length} lead(s) selected</div>
          <select className="input w-full" value={targetUser} onChange={(event) => setTargetUser(event.target.value)}>
            <option value="">Select member</option>
            {assignableUsers.map(user => <option key={user.id} value={user.id}>{user.full_name}</option>)}
          </select>
          <textarea className="input min-h-[100px] py-2" placeholder={assignMode === 'reassign' ? 'Reason for reassignment' : 'Optional note'} value={assignReason} onChange={(event) => setAssignReason(event.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="btn-outline rounded-lg px-4 py-2 text-sm" onClick={() => setAssignOpen(false)}>Cancel</button>
            <button className="btn-primary rounded-lg px-4 py-2 text-sm" onClick={handleAssign} disabled={(assignMode === 'reassign' && !assignReason.trim()) || !targetUser}>
              {assignMode === 'assign' ? 'Assign Leads' : 'Reassign Leads'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!communicationLead} onClose={() => setCommunicationLead(null)} title="Lead Communication" size="lg">
        {communicationLead && <LeadCommunicationPanel leadId={communicationLead.id} lead={communicationLead} defaultTab={communicationTab} />}
      </Modal>
    </div>
  );
}
