'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Eye, Inbox, Lock, Mail, MessageSquarePlus, Phone } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { LeadActions } from '@/components/leads/LeadActions';
import { LeadCategoryBadge } from '@/components/leads/LeadCategoryBadge';
import { LeadCommunicationPanel } from '@/components/leads/LeadCommunicationPanel';
import { LeadFilters } from '@/components/leads/LeadFilters';
import { RemarkModal } from '@/components/leads/RemarkModal';
import { EmptyState, Modal, Skeleton, StatusChip } from '@/components/ui/Modal';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useBulkAddRemark, useLeadList } from '@/hooks/useLeads';
import { formatISTCompact, formatISTTooltip, formatStageUpdatedAt } from '@/lib/date';
import { clsx, fmtPhone, humanize, isDueToday, isOverdue, stageChip } from '@/lib/format';
import type { Lead, LeadFilters as LeadFilterType } from '@/types';

type CommunicationTab = 'chat' | 'calls';

export default function LeadsPage() {
  return (
    <AppShell title="Leads" subtitle="Browse, filter, and action your assigned leads">
      <LeadsInner />
    </AppShell>
  );
}

function LeadsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const initial = useMemo<LeadFilterType>(() => ({
    q: sp.get('q') || '',
    category: (sp.get('category') as LeadFilterType['category']) || '',
    stage: (sp.get('stage') as LeadFilterType['stage']) || '',
    call_status: (sp.get('call_status') as LeadFilterType['call_status']) || '',
    followup: (sp.get('followup') as LeadFilterType['followup']) || '',
    reassignment: (sp.get('reassignment') as LeadFilterType['reassignment']) || '',
    assignment: (sp.get('assignment') as LeadFilterType['assignment']) || '',
    unworked: (sp.get('unworked') as LeadFilterType['unworked']) || '',
    source: sp.get('source') || '',
    from: sp.get('from') || '',
    to: sp.get('to') || '',
    page: Number(sp.get('page') || '1'),
    page_size: Number(sp.get('page_size') || '25'),
    sort: 'created_at',
    order: 'desc',
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const [filters, setFilters] = useState<LeadFilterType>(initial);
  const [communicationLead, setCommunicationLead] = useState<Lead | null>(null);
  const [communicationTab, setCommunicationTab] = useState<CommunicationTab>('chat');
  const [remarkLeadId, setRemarkLeadId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkRemarkOpen, setBulkRemarkOpen] = useState(false);
  const [bulkRemark, setBulkRemark] = useState('');
  const debouncedSearch = useDebouncedValue(filters.q || '');
  const effectiveFilters = useMemo(() => {
    const next: LeadFilterType = { ...filters, q: debouncedSearch || undefined };
    if (next.assignment === 'assigned') next.assigned_to = '__assigned';
    if (next.assignment === 'unassigned') next.assigned_to = '__unassigned';
    delete next.assignment;
    return next;
  }, [filters, debouncedSearch]);
  const { data, isLoading, isFetching } = useLeadList(effectiveFilters);
  const bulkAddRemark = useBulkAddRemark();

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const page = filters.page || 1;
  const size = filters.page_size || 25;
  const pages = Math.max(1, Math.ceil(total / size));
  const selectablePageIds = rows.filter(lead => !lead.read_only_access).map(lead => lead.id);
  const allCurrentPageSelected = selectablePageIds.length > 0 && selectablePageIds.every(id => selectedIds.includes(id));

  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '' && key !== 'sort' && key !== 'order') {
        params.set(key, String(value));
      }
    });
    router.replace(`/leads${params.toString() ? `?${params.toString()}` : ''}`);
  }, [filters, router]);

  function openCommunication(lead: Lead, tab: CommunicationTab) {
    if (tab === 'chat') {
      router.push(`/chat?leadId=${lead.id}`);
      return;
    }
    setCommunicationLead(lead);
    setCommunicationTab(tab);
  }

  function toggleLeadSelection(leadId: string, checked: boolean) {
    setSelectedIds(ids => checked ? [...new Set([...ids, leadId])] : ids.filter(id => id !== leadId));
  }

  function toggleCurrentPage(checked: boolean) {
    setSelectedIds(ids => checked
      ? [...new Set([...ids, ...selectablePageIds])]
      : ids.filter(id => !selectablePageIds.includes(id)));
  }

  function submitBulkRemark() {
    if (!bulkRemark.trim()) {
      toast.error('Remark is required');
      return;
    }
    bulkAddRemark.mutate({ leadIds: selectedIds, remark: bulkRemark.trim() }, {
      onSuccess: (summary) => {
        toast.success(`Remark added to ${summary.updated} lead${summary.updated === 1 ? '' : 's'}`);
        if (summary.skipped) toast.error(`${summary.skipped} lead${summary.skipped === 1 ? '' : 's'} skipped`);
        setSelectedIds([]);
        setBulkRemark('');
        setBulkRemarkOpen(false);
      },
      onError: (e: any) => toast.error(e?.response?.data?.error?.message || e?.response?.data?.message || 'Could not add remarks'),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2">
        {[
          { key: 'current', label: 'Current Leads', next: { reassignment: '', unworked: '' } },
          { key: 'to_me', label: 'Reassigned To Me', next: { reassignment: 'to_me', unworked: '' } },
          { key: 'to_others', label: 'Reassigned To Others', next: { reassignment: 'to_others', unworked: '' } },
          { key: 'unworked', label: 'Unworked Leads', next: { reassignment: '', unworked: 'true' } },
        ].map(tab => {
          const active = tab.key === 'unworked'
            ? filters.unworked === 'true'
            : (filters.reassignment || '') === tab.next.reassignment && filters.unworked !== 'true';
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilters(f => ({
                ...f,
                reassignment: tab.next.reassignment as LeadFilterType['reassignment'],
                unworked: tab.next.unworked as LeadFilterType['unworked'],
                page: 1,
              }))}
              className={clsx(
                'rounded-lg px-3 py-2 text-sm font-medium transition',
                active ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {filters.reassignment === 'to_others' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          These leads were reassigned away from you or your team. You can open the profile for reference, but editing actions are disabled.
        </div>
      )}
      {filters.unworked === 'true' && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Unworked leads are leads with no call log or remark saved yet.
        </div>
      )}

      <LeadFilters value={filters} onChange={setFilters} />

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
          <div className="font-medium text-blue-950">{selectedIds.length} lead{selectedIds.length === 1 ? '' : 's'} selected</div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button onClick={() => setBulkRemarkOpen(true)} className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs">
              <MessageSquarePlus className="h-4 w-4" /> Add Remark
            </button>
            <button onClick={() => setSelectedIds([])} className="btn-ghost rounded-lg px-3 py-2 text-xs">Clear Selection</button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <span className="font-semibold text-slate-900">{total.toLocaleString()}</span>
            <span className="ml-1 text-slate-500">leads {isFetching && '· loading...'}</span>
          </div>
          <div className="text-xs text-slate-500">Page {page} / {pages}</div>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No leads match current filters"
            description="Try changing filters or expanding the date range."
            icon={<Inbox className="h-6 w-6" />}
          />
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[1120px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="w-10 px-4 py-2.5 font-medium">
                    <input
                      type="checkbox"
                      checked={allCurrentPageSelected}
                      onChange={event => toggleCurrentPage(event.target.checked)}
                      aria-label="Select all leads on current page"
                    />
                  </th>
                  <th className="px-4 py-2.5 font-medium">Lead</th>
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 font-medium">Campaign</th>
                  <th className="px-4 py-2.5 font-medium">Stage</th>
                  <th className="px-4 py-2.5 font-medium">Call status</th>
                  <th className="px-4 py-2.5 font-medium">Assigned</th>
                  <th className="px-4 py-2.5 font-medium">Reassigned</th>
                  <th className="px-4 py-2.5 font-medium">Follow-up</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((lead) => {
                  const locked = Boolean(lead.locked_until && new Date(lead.locked_until) > new Date());
                  return (
                    <tr key={lead.id} className="table-row">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          disabled={lead.read_only_access}
                          checked={selectedIds.includes(lead.id)}
                          onChange={event => toggleLeadSelection(lead.id, event.target.checked)}
                          aria-label={`Select ${lead.full_name || 'lead'}`}
                          title={lead.read_only_access ? 'Read-only reassigned lead' : undefined}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/leads/${lead.id}`} className="block">
                          <div className="flex items-center gap-2 font-medium text-slate-900 hover:text-brand-700">
                            {lead.full_name || <span className="italic text-slate-500">No name</span>}
                            {locked && <Lock className="h-3 w-3 text-amber-500" aria-label="Locked" />}
                          </div>
                          <div className="text-xs text-slate-500">
                            {[lead.city, lead.state].filter(Boolean).join(', ') || 'Not available'}
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-slate-700">
                          <Phone className="h-3 w-3 text-slate-400" />
                          <span className="tabular-nums">{fmtPhone(lead.phone)}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                          <Mail className="h-3 w-3 text-slate-400" />
                          <span className="truncate">{lead.email || 'Not available'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div>{humanize(lead.source)}</div>
                        <div className="truncate text-xs text-slate-500 max-w-[180px]" title={lead.campaign_label || undefined}>
                          {lead.campaign_label || 'Not available'}
                        </div>
                      </td>
                      <td className="px-4 py-3"><LeadCategoryBadge category={lead.category} /></td>
                      <td className="px-4 py-3 text-slate-700 max-w-[220px]">
                        <div className="truncate text-sm" title={lead.campaign_name || lead.ad_name || lead.meta_form_id || 'No campaign'}>
                          {lead.campaign_name || lead.ad_name || lead.meta_form_id || 'No campaign'}
                        </div>
                        <div className="truncate text-xs text-slate-500" title={lead.adset_name || undefined}>
                          {lead.adset_name || 'Not available'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <span className={stageChip[lead.stage] || 'chip-slate'} title={formatISTTooltip(lead.stage_updated_at || lead.updated_at)}>{humanize(lead.stage)}</span>
                          <div className="text-[11px] text-slate-500" title={formatISTTooltip(lead.stage_updated_at || lead.updated_at)}>
                            {formatStageUpdatedAt(lead.stage_updated_at || lead.updated_at || lead.created_at)}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><StatusChip status={lead.call_status} /></td>
                      <td className="px-4 py-3 text-slate-700">{lead.assigned_to_name || <span className="italic text-slate-400">Unassigned</span>}</td>
                      <td className="px-4 py-3">
                        {lead.read_only_access ? (
                          <span className="chip-amber">To others</span>
                        ) : lead.was_reassigned ? (
                          <span className="chip-blue">To me</span>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {lead.next_followup_at ? (
                          <div
                            className={clsx(
                              'text-sm',
                              isOverdue(lead.next_followup_at) && 'text-rose-600',
                              isDueToday(lead.next_followup_at) && 'text-amber-700',
                            )}
                            title={formatISTTooltip(lead.next_followup_at)}
                          >
                            {formatISTCompact(lead.next_followup_at)}
                          </div>
                        ) : <span className="text-slate-400">Not available</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500" title={formatISTTooltip(lead.created_at)}>
                        {formatISTCompact(lead.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        {lead.read_only_access ? (
                          <Link href={`/leads/${lead.id}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50">
                            <Eye className="h-3 w-3" /> View
                          </Link>
                        ) : (
                          <div className="flex items-center gap-1">
                            <LeadActions
                              phone={lead.phone}
                              compact
                              onCall={() => openCommunication(lead, 'calls')}
                              onChat={() => openCommunication(lead, 'chat')}
                            />
                            <button
                              type="button"
                              title="Add remark"
                              onClick={() => setRemarkLeadId(lead.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                              <MessageSquarePlus className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <button
              disabled={page <= 1}
              onClick={() => setFilters(f => ({ ...f, page: page - 1 }))}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 disabled:opacity-50 hover:bg-slate-50"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </button>
            <div className="text-xs text-slate-500 sm:text-center">
              Showing {(page - 1) * size + 1}-{Math.min(page * size, total)} of {total.toLocaleString()}
            </div>
            <button
              disabled={page >= pages}
              onClick={() => setFilters(f => ({ ...f, page: page + 1 }))}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 disabled:opacity-50 hover:bg-slate-50"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <Modal open={!!communicationLead} onClose={() => setCommunicationLead(null)} title="Lead Communication" size="lg">
        {communicationLead && (
          <LeadCommunicationPanel leadId={communicationLead.id} lead={communicationLead} defaultTab={communicationTab} />
        )}
      </Modal>
      {remarkLeadId && <RemarkModal leadId={remarkLeadId} open={!!remarkLeadId} onClose={() => setRemarkLeadId(null)} />}
      <Modal open={bulkRemarkOpen} onClose={() => setBulkRemarkOpen(false)} title="Add Remark to Selected Leads" size="md">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">This remark will be added to {selectedIds.length} selected lead{selectedIds.length === 1 ? '' : 's'} you can access.</p>
          <textarea
            className="input min-h-[120px] resize-y"
            value={bulkRemark}
            onChange={event => setBulkRemark(event.target.value)}
            placeholder="Write the remark..."
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setBulkRemarkOpen(false)} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button onClick={submitBulkRemark} disabled={bulkAddRemark.isPending} className="btn-primary rounded-lg px-4 py-2 text-sm">
            {bulkAddRemark.isPending ? 'Saving...' : 'Save Remark'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
