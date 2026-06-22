'use client';
import { useState } from 'react';
import * as React from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Settings as Cog, Webhook, Facebook, FileText,
  CheckCircle2, XCircle, AlertCircle, RefreshCw, Sheet, ExternalLink, Eye,
  Loader2, ChevronRight, Zap, Shield, Globe, Search,
  Database, Activity, Radio, Key, Megaphone,
  ChevronLeft, Download, Pencil, Power,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, Skeleton, EmptyState } from '@/components/ui/Modal';
import { apiGet, apiPost } from '@/lib/api';
import { fmtRelative, fmtDate, humanize, clsx } from '@/lib/format';
import {
  useMetaPagesEnriched, useMetaFormsEnriched, useFormLeads, usePageLeads,
  useMetaWebhookLogs, useSheetsEnriched, useMetaTokenStatus,
  useMetaSubscriptionStatus, useCampaignsEnriched,
  useSyncCampaigns, useSyncLeads, useUpdateMetaToken, useSubscribePage,
  useTestPageToken, useUpdatePageToken, useSyncMetaPageForms, useSetMetaPageActivation,
  // Dynamic Google Sheets credential management
  useGoogleSheetRoutingSettings, useUpdateGoogleSheetRoutingSettings,
  useTestGoogleSheetRouting, useCreateMissingGoogleSheetTabs, useExportLeadsByCategoryToSheets,
  // Sheet → CRM import
} from '@/hooks/useAdminEnterprise';

type SettingsTab = 'overview' | 'meta-pages' | 'meta-forms' | 'campaigns' | 'sheets' | 'admin-tools' | 'webhook-logs';

type LeadPreviewRow = {
  id: string;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  campaign_name?: string | null;
  stage?: string | null;
  call_status?: string | null;
  assigned_to_name?: string | null;
  created_at?: string | null;
};

type SheetSyncLogRow = {
  id: string;
  created_at?: string | null;
  user_name?: string | null;
  action?: string | null;
  metadata?: unknown;
};

type MetaSyncLogRow = {
  id: string;
  started_at?: string | null;
  sync_type?: string | null;
  source_id?: string | null;
  status?: string | null;
  leads_fetched?: number | null;
  leads_created?: number | null;
  leads_duplicate?: number | null;
};

type ActivityLogRow = {
  id: string;
  created_at?: string | null;
  user_name?: string | null;
  action?: string | null;
  entity?: string | null;
  entity_id?: string | null;
  metadata?: unknown;
  ip_address?: string | null;
};

function formatLogMetadata(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}

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

      {/* Meta Admin Quick Actions — all admin controls inline */}
      <MetaAdminQuickActions onNavigate={onNavigate} />

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
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between"><span className="text-slate-600">{label}</span>{children}</div>;
}

/* ═══════════════════ META ADMIN QUICK ACTIONS — inline panel on Overview ═══════════════════ */
function MetaAdminQuickActions({ onNavigate }: { onNavigate: (tab: SettingsTab) => void }) {
  const tokenStatus = useMetaTokenStatus();
  const syncCampaigns = useSyncCampaigns();
  const syncLeads = useSyncLeads();
  const updateToken = useUpdateMetaToken();
  const qc = useQueryClient();

  const [tokenModal, setTokenModal] = useState(false);
  const [pageModal, setPageModal] = useState(false);
  const [userToken, setUserToken] = useState('');
  const [newPageId, setNewPageId] = useState('');
  const [newPageName, setNewPageName] = useState('');
  const [newPageToken, setNewPageToken] = useState('');

  const addPage = useMutation({
    mutationFn: () => apiPost('/meta/pages', { page_id: newPageId, page_name: newPageName, page_access_token: newPageToken }),
    onSuccess: () => {
      toast.success('Meta page connected');
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['integration-status'] });
      setPageModal(false); setNewPageId(''); setNewPageName(''); setNewPageToken('');
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Failed to connect page'),
  });

  function handleUpdateToken() {
    if (!userToken) { toast.error('Paste a fresh User Access Token'); return; }
    updateToken.mutate(
      {
        tokenType: 'user',
        accessToken: userToken,
        refreshPages: true,
        subscribeWebhooks: true,
        syncForms: true,
        syncAdAccounts: true,
        syncCampaigns: true,
      },
      {
        onSuccess: () => {
          toast.success('Page token saved and webhook subscribed successfully');
          setTokenModal(false); setUserToken('');
          qc.invalidateQueries({ queryKey: ['integration-status'] });
        },
        onError: () => toast.error('Update failed — check token validity'),
      },
    );
  }

  const ts = tokenStatus.data;
  const tokenOk = !!ts && (ts.pageTokens?.valid || 0) > 0 && !!ts.webhook?.subscribed;

  return (
    <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-blue-50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Shield className="h-4 w-4 text-violet-600" />
        <h2 className="text-sm font-semibold text-slate-900">Meta Admin — Quick Actions</h2>
        <span className={clsx('chip text-[10px]', tokenOk ? 'chip-emerald' : 'chip-amber')}>
          {tokenOk ? 'Token OK' : ts ? 'Token issue' : 'Checking…'}
        </span>
        <button onClick={() => onNavigate('admin-tools')} className="ml-auto text-[11px] text-violet-700 hover:text-violet-900 font-medium inline-flex items-center gap-1">
          More tools <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <button onClick={() => setTokenModal(true)}
          className="flex flex-col items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-3 py-3 text-center transition hover:bg-amber-50 hover:shadow-sm">
          <Key className="h-5 w-5 text-amber-600" />
          <span className="text-xs font-semibold text-slate-800">Add / Update Token</span>
          <span className="text-[10px] text-slate-500">Refresh page access</span>
        </button>

        <button onClick={() => setPageModal(true)}
          className="flex flex-col items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-3 text-center transition hover:bg-blue-50 hover:shadow-sm">
          <Facebook className="h-5 w-5 text-blue-600" />
          <span className="text-xs font-semibold text-slate-800">Connect Meta Page</span>
          <span className="text-[10px] text-slate-500">Add page + token</span>
        </button>

        <button onClick={() => syncCampaigns.mutate(undefined, { onSuccess: () => toast.success('Campaigns synced from Meta'), onError: () => toast.error('Sync failed') })}
          disabled={syncCampaigns.isPending}
          className="flex flex-col items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-3 text-center transition hover:bg-violet-50 hover:shadow-sm disabled:opacity-60">
          {syncCampaigns.isPending ? <Loader2 className="h-5 w-5 text-violet-600 animate-spin" /> : <Megaphone className="h-5 w-5 text-violet-600" />}
          <span className="text-xs font-semibold text-slate-800">Sync Campaigns</span>
          <span className="text-[10px] text-slate-500">All ad accounts</span>
        </button>

        <button onClick={() => syncLeads.mutate({}, { onSuccess: () => toast.success('Lead sync triggered'), onError: () => toast.error('Sync failed') })}
          disabled={syncLeads.isPending}
          className="flex flex-col items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-3 text-center transition hover:bg-emerald-50 hover:shadow-sm disabled:opacity-60">
          {syncLeads.isPending ? <Loader2 className="h-5 w-5 text-emerald-600 animate-spin" /> : <Download className="h-5 w-5 text-emerald-600" />}
          <span className="text-xs font-semibold text-slate-800">Sync Leads</span>
          <span className="text-[10px] text-slate-500">From all forms</span>
        </button>

        <button onClick={() => onNavigate('meta-forms')}
          className="flex flex-col items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-3 text-center transition hover:bg-rose-50 hover:shadow-sm">
          <FileText className="h-5 w-5 text-rose-600" />
          <span className="text-xs font-semibold text-slate-800">Register Form</span>
          <span className="text-[10px] text-slate-500">Track new lead form</span>
        </button>
      </div>

      {/* Update Token Modal */}
      <Modal open={tokenModal} onClose={() => setTokenModal(false)} title="Update Meta Access Token" size="md"
        footer={<><Button variant="ghost" onClick={() => setTokenModal(false)}>Cancel</Button><Button onClick={handleUpdateToken} loading={updateToken.isPending}>Update & Sync</Button></>}>
        <div className="space-y-3">
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            <AlertCircle className="h-3.5 w-3.5 inline mr-1" />
            Generate tokens from <a className="underline" href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer">Graph API Explorer</a> with scopes: <code className="bg-amber-100 px-1 rounded">leads_retrieval, pages_show_list, pages_manage_metadata, pages_read_engagement, ads_read, business_management</code>.
          </div>
          <Input label="Paste fresh User Access Token" type="password" value={userToken} onChange={(e) => setUserToken(e.target.value)} placeholder="EAAxxx..." />
          <p className="text-[11px] text-slate-500">The CRM securely stores this token, derives fresh Page Access Tokens, and reconnects leadgen webhooks. Page-level operations continue using the saved page tokens.</p>
        </div>
      </Modal>

      {/* Connect Meta Page Modal */}
      <Modal open={pageModal} onClose={() => setPageModal(false)} title="Connect Meta Page" size="md"
        footer={<><Button variant="ghost" onClick={() => setPageModal(false)}>Cancel</Button><Button onClick={() => addPage.mutate()} loading={addPage.isPending} disabled={!newPageId || !newPageName}>Connect Page</Button></>}>
        <div className="space-y-3">
          <Input label="Page ID" value={newPageId} onChange={(e) => setNewPageId(e.target.value)} required placeholder="220342467819979" />
          <Input label="Page Name" value={newPageName} onChange={(e) => setNewPageName(e.target.value)} required placeholder="Digital AdBird" />
          <Input label="Page Access Token" type="password" value={newPageToken} onChange={(e) => setNewPageToken(e.target.value)} placeholder="EAAxxx... (recommended for live webhooks)" />
          <p className="text-[11px] text-slate-500">Page access token lets the CRM fetch full lead data when Meta webhooks fire. Without it, lead ingestion will fail.</p>
        </div>
      </Modal>
    </div>
  );
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

  // Per-page token update state
  const [updateTokenPage, setUpdateTokenPage] = useState<{ page_id: string; page_name: string } | null>(null);
  const [newToken, setNewToken] = useState('');
  const testToken = useTestPageToken();
  const updatePageToken = useUpdatePageToken();
  const subscribePage = useSubscribePage();
  const syncPageForms = useSyncMetaPageForms();
  const setPageActivation = useSetMetaPageActivation();

  const add = useMutation({
    mutationFn: () => apiPost('/meta/pages', { page_id: pageId, page_name: pageName, page_access_token: token }),
    onSuccess: () => {
      toast.success('Page connected + token validated');
      qc.invalidateQueries({ queryKey: ['admin'] });
      setAddOpen(false); setPageId(''); setPageName(''); setToken('');
    },
    onError: (e: unknown) =>
      toast.error((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Failed to connect page'),
  });

  function handleTestToken(pid: string) {
    testToken.mutate(pid, {
      onSuccess: (r) => {
        if (r.ok) toast.success(`✓ Token valid for "${r.name}"`);
        else toast.error(`✗ ${r.is_expired ? 'Expired' : 'Invalid'}: ${r.reason || 'unknown'}`, { duration: 6000 });
      },
      onError: () => toast.error('Test failed'),
    });
  }

  function handleUpdateToken() {
    if (!updateTokenPage || !newToken.trim()) { toast.error('Paste a new token'); return; }
    updatePageToken.mutate(
      { pageId: updateTokenPage.page_id, token: newToken.trim() },
      {
        onSuccess: () => {
          toast.success(`✓ Token updated for "${updateTokenPage.page_name}"`);
          setUpdateTokenPage(null); setNewToken('');
        },
        onError: (err) => {
          const e = err as { response?: { data?: { error?: { message?: string } } } };
          toast.error(e?.response?.data?.error?.message || 'Update failed', { duration: 6000 });
        },
      },
    );
  }

  function handleDeactivatePage(pid: string, name: string) {
    if (!window.confirm(`Deactivate Meta page "${name}"? It will stop affecting integration health, but historical leads remain.`)) return;
    setPageActivation.mutate({ pageId: pid, isActive: false }, {
      onSuccess: () => toast.success('Meta page deactivated'),
      onError: () => toast.error('Failed to deactivate page'),
    });
  }


  function handleActivatePage(pid: string, name: string) {
    if (!window.confirm(`Activate Meta page "${name}"? CRM will subscribe its webhook and sync its lead forms.`)) return;
    setPageActivation.mutate({ pageId: pid, isActive: true }, {
      onSuccess: () => toast.success('Meta page activated, webhook connected, and forms synced'),
      onError: (error: unknown) => {
        const message = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
        toast.error(message || 'Failed to activate page');
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Facebook className="h-5 w-5 text-blue-600" />
          <h1 className="text-lg font-semibold text-slate-900">Connected Meta Pages</h1>
          <span className="chip-slate">{pages?.filter(page => page.is_active).length || 0} active</span>
          <span className="chip-slate">{pages?.filter(page => !page.is_active).length || 0} inactive</span>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>Add Page</Button>
      </div>

      {isLoading ? <Skeleton className="h-64" /> : !pages?.length ? (
        <EmptyState title="No Meta pages connected" description="Add a Page Access Token and Page ID from your Meta Business account." />
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            Only active pages are subscribed, synced, imported, and included in integration health. Inactive pages are ignored.
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-[980px] w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">Page</th>
                  <th className="px-3 py-2.5">Token</th>
                  <th className="px-3 py-2.5">Webhook</th>
                  <th className="px-3 py-2.5">Lead forms</th>
                  <th className="px-3 py-2.5">Active in CRM</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pages.map(p => (
                  <tr key={`selection-${p.id}`} className={clsx(!p.is_active && 'bg-slate-50 text-slate-600')}>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900">{p.page_name || p.page_id}</div>
                      <div className="font-mono text-[10px] text-slate-500">{p.page_id}</div>
                    </td>
                    <td className="px-3 py-3">{p.token_is_valid === false ? 'Invalid' : p.has_token ? 'Valid' : 'Missing'}</td>
                    <td className="px-3 py-3">{!p.is_active ? 'Ignored' : p.webhook_subscribed ? 'Subscribed' : 'Not subscribed'}</td>
                    <td className="px-3 py-3">{!p.is_active ? 'Ignored' : p.forms_status || 'Not checked'}</td>
                    <td className="px-3 py-3">
                      <span className={clsx('rounded-full px-2 py-1 text-[10px] font-semibold', p.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600')}>
                        {p.is_active ? 'Active' : humanize(p.connection_status || 'discovered')}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => handleTestToken(p.page_id)} disabled={testToken.isPending}>Verify</Button>
                        <Button size="sm" variant="ghost" onClick={() => subscribePage.mutate(p.page_id)} disabled={!p.is_active || subscribePage.isPending}>Reconnect</Button>
                        <Button size="sm" variant="ghost" onClick={() => syncPageForms.mutate(p.page_id)} disabled={!p.is_active || syncPageForms.isPending}>Sync Forms</Button>
                        {p.is_active ? (
                          <Button size="sm" variant="ghost" onClick={() => handleDeactivatePage(p.page_id, p.page_name || p.page_id)} disabled={setPageActivation.isPending}>Deactivate</Button>
                        ) : (
                          <Button size="sm" onClick={() => handleActivatePage(p.page_id, p.page_name || p.page_id)} disabled={setPageActivation.isPending || !p.has_token}>Activate</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary className="cursor-pointer text-xs font-medium text-slate-600">Detailed page diagnostics</summary>
            <div className="mt-3 space-y-3">
              {pages.map(p => (
                <div key={p.id} className={clsx('card p-4', !p.is_active && 'bg-slate-50')}>
                  <div className="flex items-start justify-between mb-3 gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={clsx('inline-flex h-2.5 w-2.5 rounded-full ring-2 shrink-0', p.is_active ? 'bg-emerald-500 ring-emerald-100' : 'bg-slate-300 ring-slate-100')} />
                        <h3 className="font-display text-base font-bold text-slate-900 truncate">{p.page_name || p.page_id}</h3>
                      </div>
                      <div className="mt-1 text-[11px] font-mono text-slate-500 truncate">{p.page_id}</div>
                    </div>
                    <span className={clsx(
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ring-1 shrink-0',
                      p.has_token && p.token_is_valid !== false
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                        : 'bg-rose-50 text-rose-700 ring-rose-200'
                    )}>
                      <StatusDot ok={p.has_token && p.token_is_valid !== false} warn={!p.has_token} />
                      {p.token_is_valid === false ? 'Token invalid' : p.has_token ? 'Token valid' : 'No token'}
                    </span>
                  </div>

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
                    <a href={`https://business.facebook.com/latest/instant_forms?asset_id=${p.page_id}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100 transition">
                      <FileText className="h-3 w-3" /> Lead Ads <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                    <button onClick={() => { setViewPageId(p.page_id); setLeadsPage(1); }}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 transition">
                      <Eye className="h-3 w-3" /> View Leads ({p.lead_count})
                    </button>
                    <button onClick={() => handleTestToken(p.page_id)} disabled={testToken.isPending}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 transition disabled:opacity-60">
                      {testToken.isPending && testToken.variables === p.page_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Shield className="h-3 w-3" />}
                      Verify
                    </button>
                    <button
                      onClick={() => subscribePage.mutate(p.page_id, { onSuccess: () => toast.success('Webhook reconnected'), onError: () => toast.error('Webhook reconnect failed') })}
                      disabled={!p.is_active || subscribePage.isPending}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-60"
                    >
                      {subscribePage.isPending && subscribePage.variables === p.page_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Webhook className="h-3 w-3" />}
                      Reconnect Webhook
                    </button>
                    <button
                      onClick={() => syncPageForms.mutate(p.page_id, { onSuccess: () => toast.success('Lead forms synced'), onError: () => toast.error('Lead forms sync failed') })}
                      disabled={!p.is_active || syncPageForms.isPending}
                      className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100 transition disabled:opacity-60"
                    >
                      {syncPageForms.isPending && syncPageForms.variables === p.page_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      Sync Forms
                    </button>
                    <button onClick={() => { setUpdateTokenPage({ page_id: p.page_id, page_name: p.page_name || p.page_id }); setNewToken(''); }}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100 transition">
                      <Key className="h-3 w-3" /> Update Token
                    </button>
                    {p.is_active && (
                      <button
                        onClick={() => handleDeactivatePage(p.page_id, p.page_name || p.page_id)}
                        disabled={setPageActivation.isPending}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 transition disabled:opacity-60"
                      >
                        <Power className="h-3 w-3" /> Deactivate
                      </button>
                    )}
                    {!p.is_active && (
                      <button
                        onClick={() => handleActivatePage(p.page_id, p.page_name || p.page_id)}
                        disabled={setPageActivation.isPending || !p.has_token}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-60"
                      >
                        <Power className="h-3 w-3" /> Activate
                      </button>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-1 text-[10px] text-slate-500 sm:grid-cols-4">
                    <span>Active in CRM: {p.is_active ? 'Yes' : 'No'} ({p.connection_status || 'discovered'})</span>
                    <span>Page token: {p.token_is_valid === false ? 'Invalid' : p.has_token ? 'Valid' : 'Missing'}</span>
                    <span>Webhook: {!p.is_active ? 'Ignored while inactive' : p.webhook_subscribed ? 'Subscribed' : 'Not subscribed'}</span>
                    <span>Forms: {!p.is_active ? 'Ignored while inactive' : p.forms_status || 'Not checked'}</span>
                  </div>
                  {p.stale_at && <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">Stale page: not returned by the latest User Token refresh.</div>}
                  {p.token_last_error && <div className="mt-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-600">{p.token_last_error}</div>}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Per-page Update Token Modal */}
      <Modal
        open={!!updateTokenPage}
        onClose={() => { setUpdateTokenPage(null); setNewToken(''); }}
        title={`Update Token — ${updateTokenPage?.page_name || ''}`}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setUpdateTokenPage(null); setNewToken(''); }}>Cancel</Button>
            <Button onClick={handleUpdateToken} loading={updatePageToken.isPending} disabled={!newToken.trim()}>
              Validate & Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 space-y-1">
            <div className="flex items-start gap-1">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                <strong>Generate a new long-lived Page Access Token:</strong>
                <ol className="mt-1 ml-3 list-decimal space-y-0.5">
                  <li>Go to <a className="underline" href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer">Graph API Explorer</a></li>
                  <li>Select your app → click <em>Get User Access Token</em> with scopes: <code className="bg-amber-100 px-1 rounded">pages_show_list, pages_read_engagement, pages_manage_metadata, leads_retrieval, ads_read, business_management</code></li>
                  <li>Then call <code className="bg-amber-100 px-1 rounded">GET /me/accounts</code> — find your page → copy its <code>access_token</code></li>
                  <li>Extend with the <a className="underline" href="https://developers.facebook.com/tools/debug/accesstoken/" target="_blank" rel="noopener noreferrer">Access Token Debugger</a> to make it long-lived (~60 days)</li>
                </ol>
              </div>
            </div>
          </div>
          <div>
            <label className="label">Page ID</label>
            <input className="input font-mono text-xs" value={updateTokenPage?.page_id || ''} disabled />
          </div>
          <Input
            label="New Page Access Token"
            type="password"
            value={newToken}
            onChange={(e) => setNewToken(e.target.value)}
            placeholder="EAAxxxx..."
          />
          <p className="text-[11px] text-slate-500">
            Token will be validated against Meta Graph API (<code>GET /{updateTokenPage?.page_id}?fields=id,name</code>) before saving. If validation fails, you&apos;ll see the exact error from Meta.
          </p>
        </div>
      </Modal>

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
                  {(pageLeads.data.rows as LeadPreviewRow[]).map((l) => (
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
  const [detailsFormId, setDetailsFormId] = useState<string | null>(null);

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
                <button type="button" onClick={() => setDetailsFormId(f.form_id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 transition">
                  <FileText className="h-3 w-3" /> View Form
                </button>
                <a href={f.page_id
                  ? `https://business.facebook.com/latest/instant_forms?asset_id=${f.page_id}&selected_form_id=${f.form_id}`
                  : `https://business.facebook.com/leadgen_forms/?ids=${f.form_id}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100 transition">
                  <Database className="h-3 w-3" /> Form Details <ExternalLink className="h-2.5 w-2.5" />
                </a>
                {f.page_id && (
                  <a href={`https://www.facebook.com/profile.php?id=${f.page_id}`} target="_blank" rel="noopener noreferrer"
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
                    {(formLeads.data.rows as LeadPreviewRow[]).map((l) => (
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

      {/* Live Form Details Modal */}
      <FormDetailsModal formId={detailsFormId} onClose={() => setDetailsFormId(null)} />

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

/* ═══════════════════ FORM DETAILS MODAL — live data from Graph API ═══════════════════ */
interface FormQuestion { key?: string; label?: string; type?: string; options?: { key?: string; value: string }[] }
interface FormPage { id?: string; name?: string; username?: string; link?: string; picture?: { data?: { url?: string } } }
interface LiveForm {
  id: string; name: string; status: string; locale: string; created_time: string;
  leads_count?: number; expired_leads_count?: number; organic_leads_count?: number;
  questions?: FormQuestion[];
  privacy_policy_url?: string; follow_up_action_url?: string;
  thank_you_page?: { title?: string; body?: string; button_text?: string };
  context_card?: { title?: string; content?: string[]; button_text?: string };
  page?: FormPage;
}
interface FormDetailsResponse {
  local: { form_id: string; form_name: string; page_id: string | null; page_name: string | null; campaign_label: string | null; product_tag: string | null; is_active: boolean; created_at: string };
  live: LiveForm | null;
}

function FormDetailsModal({ formId, onClose }: { formId: string | null; onClose: () => void }) {
  const q = useQuery<FormDetailsResponse, { response?: { data?: { error?: { message?: string; code?: string; meta_code?: number } } } }>({
    queryKey: ['meta-form-details', formId],
    queryFn: () => apiGet<FormDetailsResponse>(`/meta/forms/${formId}/details`),
    enabled: !!formId,
    staleTime: 30_000,
    retry: false,
  });

  const live = q.data?.live;
  const local = q.data?.local;
  const errMsg = q.error?.response?.data?.error?.message;

  return (
    <Modal open={!!formId} onClose={onClose} title="Lead Form Details" size="lg">
      {q.isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : q.isError && !local ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="font-medium">Could not load form</div>
          <div className="mt-1 text-xs">{errMsg || 'Unknown error'}</div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Header — page + form name */}
          <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            {live?.page?.picture?.data?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={live.page.picture.data.url} alt="" className="h-10 w-10 rounded-full border border-slate-200" />
            ) : <div className="grid h-10 w-10 place-items-center rounded-full bg-violet-100 text-violet-600"><Facebook className="h-5 w-5" /></div>}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-900 truncate">{live?.name || local?.form_name || 'Unknown form'}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                <span>Page: <strong className="text-slate-700">{live?.page?.name || local?.page_name || '—'}</strong></span>
                {live?.locale && <span>· Locale: <span className="font-mono">{live.locale}</span></span>}
                {live?.status && <span className={clsx('chip', live.status === 'ACTIVE' ? 'chip-emerald' : 'chip-slate')}>{live.status}</span>}
                {local?.campaign_label && <span className="chip-blue">{local.campaign_label}</span>}
                {local?.product_tag && <span className="chip-slate">{local.product_tag}</span>}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-400 font-mono">{local?.form_id} · page {local?.page_id || '—'}</div>
            </div>
          </div>

          {/* Live error banner — still show local data + fallback link */}
          {q.isError && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <div className="font-medium">Live data unavailable</div>
              <div>{errMsg || 'Graph API call failed. Check META_PAGE_ACCESS_TOKEN.'}</div>
            </div>
          )}

          {/* Counts */}
          {live && (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-white border border-slate-200 px-3 py-2 text-center">
                <div className="text-base font-bold tabular-nums text-slate-900">{(live.leads_count ?? 0).toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Total Leads</div>
              </div>
              <div className="rounded-lg bg-white border border-slate-200 px-3 py-2 text-center">
                <div className="text-base font-bold tabular-nums text-emerald-700">{(live.organic_leads_count ?? 0).toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Organic</div>
              </div>
              <div className="rounded-lg bg-white border border-slate-200 px-3 py-2 text-center">
                <div className="text-base font-bold tabular-nums text-amber-700">{(live.expired_leads_count ?? 0).toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Expired</div>
              </div>
            </div>
          )}

          {/* Questions */}
          {live?.questions && live.questions.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-700 mb-2">Questions ({live.questions.length})</h4>
              <div className="space-y-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                {live.questions.map((qn, i) => (
                  <div key={i} className="px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-900">{qn.label || qn.key || `Question ${i + 1}`}</span>
                      <span className="text-[10px] uppercase font-mono text-slate-400">{qn.type || 'text'}</span>
                    </div>
                    {qn.options && qn.options.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {qn.options.map((o, j) => <span key={j} className="chip-slate text-[10px]">{o.value}</span>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Context card */}
          {live?.context_card && (live.context_card.title || (live.context_card.content && live.context_card.content.length)) && (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold text-slate-700 mb-1">Intro Screen</div>
              {live.context_card.title && <div className="text-sm font-medium text-slate-900">{live.context_card.title}</div>}
              {live.context_card.content?.map((c, i) => <div key={i} className="text-xs text-slate-600 mt-1">{c}</div>)}
            </div>
          )}

          {/* Thank-you screen */}
          {live?.thank_you_page && (live.thank_you_page.title || live.thank_you_page.body) && (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold text-slate-700 mb-1">Thank-You Screen</div>
              {live.thank_you_page.title && <div className="text-sm font-medium text-slate-900">{live.thank_you_page.title}</div>}
              {live.thank_you_page.body && <div className="text-xs text-slate-600 mt-1">{live.thank_you_page.body}</div>}
              {live.thank_you_page.button_text && <div className="mt-1 text-[10px] text-slate-500">Button: <span className="font-mono">{live.thank_you_page.button_text}</span></div>}
            </div>
          )}

          {/* External links — open in Meta Business Suite */}
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            {live?.privacy_policy_url && (
              <a href={live.privacy_policy_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50">
                <Shield className="h-3 w-3" /> Privacy Policy <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
            {live?.page?.link && (
              <a href={live.page.link} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100">
                <Facebook className="h-3 w-3" /> Facebook Page <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
            {local?.page_id && (
              <a href={`https://business.facebook.com/latest/instant_forms?asset_id=${local.page_id}&selected_form_id=${local.form_id}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100">
                <Database className="h-3 w-3" /> Edit in Business Suite <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        </div>
      )}
    </Modal>
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
                <span className={c.is_active ? 'chip-green' : 'chip-slate'}>{c.effective_status || (c.is_active ? 'ACTIVE' : 'INACTIVE')}</span>
              </div>
              <div className="mb-2 flex flex-wrap gap-1">
                {c.internal_label && <span className="chip-blue text-[10px]">{c.internal_label}</span>}
                {c.category && <span className="chip-slate text-[10px]">{c.category}</span>}
                <span className={clsx('text-[10px]', c.source === 'meta_api' ? 'chip-emerald' : 'chip-amber')}>{c.source === 'meta_api' ? 'Meta API' : 'Lead-derived legacy'}</span>
                {c.ad_account_id && <span className="chip-slate text-[10px]">Ad account {c.ad_account_id}</span>}
              </div>

              <div className="grid grid-cols-4 gap-2 mb-3">
                <MiniStat label="Leads" value={c.lead_count} color="text-slate-900" />
                <MiniStat label="Today" value={c.today_leads} color="text-brand-700" />
                <MiniStat label="Converted" value={c.conversions} color="text-emerald-700" />
                <MiniStat label="Pending" value={c.pending_leads} color="text-amber-700" />
              </div>

              <div className="text-xs text-slate-500 space-y-0.5">
                {c.meta_status && <div>Configured status: <strong className="text-slate-700">{c.meta_status}</strong></div>}
                {c.objective && <div>Objective: <strong className="text-slate-700">{humanize(c.objective)}</strong></div>}
                {c.connected_form && <div>Form: <strong className="text-slate-700">{c.connected_form}</strong></div>}
                {c.connected_page && <div>Page: <strong className="text-slate-700">{c.connected_page}</strong></div>}
                {c.last_lead_at && <div>Last activity: {fmtRelative(c.last_lead_at)}</div>}
                {c.last_meta_status_checked_at && <div>Meta checked: {fmtRelative(c.last_meta_status_checked_at)}</div>}
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
  const routing = useGoogleSheetRoutingSettings();
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

      {/* Dynamic credentials management — admin can upload JSON, switch sheets, no SSH/.env needed */}
      <SheetCredentialsManager />

      {isLoading ? <Skeleton className="h-64" /> : (
        <>

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
                    {(data.sync_logs as SheetSyncLogRow[]).map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="py-2 pr-3 text-xs text-slate-500">{fmtRelative(log.created_at)}</td>
                        <td className="py-2 pr-3 text-xs text-slate-700">{log.user_name || '—'}</td>
                        <td className="py-2 pr-3"><span className="chip-slate text-[10px]">{log.action}</span></td>
                        <td className="py-2 text-xs text-slate-500 truncate max-w-[200px]">{formatLogMetadata(log.metadata)}</td>
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

function SheetCredentialsManager() {
  const { data, isLoading } = useSheetsEnriched();
  const qc = useQueryClient();


  const routing = useGoogleSheetRoutingSettings();
  const createTabs = useCreateMissingGoogleSheetTabs();
  const exportByCategory = useExportLeadsByCategoryToSheets();
  const [open, setOpen] = useState(false);
  const cfg = data?.config;
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

  const sheetUrl = cfg?.sheet_id ? `https://docs.google.com/spreadsheets/d/${cfg.sheet_id}` : null;


  return (
    <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sheet className="h-4 w-4 text-emerald-600" />
        <h2 className="text-sm font-semibold text-slate-900">Credentials & Sheets</h2>

        <div className="ml-auto flex items-center gap-2">
          {sheetUrl && (
            <a href={sheetUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition">
              <Sheet className="h-3.5 w-3.5" /> Open Sheet <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => createTabs.mutate(undefined, {
              onSuccess: (result) => {
                const created = result.created?.length ? `Created: ${result.created.join(', ')}` : '';
                const existing = result.existing?.length ? `Existing: ${result.existing.join(', ')}` : '';
                toast.success([created, existing].filter(Boolean).join(' | ') || 'All configured tabs are ready');
              },
              onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to create missing tabs'),
            })}
            loading={createTabs.isPending}
          >
            Create Missing Tabs
          </Button>
          <Button size="sm" leftIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
            Update Sheet Names
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-dashed border-emerald-200 bg-white px-4 py-4">
        <div className=" grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Connection Status</div>
            <div className="flex items-center gap-2">
              <div className={clsx('h-3 w-3 rounded-full', routing.data?.connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-400')} />
              <span className="font-semibold text-xs text-slate-900">{routing.data?.connected ? 'Connected' : 'Not connected'}</span>
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Spreadsheet ID</div>
            <div className="text-xs font-mono text-slate-700 truncate">{routing.data?.spreadsheet_id || 'Not set'}</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Current Default Sheet Name</div>
            <div className="text-xs text-slate-700">{routing.data?.default_sheet_name || 'Not set'}</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Service Account Email</div>
            <div className="text-xs font-mono text-slate-700 truncate">{routing.data?.service_account_email || 'Not set'}</div>
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
        </div>
      </div>

      <SheetCredentialsModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function SheetCredentialsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const routing = useGoogleSheetRoutingSettings();
  const updateRouting = useUpdateGoogleSheetRoutingSettings();
  const testRouting = useTestGoogleSheetRouting();
  const [form, setForm] = useState({
    default_sheet_name: '',
    trader_sheet_name: '',
    partner_sheet_name: '',
    unknown_sheet_name: '',
  });
  const formKey = JSON.stringify(form);
  const [lastPassedTestKey, setLastPassedTestKey] = useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !routing.data) return;
    setForm({
      default_sheet_name: routing.data.default_sheet_name || '',
      trader_sheet_name: routing.data.trader_sheet_name || '',
      partner_sheet_name: routing.data.partner_sheet_name || '',
      unknown_sheet_name: routing.data.unknown_sheet_name || '',
    });
    setLastPassedTestKey(null);
  }, [open, routing.data]);

  function handleTest() {
    testRouting.mutate(form, {
      onSuccess: (response) => {
        const payload = (response as { data?: unknown })?.data ?? response ?? {};
        const results = (payload as { results?: Record<string, { exists?: boolean; header_valid?: boolean }> })?.results
          ?? ((payload as { data?: { results?: Record<string, { exists?: boolean; header_valid?: boolean }> } })?.data?.results ?? {});
        const rows = Object.values(results || {});
        const missing = rows.filter((row) => !row.exists || row.header_valid === false);
        const demoWritten = Boolean((payload as { demo_written?: boolean })?.demo_written
          ?? (payload as { data?: { demo_written?: boolean } })?.data?.demo_written);
        if (missing.length) {
          setLastPassedTestKey(null);
          toast.success('Sheet test completed. Some tabs are missing or need header repair.');
        } else if (!demoWritten) {
          setLastPassedTestKey(null);
          toast.error('Sheet tabs are valid, but demo row could not be saved.');
        } else {
          setLastPassedTestKey(formKey);
          toast.success('All sheet tabs found. Demo rows saved successfully.');
        }
      },
      onError: (e: unknown) => toast.error((e as { response?: { data?: { error?: { message?: string }, message?: string } } })?.response?.data?.error?.message || (e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Sheet test failed'),
    });
  }

  function handleSave() {
    if (lastPassedTestKey !== formKey) {
      toast.error('Please test these sheet names before saving.');
      return;
    }
    updateRouting.mutate(form, {
      onSuccess: () => {
        toast.success('Google Sheet names saved successfully.');
        onClose();
      },
      onError: (e: unknown) => toast.error((e as { response?: { data?: { error?: { message?: string }, message?: string } } })?.response?.data?.error?.message || (e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to save sheet names'),
    });
  }

  const testPayload = (testRouting.data as { data?: unknown } | undefined)?.data ?? testRouting.data ?? null;
  const testResults = (testPayload as {
    results?: {
      default: { sheet_name: string; exists: boolean; header_valid?: boolean; header_missing_columns?: string[] };
      trader: { sheet_name: string; exists: boolean; header_valid?: boolean; header_missing_columns?: string[] };
      partner: { sheet_name: string; exists: boolean; header_valid?: boolean; header_missing_columns?: string[] };
      unknown: { sheet_name: string; exists: boolean; header_valid?: boolean; header_missing_columns?: string[] };
    }
  } | null)?.results
    ?? ((testPayload as {
      data?: {
        results?: {
          default: { sheet_name: string; exists: boolean; header_valid?: boolean; header_missing_columns?: string[] };
          trader: { sheet_name: string; exists: boolean; header_valid?: boolean; header_missing_columns?: string[] };
          partner: { sheet_name: string; exists: boolean; header_valid?: boolean; header_missing_columns?: string[] };
          unknown: { sheet_name: string; exists: boolean; header_valid?: boolean; header_missing_columns?: string[] };
        }
      }
    } | null)?.data?.results ?? null);
  const canSave = lastPassedTestKey === formKey;
  const updateField = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((s) => ({ ...s, [key]: e.target.value }));
    setLastPassedTestKey(null);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Update Google Sheet Names"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="outline" onClick={handleTest} loading={testRouting.isPending}>Test</Button>
          <Button onClick={handleSave} loading={updateRouting.isPending} disabled={!canSave}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Default Sheet Name" value={form.default_sheet_name} onChange={updateField('default_sheet_name')} />
        <Input label="Trader Leads Sheet Name" value={form.trader_sheet_name} onChange={updateField('trader_sheet_name')} />
        <Input label="Partner Leads Sheet Name" value={form.partner_sheet_name} onChange={updateField('partner_sheet_name')} />
        <Input label="Unknown Leads Sheet Name" value={form.unknown_sheet_name} onChange={updateField('unknown_sheet_name')} />
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <div>All leads are written to {form.default_sheet_name || 'the configured default sheet'}.</div>
          <div>Trader leads are also written to {form.trader_sheet_name || 'the configured trader sheet'}.</div>
          <div>Partner leads are also written to {form.partner_sheet_name || 'the configured partner sheet'}.</div>
          <div>Unknown leads are also written to {form.unknown_sheet_name || form.default_sheet_name || 'the configured unknown sheet'}.</div>
        </div>
        {!canSave && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Test is required before saving. The test writes demo rows using these sheet names.
          </div>
        )}

        {testResults && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold text-slate-900">Sheet Test Results</div>
            <div className="mt-2 space-y-2 text-xs">
              {([
                ['Default', testResults.default],
                ['Trader', testResults.trader],
                ['Partner', testResults.partner],
                ['Unknown', testResults.unknown],
              ] as const).map(([label, result]) => (
                <div key={label} className="flex items-center justify-between rounded-md bg-white px-3 py-2">
                  <div>
                    <div className="font-medium text-slate-900">{label}</div>
                    <div className="text-slate-500">{result.sheet_name}</div>
                    {result.header_missing_columns?.length ? (
                      <div className="mt-1 text-[10px] text-amber-700">
                        Missing header columns: {result.header_missing_columns.join(', ')}
                      </div>
                    ) : null}
                  </div>
                  <span className={clsx('chip text-[10px]', result.exists && result.header_valid !== false ? 'chip-emerald' : 'chip-amber')}>
                    {!result.exists ? 'Missing' : result.header_valid === false ? 'Header needs fix' : 'Ready'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
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

  const [tokenModal, setTokenModal] = useState(false);
  const [userToken, setUserToken] = useState('');

  function handleUpdateToken() {
    if (!userToken) { toast.error('Paste a fresh User Access Token'); return; }
    updateToken.mutate(
      { user_access_token: userToken },
      { onSuccess: () => { toast.success('Page token saved and webhook subscribed successfully'); setTokenModal(false); setUserToken(''); }, onError: () => toast.error('Update failed - check token permissions') }
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <TokenBadge label={`Page Token: ${ts.pageTokens?.valid ? 'Valid' : ts.pageTokens?.missing ? 'Missing' : 'Invalid'}`} ok={(ts.pageTokens?.valid || 0) > 0} />
              <TokenBadge label={`User Token: ${ts.userToken?.status || 'unknown'}`} ok={ts.userToken?.status === 'valid'} />
              <TokenBadge label={`Webhook: ${ts.webhook?.subscribed ? 'Subscribed' : 'Not subscribed'}`} ok={!!ts.webhook?.subscribed} />
              <TokenBadge label={`Lead Forms: ${ts.leadForms?.accessible ? 'Accessible' : 'Error'}`} ok={!!ts.leadForms?.accessible} />
              <TokenBadge label={`Campaign Sync: ${ts.campaignSync?.status || 'degraded'}`} ok={ts.campaignSync?.status === 'available'} />
            </div>
            {ts.warning && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Page webhook is active. User token is expired or missing, so page refresh and ad account sync may need a new token.</div>}
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
            {subscriptions.data.map((s) => (
              <div key={s.page_id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                <div>
                  <div className="font-medium text-sm text-slate-900">{s.page_name}</div>
                  <div className="text-xs text-slate-500 font-mono">{s.page_id}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={s.status === 'ok' ? 'chip-green' : 'chip-red'}>{s.status === 'ok' ? 'Subscribed' : 'Error'}</span>
                  <button onClick={() => subscribePage.mutate(s.page_id, {
                    onSuccess: () => toast.success('Webhook subscribed using the saved Page Access Token'),
                    onError: (error: unknown) => {
                      const apiError = error as { response?: { data?: { error?: { code?: string; message?: string } } } };
                      const code = apiError.response?.data?.error?.code;
                      toast.error(apiError.response?.data?.error?.message || 'Webhook reconnect failed');
                      if (code === 'META_PAGE_TOKEN_MISSING' || code === 'META_PAGE_TOKEN_INVALID') setTokenModal(true);
                    },
                  })}
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
          <p className="text-xs text-slate-600">A fresh user token is used only to refresh pages, ad accounts, and campaigns. The backend derives and securely saves Page Access Tokens for webhook and lead operations.</p>
          <Input label="Paste fresh User Access Token" type="password" value={userToken} onChange={e => setUserToken(e.target.value)} placeholder="Long-lived user token" />
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
                    {(data.sync_logs as MetaSyncLogRow[]).map((l) => (
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
                    {(data.activity_logs as ActivityLogRow[]).map((l) => (
                      <tr key={l.id} className="hover:bg-slate-50">
                        <td className="py-2 pr-3 text-xs text-slate-500">{fmtRelative(l.created_at)}</td>
                        <td className="py-2 pr-3 text-xs text-slate-700">{l.user_name || '—'}</td>
                        <td className="py-2 pr-3"><span className="chip-slate text-[10px]">{l.action}</span></td>
                        <td className="py-2 pr-3 text-xs text-slate-600">{l.entity}</td>
                        <td className="py-2 text-xs text-slate-500 truncate max-w-[200px]">{formatLogMetadata(l.metadata)}</td>
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
                    {(data.audit_logs as ActivityLogRow[]).map((l) => (
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
