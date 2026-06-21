'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Inbox, Lock, Mail, Phone } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { LeadActions } from '@/components/leads/LeadActions';
import { LeadCategoryBadge } from '@/components/leads/LeadCategoryBadge';
import { LeadCommunicationPanel } from '@/components/leads/LeadCommunicationPanel';
import { LeadFilters } from '@/components/leads/LeadFilters';
import { EmptyState, Modal, Skeleton, StatusChip } from '@/components/ui/Modal';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useLeadList } from '@/hooks/useLeads';
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
  const debouncedSearch = useDebouncedValue(filters.q || '');
  const effectiveFilters = useMemo(() => ({ ...filters, q: debouncedSearch || undefined }), [filters, debouncedSearch]);
  const { data, isLoading, isFetching } = useLeadList(effectiveFilters);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const page = filters.page || 1;
  const size = filters.page_size || 25;
  const pages = Math.max(1, Math.ceil(total / size));

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

  return (
    <div className="space-y-4">
      <LeadFilters value={filters} onChange={setFilters} />

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
                  <th className="px-4 py-2.5 font-medium">Lead</th>
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 font-medium">Campaign</th>
                  <th className="px-4 py-2.5 font-medium">Stage</th>
                  <th className="px-4 py-2.5 font-medium">Call status</th>
                  <th className="px-4 py-2.5 font-medium">Assigned</th>
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
                          <span className={stageChip[lead.stage] || 'chip-slate'} title={formatISTTooltip(lead.updated_at)}>{humanize(lead.stage)}</span>
                          <div className="text-[11px] text-slate-500" title={formatISTTooltip(lead.updated_at)}>
                            {formatStageUpdatedAt(lead.updated_at || lead.created_at)}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><StatusChip status={lead.call_status} /></td>
                      <td className="px-4 py-3 text-slate-700">{lead.assigned_to_name || <span className="italic text-slate-400">Unassigned</span>}</td>
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
                        <LeadActions
                          phone={lead.phone}
                          email={lead.email}
                          name={lead.full_name}
                          compact
                          onChat={() => openCommunication(lead, 'chat')}
                        />
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
    </div>
  );
}
