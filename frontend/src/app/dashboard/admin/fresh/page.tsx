'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Sparkles, ExternalLink, Sheet as SheetIcon, ArrowLeft, RefreshCw,
  Users, Briefcase, HandMetal, Inbox, ArrowRight,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Modal, Skeleton, EmptyState } from '@/components/ui/Modal';
import { LeadActions } from '@/components/leads/LeadActions';
import { LeadCommunicationPanel } from '@/components/leads/LeadCommunicationPanel';
import { LeadCategoryBadge } from '@/components/leads/LeadCategoryBadge';
import { useFreshLeads, type FreshLeadRow, type FreshLeadsScope } from '@/hooks/useAdminEnterprise';
import { fmtRelative, fmtDate, humanize, clsx } from '@/lib/format';

export default function AdminFreshLeadsPage() {
  return (
    <AppShell title="Fresh Leads" subtitle="Today's incoming leads, separated by trader / partner — live" roles={['super_admin', 'rm']}>
      <FreshLeadsInner />
    </AppShell>
  );
}

const TABS: { key: FreshLeadsScope; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'today',   label: 'Today',           icon: <Sparkles className="h-3.5 w-3.5" />,    color: 'amber'   },
  { key: 'trader',  label: 'Trader Fresh',    icon: <Briefcase className="h-3.5 w-3.5" />,   color: 'blue'    },
  { key: 'partner', label: 'Partner Fresh',   icon: <HandMetal className="h-3.5 w-3.5" />,   color: 'violet'  },
  { key: 'all',     label: 'All Active',      icon: <Inbox className="h-3.5 w-3.5" />,       color: 'slate'   },
];
type CommunicationTab = 'chat' | 'calls';

function FreshLeadsInner() {
  const router = useRouter();
  const [scope, setScope] = useState<FreshLeadsScope>('today');
  const [communicationLead, setCommunicationLead] = useState<FreshLeadRow | null>(null);
  const [communicationTab, setCommunicationTab] = useState<CommunicationTab>('chat');
  const q = useFreshLeads(scope, 100);
  const counts = q.data?.counts;
  const links = q.data?.sheet_links;

  function openCommunication(lead: FreshLeadRow, tab: CommunicationTab) {
    if (tab === 'chat') {
      router.push(`/chat?leadId=${lead.id}`);
      return;
    }
    setCommunicationLead(lead);
    setCommunicationTab(tab);
  }

  return (
    <div className="space-y-5">
      {/* Back + refresh */}
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="h-4 w-4" /></Link>
        <Sparkles className="h-5 w-5 text-amber-500" />
        <h1 className="text-lg font-semibold text-slate-900">Fresh Leads</h1>
        <span className="chip-amber text-[10px] ml-1">Live</span>
        <button onClick={() => q.refetch()} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
          <RefreshCw className={clsx('h-3.5 w-3.5', q.isFetching && 'animate-spin')} /> Refresh
        </button>
      </div>

      {/* Counter row — total / today / per-category, all clickable to switch tab */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <CountTile label="Total Leads"      value={counts?.total_active}  color="slate"  icon={<Inbox className="h-4 w-4" />}     onClick={() => setScope('all')} />
        <CountTile label="Today Fresh"      value={counts?.today_total}   color="amber"  icon={<Sparkles className="h-4 w-4" />}  onClick={() => setScope('today')} active={scope === 'today'} />
        <CountTile label="Trader Today"     value={counts?.today_trader}  color="blue"   icon={<Briefcase className="h-4 w-4" />} onClick={() => setScope('trader')}  active={scope === 'trader'} />
        <CountTile label="Partner Today"    value={counts?.today_partner} color="violet" icon={<HandMetal className="h-4 w-4" />}  onClick={() => setScope('partner')} active={scope === 'partner'} />
        <CountTile label="Unassigned"       value={counts?.unassigned}    color="rose"   icon={<Users className="h-4 w-4" />}     onClick={() => setScope('today')} />
        <CountTile label="Assigned"         value={counts?.assigned}      color="emerald" icon={<Users className="h-4 w-4" />}    onClick={() => setScope('today')} />
      </div>

      {/* Sheet shortcuts — directly open trader / partner sheets in Google */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Open source sheet:</span>
        {links?.traders ? (
          <a href={links.traders} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100">
            <SheetIcon className="h-3.5 w-3.5" /> Trader Sheet <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-400">
            <SheetIcon className="h-3.5 w-3.5" /> Trader Sheet not configured
          </span>
        )}
        {links?.partners ? (
          <a href={links.partners} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100">
            <SheetIcon className="h-3.5 w-3.5" /> Partner Sheet <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-400">
            <SheetIcon className="h-3.5 w-3.5" /> Partner Sheet not configured
          </span>
        )}
        <Link href="/settings?tab=sheets" className="ml-auto text-xs text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
          Manage sheets <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
        {TABS.map(t => {
          const n = counts && (
            t.key === 'today' ? counts.today_total :
            t.key === 'trader' ? counts.today_trader :
            t.key === 'partner' ? counts.today_partner :
            counts.total_active
          );
          return (
            <button key={t.key} onClick={() => setScope(t.key)}
              className={clsx(
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition',
                scope === t.key ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50',
              )}>
              {t.icon} {t.label}
              {typeof n === 'number' && (
                <span className={clsx('rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums', scope === t.key ? 'bg-white/20' : 'bg-slate-100 text-slate-700')}>{n}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Table */}
      {q.isLoading ? <Skeleton className="h-64" /> : !q.data?.rows.length ? (
        <EmptyState
          title={scope === 'today' ? 'No fresh leads today yet' : `No ${scope} leads`}
          description="New leads will appear here in real time as Meta webhooks fire or sheet imports complete."
          icon={<Sparkles className="h-6 w-6" />}
        />
      ) : (
        <div className="card-padded overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-medium">Lead</th>
                <th className="py-2 pr-3 font-medium">Category</th>
                <th className="py-2 pr-3 font-medium">Campaign</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pr-3 font-medium">Assigned</th>
                <th className="py-2 pr-3 font-medium">Received</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {q.data.rows.map(l => (
                <tr key={l.id} className="hover:bg-slate-50 transition">
                  <td className="py-2.5 pr-3">
                    <Link href={`/leads/${l.id}`} className="hover:text-brand-600">
                      <div className="font-medium text-slate-900">{l.full_name || 'Unnamed'}</div>
                      <div className="text-[11px] text-slate-500">{l.phone || '—'}{l.city ? ` · ${l.city}` : ''}</div>
                    </Link>
                  </td>
                  <td className="py-2.5 pr-3">
                    <LeadCategoryBadge category={l.category} />
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-slate-700 max-w-[200px]">
                    {l.campaign_name ? (
                      <>
                        <div className="truncate" title={l.campaign_name}>{l.campaign_name}</div>
                        {l.adset_name && <div className="truncate text-[10px] text-slate-500" title={l.adset_name}>{l.adset_name}</div>}
                      </>
                    ) : l.campaign_label ? (
                      <span className="chip-blue text-[10px]">{l.campaign_label}</span>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-slate-600">{humanize(l.source || 'manual')}</td>
                  <td className="py-2.5 pr-3 text-xs">
                    {l.assigned_to_name ? (
                      <div>
                        <div className="text-slate-800">{l.assigned_to_name}</div>
                        <div className="text-[10px] text-slate-500">{humanize(l.assigned_to_role || '')}</div>
                      </div>
                    ) : <span className="text-amber-600">Unassigned</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-slate-500" title={fmtDate(l.created_at)}>{fmtRelative(l.created_at)}</td>
                  <td className="py-2.5">
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
              ))}
            </tbody>
          </table>
        </div>
      )}

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

function CountTile({ label, value, color, icon, onClick, active }: {
  label: string; value: number | undefined; color: string; icon: React.ReactNode;
  onClick?: () => void; active?: boolean;
}) {
  const map: Record<string, string> = {
    slate:   'bg-slate-50 text-slate-700 border-slate-200',
    amber:   'bg-amber-50 text-amber-700 border-amber-200',
    blue:    'bg-blue-50 text-blue-700 border-blue-200',
    violet:  'bg-violet-50 text-violet-700 border-violet-200',
    rose:    'bg-rose-50 text-rose-700 border-rose-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  const cls = map[color] || map.slate;
  const inner = (
    <div className={clsx(
      'rounded-xl border p-3 transition',
      cls,
      onClick && 'cursor-pointer hover:shadow-md hover:scale-[1.02] active:scale-[0.98]',
      active && 'ring-2 ring-current',
    )}>
      <div className="flex items-center gap-2 mb-1.5 opacity-80">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums">{value?.toLocaleString() ?? '—'}</div>
    </div>
  );
  return onClick ? <button type="button" onClick={onClick} className="block w-full text-left">{inner}</button> : inner;
}
