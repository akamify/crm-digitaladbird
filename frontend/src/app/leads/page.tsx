'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Inbox, Phone, Mail, Lock } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { LeadFilters } from '@/components/leads/LeadFilters';
import { LeadActions } from '@/components/leads/LeadActions';
import { LeadCommunicationPanel } from '@/components/leads/LeadCommunicationPanel';
import { LeadCategoryBadge } from '@/components/leads/LeadCategoryBadge';
import { Skeleton, EmptyState, StatusChip, Modal } from '@/components/ui/Modal';
import { useLeadList } from '@/hooks/useLeads';
import { fmtDate, fmtRelative, fmtPhone, humanize, stageChip, isOverdue, isDueToday, clsx } from '@/lib/format';
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
    page: 1,
    page_size: 25,
    sort: 'created_at',
    order: 'desc',
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const [filters, setFilters] = useState<LeadFilterType>(initial);
  const [communicationLead, setCommunicationLead] = useState<Lead | null>(null);
  const [communicationTab, setCommunicationTab] = useState<CommunicationTab>('chat');
  const { data, isLoading, isFetching } = useLeadList(filters);

  const rows  = data?.rows ?? [];
  const total = data?.total ?? 0;
  const page  = filters.page || 1;
  const size  = filters.page_size || 25;
  const pages = Math.max(1, Math.ceil(total / size));

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
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="text-sm">
            <span className="font-semibold text-slate-900">{total.toLocaleString()}</span>
            <span className="ml-1 text-slate-500">leads {isFetching && '· loading…'}</span>
          </div>
          <div className="text-xs text-slate-500">Page {page} / {pages}</div>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No leads match"
            description="Try changing filters or expanding the date range."
            icon={<Inbox className="h-6 w-6" />}
          />
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[1050px] text-sm">
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
                  <th className="px-4 py-2.5 font-medium">Followup</th>
                  <th className="px-4 py-2.5 font-medium">Received</th>
                  <th className="px-4 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(l => {
                  const locked = !!(l.locked_until && new Date(l.locked_until) > new Date());
                  return (
                    <tr key={l.id} className="table-row">
                      <td className="px-4 py-3">
                        <Link href={`/leads/${l.id}`} className="block">
                          <div className="flex items-center gap-2 font-medium text-slate-900 hover:text-brand-700">
                            {l.full_name || <span className="italic text-slate-500">No name</span>}
                            {locked && <Lock className="h-3 w-3 text-amber-500" aria-label="Locked" />}
                          </div>
                          {l.city && <div className="text-xs text-slate-500">{l.city}{l.state ? `, ${l.state}` : ''}</div>}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-slate-700">
                          <Phone className="h-3 w-3 text-slate-400" />
                          <span className="tabular-nums">{fmtPhone(l.phone)}</span>
                        </div>
                        {l.email && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-500">
                            <Mail className="h-3 w-3 text-slate-400" />
                            <span className="truncate">{l.email}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div>{humanize(l.source)}</div>
                        {l.campaign_label && <div className="text-xs text-slate-500">{l.campaign_label}</div>}
                      </td>
                      <td className="px-4 py-3"><LeadCategoryBadge category={l.category} /></td>
                      <td className="px-4 py-3 text-slate-700 max-w-[180px]">
                        {l.campaign_name ? (
                          <>
                            <div className="truncate text-sm" title={l.campaign_name}>{l.campaign_name}</div>
                            {l.adset_name && <div className="truncate text-xs text-slate-500" title={l.adset_name}>{l.adset_name}</div>}
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={stageChip[l.stage] || 'chip-slate'}>{humanize(l.stage)}</span>
                      </td>
                      <td className="px-4 py-3"><StatusChip status={l.call_status} /></td>
                      <td className="px-4 py-3 text-slate-700">{l.assigned_to_name || <span className="italic text-slate-400">Unassigned</span>}</td>
                      <td className="px-4 py-3">
                        {l.next_followup_at ? (
                          <div className={clsx(
                            'text-sm',
                            isOverdue(l.next_followup_at) && 'text-rose-600',
                            isDueToday(l.next_followup_at) && 'text-amber-700',
                          )}>
                            {fmtDate(l.next_followup_at, 'dd MMM, h:mm a')}
                          </div>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500" title={fmtDate(l.created_at)}>
                        {fmtRelative(l.created_at)}
                      </td>
                      <td className="px-4 py-3">
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
            <button
              disabled={page <= 1}
              onClick={() => setFilters(f => ({ ...f, page: page - 1 }))}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 disabled:opacity-50 hover:bg-slate-50"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </button>
            <div className="text-xs text-slate-500">
              Showing {(page - 1) * size + 1}–{Math.min(page * size, total)} of {total.toLocaleString()}
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
