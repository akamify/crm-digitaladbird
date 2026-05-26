'use client';
import { useState, FormEvent } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Settings as Cog, Copy, Webhook, Facebook, FileText, Clock, Play,
  CheckCircle2, XCircle, AlertCircle, RefreshCw, Sheet, ExternalLink, Eye,
  Loader2, ChevronDown, ChevronRight, Zap, Shield, Globe, Search,
  ArrowLeft, Database, Activity, Radio, Key, Megaphone, BarChart3,
  ChevronLeft, Download, Filter, Users,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Modal, Skeleton, EmptyState } from '@/components/ui/Modal';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { useUsers } from '@/hooks/useUsers';
import { fmtRelative, fmtDate, humanize, clsx } from '@/lib/format';
import {
  useMetaPagesEnriched, useMetaFormsEnriched, useFormLeads, usePageLeads,
  useMetaWebhookLogs, useSheetsEnriched, useMetaTokenStatus,
  useMetaSubscriptionStatus, useCampaignsEnriched,
  useSyncCampaigns, useSyncLeads, useUpdateMetaToken, useSubscribePage,
} from '@/hooks/useAdminEnterprise';
import type { DistributionRule, MetaPage, MetaForm } from '@/types';

type SettingsTab = 'overview' | 'meta-pages' | 'meta-forms' | 'campaigns' | 'sheets' | 'admin-tools' | 'webhook-logs';

export default function SettingsPage() {
  return (
    <AppShell title="Settings & Integrations" subtitle="Meta integration, Google Sheets, distribution, and admin tools" roles={['super_admin']}>
      <SettingsInner />
    </AppShell>
  );
}

function SettingsInner() {
  const [tab, setTab] = useState<SettingsTab>('overview');

  const tabs: { key: SettingsTab; label: string; Icon: typeof Cog }[] = [
    { key: 'overview', label: 'Overview', Icon: Cog },
    { key: 'meta-pages', label: 'Meta Pages', Icon: Facebook },
    { key: 'meta-forms', label: 'Lead Forms', Icon: FileText },
    { key: 'campaigns', label: 'Campaigns', Icon: Megaphone },
    { key: 'sheets', label: 'Google Sheets', Icon: Sheet },
    { key: 'admin-tools', label: 'Admin Tools', Icon: Shield },
    { key: 'webhook-logs', label: 'Logs & Sync', Icon: Activity },
  ];

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={clsx(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition',
              tab === t.key ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
            )}>
            <t.Icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab onNavigate={setTab} />}
      {tab === 'meta-pages' && <MetaPagesTab />}
      {tab === 'meta-forms' && <MetaFormsTab />}
      {tab === 'campaigns' && <CampaignsTab />}
      {tab === 'sheets' && <SheetsTab />}
      {tab === 'admin-tools' && <AdminToolsTab />}
      {tab === 'webhook-logs' && <WebhookLogsTab />}
    </div>
  );
}

/* ═══════════════════ STATUS DOT ═══════════════════ */
function StatusDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (ok) return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (warn) return <AlertCircle className="h-4 w-4 text-amber-500" />;
  return <XCircle className="h-4 w-4 text-red-400" />;
}

/* ═══════════════════ OVERVIEW TAB ═══════════════════ */
function OverviewTab({ onNavigate }: { onNavigate: (tab: SettingsTab) => void }) {
  const qc = useQueryClient();

  interface IntStatus {
    meta: {
      configured: boolean; verify_token_set: boolean;
      pages: { page_id: string; page_name: string; has_token: boolean }[];
      campaigns: number; ad_accounts: number; total_meta_leads: number; last_meta_lead_at: string | null;
    };
    sheets: {
      configured: boolean; sheet_id: string; sheet_name: string; service_account_email: string;
      api_connected: boolean; sheet_accessible: boolean; sheet_title: string | null;
      row_count: number; error: string | null;
    };
    leads: { total: number };
  }

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['integration-status'],
    queryFn: () => apiGet<IntStatus>('/integrations/status'),
    refetchInterval: 60000,
  });

  const sheetSync = useMutation({
    mutationFn: () => apiPost<{ synced: number }>('/sheets/sync', {}),
    onSuccess: (r) => { toast.success(`Synced ${r.synced} leads to Google Sheet`); qc.invalidateQueries({ queryKey: ['integration-status'] }); },
    onError: () => toast.error('Sheet sync failed'),
  });

  const m = data?.meta;
  const s = data?.sheets;

  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin.replace(/\/$/, '')}/api/webhooks/meta`
    : '/api/webhooks/meta';

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Meta Pages', Icon: Facebook, color: 'text-blue-700 bg-blue-50 border-blue-200', tab: 'meta-pages' as SettingsTab },
          { label: 'Lead Forms', Icon: FileText, color: 'text-violet-700 bg-violet-50 border-violet-200', tab: 'meta-forms' as SettingsTab },
          { label: 'Campaigns', Icon: Megaphone, color: 'text-amber-700 bg-amber-50 border-amber-200', tab: 'campaigns' as SettingsTab },
          { label: 'Google Sheets', Icon: Sheet, color: 'text-emerald-700 bg-emerald-50 border-emerald-200', tab: 'sheets' as SettingsTab },
          { label: 'Admin Tools', Icon: Shield, color: 'text-rose-700 bg-rose-50 border-rose-200', tab: 'admin-tools' as SettingsTab },
          { label: 'Sync Logs', Icon: Activity, color: 'text-slate-700 bg-slate-50 border-slate-200', tab: 'webhook-logs' as SettingsTab },
        ].map(c => (
          <button key={c.label} onClick={() => onNavigate(c.tab)}
            className={clsx('rounded-xl border p-3 text-left transition hover:shadow-md hover:scale-[1.02]', c.color)}>
            <c.Icon className="h-5 w-5 mb-2" />
            <div className="text-xs font-semibold">{c.label}</div>
          </button>
        ))}
      </div>

      {/* Integration status cards */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Integration Status</h2>
        <button onClick={() => refetch()} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>

      {isLoading ? <Skeleton className="h-40" /> : !data ? (
        <p className="text-sm text-slate-500">Could not load integration status.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Meta status */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 hover:shadow-md transition cursor-pointer" onClick={() => onNavigate('meta-pages')}>
            <div className="mb-3 flex items-center gap-2">
              <Facebook className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-semibold text-slate-900">Facebook / Meta Lead Ads</span>
              <ExternalLink className="h-3 w-3 text-slate-400 ml-auto" />
            </div>
            <div className="space-y-2 text-sm">
              <Row label="Meta configured"><StatusDot ok={!!m?.configured} /></Row>
              <Row label="Verify token"><StatusDot ok={!!m?.verify_token_set} /></Row>
              <Row label="Pages connected"><span className="text-xs font-bold text-brand-700">{m?.pages?.length || 0}</span></Row>
              <Row label="Campaigns synced"><span className="text-xs font-bold text-slate-700">{m?.campaigns || 0}</span></Row>
              <Row label="Ad accounts"><span className="text-xs font-bold text-slate-700">{m?.ad_accounts || 0}</span></Row>
              {m?.pages?.map(p => (
                <div key={p.page_id} className="flex items-center justify-between rounded bg-blue-50 px-2 py-1">
                  <span className="text-xs text-blue-800 font-medium">{p.page_name}</span>
                  <StatusDot ok={p.has_token} warn={!p.has_token} />
                </div>
              ))}
              <div className="border-t border-slate-100 pt-2 flex items-center justify-between">
                <span className="text-slate-600">Meta leads ingested</span>
                <span className="text-xs font-bold tabular-nums text-slate-900">{m?.total_meta_leads ?? 0}</span>
              </div>
              {m?.last_meta_lead_at && <Row label="Last meta lead"><span className="text-xs text-slate-500">{fmtRelative(m.last_meta_lead_at)}</span></Row>}
            </div>
          </div>

          {/* Google Sheets status */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 hover:shadow-md transition cursor-pointer" onClick={() => onNavigate('sheets')}>
            <div className="mb-3 flex items-center gap-2">
              <Sheet className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-semibold text-slate-900">Google Sheets Sync</span>
              <ExternalLink className="h-3 w-3 text-slate-400 ml-auto" />
            </div>
            <div className="space-y-2 text-sm">
              <Row label="Sheet ID">
                <span className="max-w-[180px] truncate text-xs font-mono text-slate-500" title={s?.sheet_id}>{s?.sheet_id ? s.sheet_id.slice(0, 20) + '...' : 'Not set'}</span>
              </Row>
              <Row label="Credentials"><StatusDot ok={!!s?.configured} /></Row>
              <Row label="API connected"><StatusDot ok={!!s?.api_connected} warn={!s?.api_connected && !!s?.configured} /></Row>
              <Row label="Sheet accessible"><StatusDot ok={!!s?.sheet_accessible} warn={!s?.sheet_accessible && !!s?.api_connected} /></Row>
              <Row label="Sheet name"><span className="text-xs text-slate-700">{s?.sheet_title || s?.sheet_name || '—'}</span></Row>
              {s?.row_count != null && <Row label="Rows in sheet"><span className="text-xs font-bold tabular-nums text-slate-900">{s.row_count}</span></Row>}
              {s?.error && <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-600">{s.error}</div>}
              <div className="border-t border-slate-100 pt-2 flex items-center justify-between">
                <span className="text-slate-600">Total leads in DB</span>
                <span className="text-xs font-bold tabular-nums text-slate-900">{data.leads.total}</span>
              </div>
              <Button size="sm" variant="outline" className="mt-2 w-full" leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                onClick={(e) => { e.stopPropagation(); sheetSync.mutate(); }} loading={sheetSync.isPending}>
                Sync all leads to sheet
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Webhook URL card */}
      <div className="card-padded">
        <div className="mb-3 flex items-center gap-2">
          <Webhook className="h-4 w-4 text-brand-600" />
          <h2 className="text-sm font-semibold text-slate-900">Meta Lead Ads Webhook</h2>
        </div>
        <p className="text-sm text-slate-600">
          Configure this URL in Meta App webhook settings (Object: <code className="bg-slate-100 px-1 rounded">page</code>, Field: <code className="bg-slate-100 px-1 rounded">leadgen</code>).
        </p>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
          <span className="truncate">{webhookUrl}</span>
          <button onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success('URL copied'); }}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-600 hover:bg-slate-100">
            <Copy className="h-3 w-3" /> Copy
          </button>
        </div>
      </div>

      {/* Auto Distribution */}
      <AutoDistributionCard />

      {/* Distribution Rules */}
      <DistributionRulesCard />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between"><span className="text-slate-600">{label}</span>{children}</div>;
}

/* ═══════════════════ META PAGES TAB ═══════════════════ */
function MetaPagesTab() {
  const { data: pages, isLoading } = useMetaPagesEnriched();
  const [viewPageId, setViewPageId] = useState<string | null>(null);
  const [leadsPage, setLeadsPage] = useState(1);
  const pageLeads = usePageLeads(viewPageId, leadsPage);

  const [addOpen, setAddOpen] = useState(false);
  const [pageId, setPageId] = useState('');
  const [pageName, setPageName] = useState('');
  const [token, setToken] = useState('');
  const qc = useQueryClient();

  const add = useMutation({
    mutationFn: () => apiPost('/meta/pages', { page_id: pageId, page_name: pageName, page_access_token: token }),
    onSuccess: () => { toast.success('Page connected'); qc.invalidateQueries({ queryKey: ['admin'] }); setAddOpen(false); setPageId(''); setPageName(''); setToken(''); },
    onError: () => toast.error('Failed to connect page'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Facebook className="h-5 w-5 text-blue-600" />
          <h1 className="text-lg font-semibold text-slate-900">Meta Pages</h1>
          <span className="chip-slate">{pages?.length || 0} connected</span>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>Add Page</Button>
      </div>

      {isLoading ? <Skeleton className="h-64" /> : !pages?.length ? (
        <EmptyState title="No Meta pages connected" description="Add a Page Access Token and Page ID from your Meta Business account." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {pages.map(p => (
            <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:shadow-md transition">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={clsx('h-2.5 w-2.5 rounded-full', p.is_active ? 'bg-emerald-500' : 'bg-slate-300')} />
                  <span className="font-semibold text-slate-900">{p.page_name || p.page_id}</span>
                </div>
                <div className="flex items-center gap-1">
                  <StatusDot ok={p.has_token} warn={!p.has_token} />
                  <span className="text-[10px] text-slate-500">{p.has_token ? 'Token OK' : 'No token'}</span>
                </div>
              </div>
              <div className="text-xs font-mono text-slate-500 mb-3">{p.page_id}</div>

              {/* Stats */}
              <div className="grid grid-cols-4 gap-2 mb-3">
                <MiniStat label="Leads" value={p.lead_count} color="text-slate-900" />
                <MiniStat label="Today" value={p.today_leads} color="text-brand-700" />
                <MiniStat label="Converted" value={p.conversions} color="text-emerald-700" />
                <MiniStat label="Forms" value={p.form_count} color="text-violet-700" />
              </div>
              {p.last_lead_at && <div className="text-[10px] text-slate-500 mb-3">Last lead: {fmtRelative(p.last_lead_at)}</div>}

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                <a href={`https://www.facebook.com/${p.page_id}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 transition">
                  <Facebook className="h-3 w-3" /> Facebook Page <ExternalLink className="h-2.5 w-2.5" />
                </a>
                <a href={`https://business.facebook.com/latest/inbox/all?asset_id=${p.page_id}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 transition">
                  <Globe className="h-3 w-3" /> Meta Business <ExternalLink className="h-2.5 w-2.5" />
                </a>
                <a href={`https://www.facebook.com/ads/lead_forms/?page_id=${p.page_id}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100 transition">
                  <FileText className="h-3 w-3" /> Lead Ads <ExternalLink className="h-2.5 w-2.5" />
                </a>
                <button onClick={() => { setViewPageId(p.page_id); setLeadsPage(1); }}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 transition">
                  <Eye className="h-3 w-3" /> View Leads ({p.lead_count})
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Page Leads Modal */}
      <Modal open={!!viewPageId} onClose={() => setViewPageId(null)} title={`Leads from Page`} size="lg">
        {pageLeads.isLoading ? <Skeleton className="h-48" /> : !pageLeads.data?.rows?.length ? (
          <div className="py-8 text-center text-sm text-slate-500">No leads from this page</div>
        ) : (
          <div>
            <div className="text-xs text-slate-500 mb-3">{pageLeads.data.total} total leads</div>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 font-medium">Lead</th>
                  <th className="py-2 pr-3 font-medium">Stage</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 font-medium">Created</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {pageLeads.data.rows.map((l: any) => (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="py-2 pr-3">
                        <Link href={`/leads/${l.id}`} className="hover:text-brand-600">
                          <div className="font-medium text-slate-900">{l.full_name || 'Unnamed'}</div>
                          <div className="text-xs text-slate-500">{l.phone || '—'}</div>
                        </Link>
                      </td>
                      <td className="py-2 pr-3"><span className="chip chip-slate">{humanize(l.stage)}</span></td>
                      <td className="py-2 pr-3"><span className="chip chip-slate">{humanize(l.call_status)}</span></td>
                      <td className="py-2 text-xs text-slate-500">{fmtDate(l.created_at, 'dd MMM HH:mm')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {/* Add Page Modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Connect Meta Page"
        description="Generate a long-lived Page Access Token in Meta Developer console."
        footer={<><Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button><Button onClick={() => add.mutate()} loading={add.isPending} disabled={!pageId || !token}>Save</Button></>}>
        <div className="space-y-3">
          <Input label="Page ID" value={pageId} onChange={(e) => setPageId(e.target.value)} required />
          <Input label="Display name" value={pageName} onChange={(e) => setPageName(e.target.value)} placeholder="Friendly label" />
          <Input label="Page Access Token" type="password" value={token} onChange={(e) => setToken(e.target.value)} hint="Stored encrypted." required />
        </div>
      </Modal>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
      <div className={clsx('text-sm font-bold tabular-nums', color)}>{value?.toLocaleString?.() ?? 0}</div>
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

/* ═══════════════════ META FORMS TAB ═══════════════════ */
function MetaFormsTab() {
  const { data: forms, isLoading } = useMetaFormsEnriched();
  const [viewFormId, setViewFormId] = useState<string | null>(null);
  const [formLeadFilters, setFormLeadFilters] = useState<{ page?: number; stage?: string; call_status?: string }>({});
  const formLeads = useFormLeads(viewFormId, formLeadFilters);

  const [addOpen, setAddOpen] = useState(false);
  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formPageId, setFormPageId] = useState('');
  const [campaign, setCampaign] = useState('');
  const [product, setProduct] = useState('');
  const qc = useQueryClient();

  const add = useMutation({
    mutationFn: () => apiPost('/meta/forms', { form_id: formId, form_name: formName, page_id: formPageId || null, campaign_label: campaign || null, product_tag: product || null }),
    onSuccess: () => { toast.success('Form registered'); qc.invalidateQueries({ queryKey: ['admin'] }); setAddOpen(false); setFormId(''); setFormName(''); setFormPageId(''); setCampaign(''); setProduct(''); },
    onError: () => toast.error('Failed'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-violet-600" />
          <h1 className="text-lg font-semibold text-slate-900">Meta Lead Forms</h1>
          <span className="chip-slate">{forms?.length || 0} forms</span>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>Register Form</Button>
      </div>

      {isLoading ? <Skeleton className="h-64" /> : !forms?.length ? (
        <EmptyState title="No forms registered" description="Register Meta Lead Ads forms to track and route incoming leads." />
      ) : (
        <div className="space-y-4">
          {forms.map(f => (
            <div key={f.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:shadow-md transition">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className={clsx('h-2.5 w-2.5 rounded-full', f.is_active ? 'bg-emerald-500' : 'bg-slate-300')} />
                    <span className="font-semibold text-slate-900">{f.form_name}</span>
                    {f.campaign_label && <span className="chip-blue text-[10px]">{f.campaign_label}</span>}
                    {f.product_tag && <span className="chip-slate text-[10px]">{f.product_tag}</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                    <span className="font-mono">{f.form_id}</span>
                    {f.page_name && <span>Page: <strong className="text-slate-700">{f.page_name}</strong></span>}
                  </div>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-5 gap-2 mb-3">
                <MiniStat label="Total Leads" value={f.lead_count} color="text-slate-900" />
                <MiniStat label="Today" value={f.today_leads} color="text-brand-700" />
                <MiniStat label="Converted" value={f.conversions} color="text-emerald-700" />
                <MiniStat label="Pending" value={f.pending_leads} color="text-amber-700" />
                <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
                  <div className="text-sm font-bold tabular-nums text-violet-700">{f.lead_count > 0 ? Math.round(f.conversions / f.lead_count * 100) : 0}%</div>
                  <div className="text-[9px] uppercase tracking-wide text-slate-500">Conv %</div>
                </div>
              </div>
              {f.last_lead_at && <div className="text-[10px] text-slate-500 mb-3">Last lead: {fmtRelative(f.last_lead_at)}</div>}

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { setViewFormId(f.form_id); setFormLeadFilters({}); }}
                  className="inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-[11px] font-medium text-brand-700 hover:bg-brand-100 transition">
                  <Eye className="h-3 w-3" /> View Leads ({f.lead_count})
                </button>
                <a href={`https://www.facebook.com/ads/lead_forms/?form_id=${f.form_id}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 transition">
                  <FileText className="h-3 w-3" /> View Form <ExternalLink className="h-2.5 w-2.5" />
                </a>
                <a href={`https://www.facebook.com/ads/leadgen/form_details/?form_id=${f.form_id}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100 transition">
                  <Database className="h-3 w-3" /> Form Details <ExternalLink className="h-2.5 w-2.5" />
                </a>
                {f.page_id && (
                  <a href={`https://www.facebook.com/${f.page_id}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 transition">
                    <Facebook className="h-3 w-3" /> Open in Meta <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form Leads Modal */}
      <Modal open={!!viewFormId} onClose={() => setViewFormId(null)} title="Leads from Form" size="lg">
        <div className="space-y-3">
          {/* Filters */}
          <div className="flex gap-2">
            <select className="input w-28 text-xs" value={formLeadFilters.stage || ''} onChange={e => setFormLeadFilters(f => ({ ...f, stage: e.target.value || undefined, page: 1 }))}>
              <option value="">All Stages</option>
              <option value="new">New</option><option value="contacted">Contacted</option><option value="qualified">Qualified</option>
              <option value="won">Won</option><option value="lost">Lost</option>
            </select>
            <select className="input w-32 text-xs" value={formLeadFilters.call_status || ''} onChange={e => setFormLeadFilters(f => ({ ...f, call_status: e.target.value || undefined, page: 1 }))}>
              <option value="">All Status</option>
              <option value="not_called">Not Called</option><option value="interested">Interested</option>
              <option value="converted">Converted</option><option value="not_interested">Not Interested</option>
            </select>
          </div>

          {formLeads.isLoading ? <Skeleton className="h-48" /> : !formLeads.data?.rows?.length ? (
            <div className="py-8 text-center text-sm text-slate-500">No leads matching filters</div>
          ) : (
            <>
              <div className="text-xs text-slate-500">{formLeads.data.total} total leads</div>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3 font-medium">Lead</th>
                    <th className="py-2 pr-3 font-medium">Campaign</th>
                    <th className="py-2 pr-3 font-medium">Stage</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Assigned</th>
                    <th className="py-2 font-medium">Created</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {formLeads.data.rows.map((l: any) => (
                      <tr key={l.id} className="hover:bg-slate-50">
                        <td className="py-2 pr-3">
                          <Link href={`/leads/${l.id}`} className="hover:text-brand-600">
                            <div className="font-medium text-slate-900">{l.full_name || 'Unnamed'}</div>
                            <div className="text-xs text-slate-500">{l.phone || '—'} {l.email ? `· ${l.email}` : ''}</div>
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-xs text-slate-600">{l.campaign_name || '—'}</td>
                        <td className="py-2 pr-3"><span className={clsx('chip', l.stage === 'won' ? 'chip-green' : l.stage === 'lost' ? 'chip-red' : 'chip-slate')}>{humanize(l.stage)}</span></td>
                        <td className="py-2 pr-3"><span className={clsx('chip', l.call_status === 'converted' ? 'chip-green' : l.call_status === 'not_called' ? 'chip-amber' : 'chip-slate')}>{humanize(l.call_status)}</span></td>
                        <td className="py-2 pr-3 text-xs text-slate-600">{l.assigned_to_name || <span className="text-amber-600">Unassigned</span>}</td>
                        <td className="py-2 text-xs text-slate-500">{fmtDate(l.created_at, 'dd MMM HH:mm')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {formLeads.data.total > 20 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <button disabled={(formLeadFilters.page || 1) <= 1} onClick={() => setFormLeadFilters(f => ({ ...f, page: (f.page || 1) - 1 }))}
                    className="btn-ghost rounded px-2 py-1 text-xs disabled:opacity-40"><ChevronLeft className="h-3 w-3" /></button>
                  <span className="text-xs text-slate-500">Page {formLeadFilters.page || 1}</span>
                  <button onClick={() => setFormLeadFilters(f => ({ ...f, page: (f.page || 1) + 1 }))}
                    className="btn-ghost rounded px-2 py-1 text-xs"><ChevronRight className="h-3 w-3" /></button>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      {/* Add Form Modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Register Meta Lead Form" size="lg"
        footer={<><Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button><Button onClick={() => add.mutate()} loading={add.isPending} disabled={!formId || !formName}>Save</Button></>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Form ID" value={formId} onChange={(e) => setFormId(e.target.value)} required />
          <Input label="Form name" value={formName} onChange={(e) => setFormName(e.target.value)} required />
          <Input label="Page ID (optional)" value={formPageId} onChange={(e) => setFormPageId(e.target.value)} />
          <Input label="Campaign label" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="e.g. Real-Estate Q4" />
          <Input label="Product tag" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. 2BHK, 3BHK" />
        </div>
      </Modal>
    </div>
  );
}

/* ═══════════════════ CAMPAIGNS TAB ═══════════════════ */
function CampaignsTab() {
  const { data: campaigns, isLoading } = useCampaignsEnriched();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const filtered = (campaigns || []).filter(c => {
    if (filter === 'active' && !c.is_active) return false;
    if (filter === 'inactive' && c.is_active) return false;
    if (search && !c.campaign_name.toLowerCase().includes(search.toLowerCase()) && !(c.internal_label || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Megaphone className="h-5 w-5 text-amber-600" />
        <h1 className="text-lg font-semibold text-slate-900">Campaigns</h1>
        <span className="chip-slate">{campaigns?.length || 0} total</span>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input className="input pl-10" placeholder="Search campaigns..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5">
          {(['all', 'active', 'inactive'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={clsx('rounded-md px-3 py-1.5 text-xs font-medium transition', filter === f ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? <Skeleton className="h-64" /> : !filtered.length ? (
        <EmptyState title="No campaigns found" description={search ? 'Try different search terms.' : 'Campaigns appear once synced from Meta.'} icon={<Megaphone className="h-6 w-6" />} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filtered.map(c => (
            <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:shadow-md transition">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={clsx('h-2.5 w-2.5 rounded-full', c.is_active ? 'bg-emerald-500' : 'bg-slate-300')} />
                  <span className="font-semibold text-slate-900 truncate max-w-[250px]">{c.campaign_name}</span>
                </div>
                <span className={c.is_active ? 'chip-green' : 'chip-slate'}>{c.is_active ? 'Active' : 'Inactive'}</span>
              </div>
              {c.internal_label && <div className="mb-2"><span className="chip-blue text-[10px]">{c.internal_label}</span> {c.category && <span className="chip-slate text-[10px] ml-1">{c.category}</span>}</div>}

              <div className="grid grid-cols-4 gap-2 mb-3">
                <MiniStat label="Leads" value={c.lead_count} color="text-slate-900" />
                <MiniStat label="Today" value={c.today_leads} color="text-brand-700" />
                <MiniStat label="Converted" value={c.conversions} color="text-emerald-700" />
                <MiniStat label="Pending" value={c.pending_leads} color="text-amber-700" />
              </div>

              <div className="text-xs text-slate-500 space-y-0.5">
                {c.connected_form && <div>Form: <strong className="text-slate-700">{c.connected_form}</strong></div>}
                {c.connected_page && <div>Page: <strong className="text-slate-700">{c.connected_page}</strong></div>}
                {c.last_lead_at && <div>Last activity: {fmtRelative(c.last_lead_at)}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════ SHEETS TAB ═══════════════════ */
function SheetsTab() {
  const { data, isLoading } = useSheetsEnriched();
  const qc = useQueryClient();

  const sheetSync = useMutation({
    mutationFn: () => apiPost<{ synced: number }>('/sheets/sync', {}),
    onSuccess: (r) => { toast.success(`Synced ${r.synced} leads`); qc.invalidateQueries({ queryKey: ['admin'] }); },
    onError: () => toast.error('Sync failed'),
  });

  const triggerSync = useMutation({
    mutationFn: () => apiPost('/admin/sheets/trigger-sync', {}),
    onSuccess: () => { toast.success('Manual sync triggered'); qc.invalidateQueries({ queryKey: ['admin'] }); },
    onError: () => toast.error('Trigger failed'),
  });

  const cfg = data?.config;
  const sheetUrl = cfg?.sheet_id ? `https://docs.google.com/spreadsheets/d/${cfg.sheet_id}` : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Sheet className="h-5 w-5 text-emerald-600" />
        <h1 className="text-lg font-semibold text-slate-900">Google Sheets Integration</h1>
      </div>

      {isLoading ? <Skeleton className="h-64" /> : (
        <>
          {/* Connection card */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className={clsx('h-3 w-3 rounded-full', cfg?.configured ? 'bg-emerald-500 animate-pulse' : 'bg-red-400')} />
                <span className="font-semibold text-slate-900">{cfg?.configured ? 'Connected' : 'Not Configured'}</span>
              </div>
              {sheetUrl && (
                <a href={sheetUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition">
                  <Sheet className="h-3.5 w-3.5" /> Open Sheet <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Sheet ID</div>
                <div className="text-xs font-mono text-slate-700 truncate">{cfg?.sheet_id || 'Not set'}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Sheet Name</div>
                <div className="text-xs text-slate-700">{cfg?.sheet_name || 'Sheet1'}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Service Account</div>
                <div className="text-xs font-mono text-slate-700 truncate">{cfg?.service_account_email || 'Not set'}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Key Path</div>
                <div className="text-xs font-mono text-slate-700 truncate">{cfg?.key_path || 'Not set'}</div>
              </div>
            </div>

            {/* Lead stats */}
            {data?.stats && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <MiniStat label="Total Leads in DB" value={data.stats.total_leads} color="text-slate-900" />
                <MiniStat label="Today's Leads" value={data.stats.today_leads} color="text-brand-700" />
              </div>
            )}

            {/* Actions */}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                onClick={() => sheetSync.mutate()} loading={sheetSync.isPending}>
                Sync All Leads to Sheet
              </Button>
              <Button size="sm" variant="outline" leftIcon={<Zap className="h-3.5 w-3.5" />}
                onClick={() => triggerSync.mutate()} loading={triggerSync.isPending}>
                Manual Sync Trigger
              </Button>
              {sheetUrl && (
                <a href={sheetUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition">
                  <ExternalLink className="h-3.5 w-3.5" /> View Synced Rows
                </a>
              )}
            </div>
          </div>

          {/* Sync Logs */}
          <div className="card-padded">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Sync Activity Log</h2>
            {data?.sync_logs?.length ? (
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">User</th>
                    <th className="py-2 pr-3 font-medium">Action</th>
                    <th className="py-2 font-medium">Details</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {data.sync_logs.map((log: any) => (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="py-2 pr-3 text-xs text-slate-500">{fmtRelative(log.created_at)}</td>
                        <td className="py-2 pr-3 text-xs text-slate-700">{log.user_name || '—'}</td>
                        <td className="py-2 pr-3"><span className="chip-slate text-[10px]">{log.action}</span></td>
                        <td className="py-2 text-xs text-slate-500 truncate max-w-[200px]">{typeof log.metadata === 'object' ? JSON.stringify(log.metadata) : log.metadata}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="py-6 text-center text-sm text-slate-500">No sync logs yet</div>}
          </div>
        </>
      )}
    </div>
  );
}

/* ═══════════════════ ADMIN TOOLS TAB ═══════════════════ */
function AdminToolsTab() {
  const tokenStatus = useMetaTokenStatus();
  const subscriptions = useMetaSubscriptionStatus();
  const syncCampaigns = useSyncCampaigns();
  const syncLeads = useSyncLeads();
  const updateToken = useUpdateMetaToken();
  const subscribePage = useSubscribePage();
  const qc = useQueryClient();

  const [tokenModal, setTokenModal] = useState(false);
  const [userToken, setUserToken] = useState('');
  const [pageToken, setPageToken] = useState('');

  function handleUpdateToken() {
    if (!userToken && !pageToken) { toast.error('Enter at least one token'); return; }
    updateToken.mutate(
      { user_access_token: userToken || undefined, page_access_token: pageToken || undefined },
      { onSuccess: () => { toast.success('Token updated + campaigns synced'); setTokenModal(false); setUserToken(''); setPageToken(''); }, onError: () => toast.error('Update failed') }
    );
  }

  const ts = tokenStatus.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-rose-600" />
        <h1 className="text-lg font-semibold text-slate-900">Meta Admin Tools</h1>
      </div>

      {/* Token Status */}
      <div className="card-padded">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-900">Token & Connectivity Status</h2>
          <button onClick={() => tokenStatus.refetch()} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
            <RefreshCw className="h-3 w-3" /> Check
          </button>
        </div>
        {tokenStatus.isLoading ? <Skeleton className="h-32" /> : ts ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <TokenBadge label="Page Token" ok={ts.has_page_token} />
              <TokenBadge label="User Token" ok={ts.has_user_token} />
              <TokenBadge label="App Secret" ok={ts.has_app_secret} />
              <TokenBadge label="Verify Token" ok={ts.has_verify_token} />
            </div>
            {ts.connectivity && (
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-700 mb-1">Connectivity</div>
                <div className="text-xs text-slate-600">{typeof ts.connectivity === 'object' ? JSON.stringify(ts.connectivity, null, 2) : String(ts.connectivity)}</div>
              </div>
            )}
            {ts.error && <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{ts.error}</div>}
          </div>
        ) : <div className="text-sm text-slate-500">Could not load status</div>}
      </div>

      {/* Admin actions grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ToolCard title="Refresh Meta Data" desc="Re-fetch all pages, forms, and campaign data from Meta Graph API"
          Icon={RefreshCw} color="blue" loading={syncCampaigns.isPending}
          onClick={() => syncCampaigns.mutate(undefined, { onSuccess: () => toast.success('Campaigns synced'), onError: () => toast.error('Sync failed') })} />

        <ToolCard title="Re-sync Lead Forms" desc="Pull latest leads from all registered forms via Meta API"
          Icon={Download} color="violet" loading={syncLeads.isPending}
          onClick={() => syncLeads.mutate({}, { onSuccess: () => toast.success('Leads synced'), onError: () => toast.error('Sync failed') })} />

        <ToolCard title="Update Access Token" desc="Update Meta page or user access token without restarting server"
          Icon={Key} color="amber" onClick={() => setTokenModal(true)} />

        <ToolCard title="Check Token Status" desc="Validate current access tokens and check their expiry"
          Icon={Shield} color="emerald" loading={tokenStatus.isLoading}
          onClick={() => { tokenStatus.refetch(); toast.success('Token check initiated'); }} />

        <ToolCard title="Verify Webhook" desc="Check webhook subscription status for all connected pages"
          Icon={Webhook} color="rose" loading={subscriptions.isLoading}
          onClick={() => { subscriptions.refetch(); toast.success('Checking subscriptions...'); }} />

        <ToolCard title="Re-fetch Campaigns" desc="Force sync all campaigns from all ad accounts"
          Icon={Megaphone} color="slate" loading={syncCampaigns.isPending}
          onClick={() => syncCampaigns.mutate(undefined, { onSuccess: () => toast.success('Done'), onError: () => toast.error('Failed') })} />
      </div>

      {/* Webhook Subscriptions */}
      {subscriptions.data && (
        <div className="card-padded">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Webhook Subscriptions</h2>
          <div className="space-y-2">
            {subscriptions.data.map((s: any) => (
              <div key={s.page_id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                <div>
                  <div className="font-medium text-sm text-slate-900">{s.page_name}</div>
                  <div className="text-xs text-slate-500 font-mono">{s.page_id}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={s.status === 'ok' ? 'chip-green' : 'chip-red'}>{s.status === 'ok' ? 'Subscribed' : 'Error'}</span>
                  <button onClick={() => subscribePage.mutate(s.page_id, { onSuccess: () => toast.success('Reconnected'), onError: () => toast.error('Failed') })}
                    className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-700 hover:bg-blue-100">
                    <Radio className="h-3 w-3" /> Reconnect
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Update Token Modal */}
      <Modal open={tokenModal} onClose={() => setTokenModal(false)} title="Update Meta Access Token"
        footer={<><Button variant="ghost" onClick={() => setTokenModal(false)}>Cancel</Button><Button onClick={handleUpdateToken} loading={updateToken.isPending}>Update & Sync</Button></>}>
        <div className="space-y-3">
          <p className="text-xs text-slate-600">Tokens are updated in-memory immediately. Campaigns auto-sync after update.</p>
          <Input label="User Access Token" type="password" value={userToken} onChange={e => setUserToken(e.target.value)} placeholder="Long-lived user token" />
          <Input label="Page Access Token" type="password" value={pageToken} onChange={e => setPageToken(e.target.value)} placeholder="Long-lived page token" />
        </div>
      </Modal>
    </div>
  );
}

function TokenBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={clsx('rounded-lg border p-2.5 text-center', ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50')}>
      <div className="mb-1">{ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600 mx-auto" /> : <XCircle className="h-4 w-4 text-red-500 mx-auto" />}</div>
      <div className={clsx('text-[10px] font-semibold', ok ? 'text-emerald-700' : 'text-red-700')}>{label}</div>
    </div>
  );
}

function ToolCard({ title, desc, Icon, color, loading, onClick }: {
  title: string; desc: string; Icon: typeof RefreshCw; color: string; loading?: boolean; onClick: () => void;
}) {
  const colors: Record<string, string> = {
    blue: 'border-blue-200 hover:bg-blue-50 text-blue-700',
    violet: 'border-violet-200 hover:bg-violet-50 text-violet-700',
    amber: 'border-amber-200 hover:bg-amber-50 text-amber-700',
    emerald: 'border-emerald-200 hover:bg-emerald-50 text-emerald-700',
    rose: 'border-rose-200 hover:bg-rose-50 text-rose-700',
    slate: 'border-slate-200 hover:bg-slate-50 text-slate-700',
  };
  return (
    <button onClick={onClick} disabled={loading}
      className={clsx('rounded-xl border bg-white p-4 text-left transition hover:shadow-md disabled:opacity-60', colors[color] || colors.slate)}>
      <div className="flex items-center gap-2 mb-2">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <p className="text-xs text-slate-500">{desc}</p>
    </button>
  );
}

/* ═══════════════════ WEBHOOK LOGS TAB ═══════════════════ */
function WebhookLogsTab() {
  const { data, isLoading, refetch } = useMetaWebhookLogs();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-slate-600" />
          <h1 className="text-lg font-semibold text-slate-900">Sync & Webhook Logs</h1>
        </div>
        <button onClick={() => refetch()} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>

      {isLoading ? <Skeleton className="h-64" /> : (
        <>
          {/* Sync logs */}
          <div className="card-padded">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Meta Sync History</h2>
            {data?.sync_logs?.length ? (
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Source</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium text-right">Fetched</th>
                    <th className="py-2 pr-3 font-medium text-right">Created</th>
                    <th className="py-2 font-medium text-right">Dupes</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {data.sync_logs.map((l: any) => (
                      <tr key={l.id} className="hover:bg-slate-50">
                        <td className="py-2 pr-3 text-xs text-slate-500">{fmtRelative(l.started_at)}</td>
                        <td className="py-2 pr-3"><span className="chip-blue text-[10px]">{l.sync_type}</span></td>
                        <td className="py-2 pr-3 text-xs font-mono text-slate-600 truncate max-w-[120px]">{l.source_id || '—'}</td>
                        <td className="py-2 pr-3"><span className={clsx('chip text-[10px]', l.status === 'completed' ? 'chip-green' : l.status === 'failed' ? 'chip-red' : 'chip-amber')}>{l.status || 'unknown'}</span></td>
                        <td className="py-2 pr-3 text-right text-xs tabular-nums">{l.leads_fetched ?? '—'}</td>
                        <td className="py-2 pr-3 text-right text-xs tabular-nums text-emerald-700">{l.leads_created ?? '—'}</td>
                        <td className="py-2 text-right text-xs tabular-nums text-slate-500">{l.leads_duplicate ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="py-6 text-center text-sm text-slate-500">No sync logs yet</div>}
          </div>

          {/* Activity logs */}
          <div className="card-padded">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Meta Activity Logs</h2>
            {data?.activity_logs?.length ? (
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">User</th>
                    <th className="py-2 pr-3 font-medium">Action</th>
                    <th className="py-2 pr-3 font-medium">Entity</th>
                    <th className="py-2 font-medium">Details</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {data.activity_logs.map((l: any) => (
                      <tr key={l.id} className="hover:bg-slate-50">
                        <td className="py-2 pr-3 text-xs text-slate-500">{fmtRelative(l.created_at)}</td>
                        <td className="py-2 pr-3 text-xs text-slate-700">{l.user_name || '—'}</td>
                        <td className="py-2 pr-3"><span className="chip-slate text-[10px]">{l.action}</span></td>
                        <td className="py-2 pr-3 text-xs text-slate-600">{l.entity}</td>
                        <td className="py-2 text-xs text-slate-500 truncate max-w-[200px]">{typeof l.metadata === 'object' ? JSON.stringify(l.metadata) : l.metadata || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="py-6 text-center text-sm text-slate-500">No activity logs</div>}
          </div>

          {/* Audit logs */}
          {data?.audit_logs?.length ? (
            <div className="card-padded">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Webhook Audit Logs</h2>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">User</th>
                    <th className="py-2 pr-3 font-medium">Action</th>
                    <th className="py-2 pr-3 font-medium">Entity</th>
                    <th className="py-2 font-medium">IP</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {data.audit_logs.map((l: any) => (
                      <tr key={l.id} className="hover:bg-slate-50">
                        <td className="py-2 pr-3 text-xs text-slate-500">{fmtRelative(l.created_at)}</td>
                        <td className="py-2 pr-3 text-xs text-slate-700">{l.user_name || '—'}</td>
                        <td className="py-2 pr-3"><span className="chip-slate text-[10px]">{l.action}</span></td>
                        <td className="py-2 pr-3 text-xs text-slate-600">{l.entity} · {l.entity_id}</td>
                        <td className="py-2 text-xs font-mono text-slate-500">{l.ip_address || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ═══════════════════ AUTO DISTRIBUTION (preserved) ═══════════════════ */
type DistSetting = { key: string; value: string; label: string; updated_at: string };

function AutoDistributionCard() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({ queryKey: ['dist-settings'], queryFn: () => apiGet<DistSetting[]>('/settings/distribution') });
  const byKey = (key: string) => settings?.find(s => s.key === key)?.value ?? '';
  const saveMut = useMutation({
    mutationFn: (patch: Record<string, string>) => apiPatch('/settings/distribution', patch),
    onSuccess: () => { toast.success('Settings saved'); qc.invalidateQueries({ queryKey: ['dist-settings'] }); },
    onError: () => toast.error('Save failed'),
  });
  const runNow = useMutation({
    mutationFn: () => apiPost<{ distributed: number; skipped: number }>('/settings/distribution/run-now', {}),
    onSuccess: (res) => toast.success(`Distributed ${res.distributed} lead(s), skipped ${res.skipped}`),
    onError: () => toast.error('Distribution run failed'),
  });

  function toggle() { saveMut.mutate({ auto_distribution_enabled: byKey('auto_distribution_enabled') === 'true' ? 'false' : 'true' }); }
  function saveHours(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    saveMut.mutate({ distribution_start_hour: fd.get('start') as string, distribution_end_hour: fd.get('end') as string });
  }

  const enabled = byKey('auto_distribution_enabled') === 'true';

  return (
    <div className="card-padded">
      <div className="mb-4 flex items-center gap-2">
        <Clock className="h-4 w-4 text-brand-600" />
        <h2 className="text-sm font-semibold text-slate-900">Auto Lead Distribution</h2>
        <span className={`ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${enabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
          {enabled ? 'Active' : 'Paused'}
        </span>
      </div>
      {isLoading ? <div className="h-28 animate-pulse rounded-lg bg-slate-100" /> : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Facebook/Meta leads are stored 24x7. Auto-distribution only assigns leads during the active window (IST).</p>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <div className="text-sm font-medium text-slate-900">Auto-distribution</div>
              <div className="text-xs text-slate-500">{enabled ? 'Leads assigned automatically in the window below' : 'All leads queue until manually triggered'}</div>
            </div>
            <button onClick={toggle} disabled={saveMut.isPending}
              className={`relative inline-flex h-6 w-11 cursor-pointer rounded-full transition-colors focus:outline-none ${enabled ? 'bg-brand-600' : 'bg-slate-300'}`}>
              <span className={`inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
          <form onSubmit={saveHours} className="flex items-end gap-3">
            <div className="flex-1"><label className="label">Start hour (IST)</label><input name="start" type="number" min={0} max={23} defaultValue={byKey('distribution_start_hour') || '8'} className="input w-full" /></div>
            <div className="flex-1"><label className="label">End hour (IST)</label><input name="end" type="number" min={0} max={23} defaultValue={byKey('distribution_end_hour') || '22'} className="input w-full" /></div>
            <Button type="submit" size="sm" loading={saveMut.isPending}>Save hours</Button>
          </form>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
            <div><div className="text-sm font-medium text-slate-900">Run distribution now</div><div className="text-xs text-slate-500">Immediately assign all queued unassigned leads</div></div>
            <Button size="sm" variant="outline" leftIcon={<Play className="h-3.5 w-3.5" />} onClick={() => runNow.mutate()} loading={runNow.isPending}>Run now</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════ DISTRIBUTION RULES (preserved) ═══════════════════ */
function DistributionRulesCard() {
  const qc = useQueryClient();
  const { data: rules, isLoading } = useQuery({ queryKey: ['rules'], queryFn: () => apiGet<DistributionRule[]>('/rules') });
  const { data: forms } = useQuery({ queryKey: ['meta-forms'], queryFn: () => apiGet<MetaForm[]>('/meta/forms') });
  const { data: users } = useUsers();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [strategy, setStrategy] = useState<DistributionRule['strategy']>('round_robin');
  const [formId, setFormId] = useState('');
  const [eligible, setEligible] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: () => apiPost<DistributionRule>('/rules', { name, strategy, form_id: formId || null, eligible_user_ids: eligible.length ? eligible : null }),
    onSuccess: () => { toast.success('Rule created'); qc.invalidateQueries({ queryKey: ['rules'] }); setOpen(false); setName(''); setEligible([]); setFormId(''); },
    onError: (err: unknown) => toast.error((err as any)?.response?.data?.error || 'Create failed'),
  });

  function handleCreate(e: FormEvent) { e.preventDefault(); if (!name.trim()) { toast.error('Name required'); return; } create.mutate(); }
  function toggleEligible(id: string) { setEligible(curr => curr.includes(id) ? curr.filter(x => x !== id) : [...curr, id]); }

  return (
    <div className="card-padded">
      <div className="mb-3 flex items-center gap-2">
        <Cog className="h-4 w-4 text-brand-600" />
        <h2 className="text-sm font-semibold text-slate-900">Distribution Rules</h2>
        <Button size="sm" className="ml-auto" onClick={() => setOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>New rule</Button>
      </div>
      {isLoading ? <Skeleton className="h-40" /> : !rules?.length ? (
        <EmptyState title="No rules configured" description="Without rules, new leads will be unassigned." action={<Button onClick={() => setOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>Create rule</Button>} />
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="py-2 pr-3 font-medium">Name</th><th className="py-2 pr-3 font-medium">Strategy</th>
              <th className="py-2 pr-3 font-medium">Form ID</th><th className="py-2 pr-3 font-medium">Eligible</th>
              <th className="py-2 pr-3 font-medium">Status</th><th className="py-2 font-medium">Created</th>
            </tr></thead>
            <tbody>{rules.map(r => (
              <tr key={r.id} className="table-row">
                <td className="py-2.5 pr-3 font-medium text-slate-900">{r.name}</td>
                <td className="py-2.5 pr-3"><span className="chip-pink">{humanize(r.strategy)}</span></td>
                <td className="py-2.5 pr-3 font-mono text-xs text-slate-600">{r.meta_form_id || '— any —'}</td>
                <td className="py-2.5 pr-3 text-xs text-slate-600">{r.eligible_user_ids?.length ? `${r.eligible_user_ids.length} users` : 'All members'}</td>
                <td className="py-2.5 pr-3"><span className={r.is_active ? 'chip-green' : 'chip-slate'}>{r.is_active ? 'Active' : 'Disabled'}</span></td>
                <td className="py-2.5 text-xs text-slate-500">{fmtRelative(r.created_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Create distribution rule" size="lg"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)} disabled={create.isPending}>Cancel</Button><Button onClick={handleCreate} loading={create.isPending}>Create rule</Button></>}>
        <form onSubmit={handleCreate} className="space-y-4">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Real-estate hot leads" required />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Strategy" value={strategy} onChange={(e) => setStrategy(e.target.value as any)}
              options={[{ value: 'round_robin', label: 'Round-robin' }, { value: 'weighted', label: 'Weighted' }, { value: 'priority_queue', label: 'Priority queue' }, { value: 'manual', label: 'Manual' }]} />
            <Select label="Form (optional)" value={formId} placeholder="— Any form —"
              options={(forms ?? []).map(f => ({ value: f.form_id, label: `${f.form_name} (${f.form_id})` }))} onChange={(e) => setFormId(e.target.value)} hint="Leave blank for all forms." />
          </div>
          <div>
            <div className="label">Eligible users (leave empty for all)</div>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 scroll-thin">
              {(users ?? []).filter(u => u.role !== 'super_admin' && u.is_active !== false).map(u => (
                <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={eligible.includes(u.id)} onChange={() => toggleEligible(u.id)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                  <span className="text-slate-900">{u.full_name}</span>
                  <span className="text-xs text-slate-500">· {humanize(u.role)}{u.team_name ? ` · ${u.team_name}` : ''}</span>
                </label>
              ))}
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
