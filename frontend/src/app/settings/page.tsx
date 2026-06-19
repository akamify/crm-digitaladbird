'use client';
import { useState, useEffect, FormEvent } from 'react';
import * as React from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Settings as Cog, Copy, Webhook, Facebook, FileText, Clock, Play,
  CheckCircle2, XCircle, AlertCircle, RefreshCw, Sheet, ExternalLink, Eye,
  Loader2, ChevronDown, ChevronRight, Zap, Shield, Globe, Search,
  ArrowLeft, Database, Activity, Radio, Key, Megaphone, BarChart3,
  ChevronLeft, Download, Filter, Users, Pencil,
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
  useTestPageToken, useUpdatePageToken,
  // Dynamic Google Sheets credential management
  useSheetConfigs, useSheetsConnectivity, useCreateSheetConfig, useUpdateSheetConfig,
  useActivateSheetConfig, useTestSheetConfig, useSyncSheetConfig, useDeleteSheetConfig,
  useSheetPreview, useSheetStats,
  // Sheet → CRM import
  useSheetImport, useSheetImportLogs, useToggleAutoImport,
  type SheetConfigPublic,
} from '@/hooks/useAdminEnterprise';
import { Upload, Power, FlaskConical, PlayCircle, Trash, Table as TableIcon, ArrowDownToLine, Timer, ScrollText } from 'lucide-react';
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
  const [pageToken, setPageToken] = useState('');
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
    if (!userToken && !pageToken) { toast.error('Enter at least one token'); return; }
    updateToken.mutate(
      { user_access_token: userToken || undefined, page_access_token: pageToken || undefined },
      {
        onSuccess: () => {
          toast.success('Token updated + campaigns syncing');
          setTokenModal(false); setUserToken(''); setPageToken('');
          qc.invalidateQueries({ queryKey: ['integration-status'] });
        },
        onError: () => toast.error('Update failed — check token validity'),
      },
    );
  }

  const ts = tokenStatus.data;
  const tokenOk = ts?.has_page_token && ts?.has_user_token;

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
          <span className="text-[10px] text-slate-500">User + Page access</span>
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
            Generate tokens from <a className="underline" href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer">Graph API Explorer</a> with scopes: <code className="bg-amber-100 px-1 rounded">leads_retrieval, pages_show_list, pages_read_engagement, ads_read, business_management</code>.
          </div>
          <Input label="User Access Token (long-lived)" type="password" value={userToken} onChange={(e) => setUserToken(e.target.value)} placeholder="EAAxxx..." />
          <Input label="Page Access Token (long-lived)" type="password" value={pageToken} onChange={(e) => setPageToken(e.target.value)} placeholder="EAAxxx..." />
          <p className="text-[11px] text-slate-500">Tokens are saved in-memory immediately; campaigns auto-sync after update. To persist across restarts, also update <code>backend/.env</code>.</p>
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
            <div key={p.id} className="card card-hover p-5">
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
                  p.has_token
                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                    : 'bg-rose-50 text-rose-700 ring-rose-200'
                )}>
                  <StatusDot ok={p.has_token} warn={!p.has_token} />
                  {p.has_token ? 'Token OK' : 'No token'}
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
                  Test Token
                </button>
                <button onClick={() => { setUpdateTokenPage({ page_id: p.page_id, page_name: p.page_name || p.page_id }); setNewToken(''); }}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100 transition">
                  <Key className="h-3 w-3" /> Update Token
                </button>
              </div>
            </div>
          ))}
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

      {/* Dynamic credentials management — admin can upload JSON, switch sheets, no SSH/.env needed */}
      <SheetCredentialsManager />

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

/* ═══════════════════ SHEET CREDENTIALS MANAGER (dynamic, admin-only) ═══════════════════
 * Admin uploads / pastes Google Service-Account JSON directly, switches active sheet,
 * tests / syncs / previews — everything without SSH or .env editing.
 */
function SheetCredentialsManager() {
  const list = useSheetConfigs();
  const conn = useSheetsConnectivity();
  const stats = useSheetStats();
  const activate = useActivateSheetConfig();
  const testOne = useTestSheetConfig();
  const syncOne = useSyncSheetConfig();
  const del = useDeleteSheetConfig();
  const importNow = useSheetImport();
  const toggleAuto = useToggleAutoImport();

  // Tab: which purpose are we viewing? Defaults to traders.
  const [tab, setTab] = useState<'traders' | 'partners'>('traders');
  // Preview is purpose-aware so each tab previews its OWN active sheet
  const preview = useSheetPreview(8, tab);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadDefaultPurpose, setUploadDefaultPurpose] = useState<'traders' | 'partners'>('traders');
  const [editTarget, setEditTarget] = useState<SheetConfigPublic | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [logsTarget, setLogsTarget] = useState<SheetConfigPublic | null>(null);

  // Configs scoped to the current tab (only show this purpose's sheets)
  const allConfigs = list.data || [];
  const tabConfigs = allConfigs.filter(c => c.purpose === tab || (!c.purpose && tab === 'traders'));
  const activeForTab = tabConfigs.find(c => c.is_active) || null;

  const tabStats = stats.data?.[tab];

  return (
    <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sheet className="h-4 w-4 text-emerald-600" />
        <h2 className="text-sm font-semibold text-slate-900">Credentials & Sheets</h2>
        <span className={clsx('chip text-[10px]', conn.data?.api_connected ? 'chip-emerald' : 'chip-amber')}>
          {conn.data?.api_connected ? `Live · source: ${conn.data?.source || '—'}` : conn.isLoading ? 'Checking…' : 'Not connected'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" leftIcon={<TableIcon className="h-3.5 w-3.5" />}
            disabled={!activeForTab || !activeForTab.is_active}
            onClick={() => { preview.refetch(); setPreviewOpen(true); }}>
            Preview Rows
          </Button>
          <Button size="sm" leftIcon={<Upload className="h-3.5 w-3.5" />}
            onClick={() => { setUploadDefaultPurpose(tab); setUploadOpen(true); }}>
            Upload {tab === 'traders' ? 'Traders' : 'Partners'} Credentials
          </Button>
        </div>
      </div>

      {/* Purpose tabs — Traders | Partners — each runs an independent sheet */}
      <div className="mb-3 flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 w-fit">
        {(['traders', 'partners'] as const).map(t => {
          const count = allConfigs.filter(c => c.purpose === t || (!c.purpose && t === 'traders')).length;
          const hasActive = !!allConfigs.find(c => c.is_active && (c.purpose === t || (!c.purpose && t === 'traders')));
          return (
            <button key={t} onClick={() => setTab(t)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition',
                tab === t ? 'bg-emerald-600 text-white' : 'text-slate-700 hover:bg-slate-50',
              )}>
              {t === 'traders' ? '📊 Traders Sheet' : '🤝 Partners Sheet'}
              <span className={clsx('rounded-full px-1.5 py-0.5 text-[10px] font-bold', tab === t ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600')}>{count}</span>
              {hasActive && <span className={clsx('h-1.5 w-1.5 rounded-full', tab === t ? 'bg-white' : 'bg-emerald-500')} />}
            </button>
          );
        })}
      </div>

      {/* Per-purpose stats bar — drives "Trader Sheet Stats" / "Partner Sheet Stats" */}
      {tabStats && (
        <div className="mb-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
          <div className="rounded-lg bg-white border border-slate-200 px-3 py-2">
            <div className="text-lg font-bold tabular-nums text-slate-900">{tabStats.total.toLocaleString()}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Total {tab === 'traders' ? 'Trader' : 'Partner'} Leads</div>
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
            <div className="text-lg font-bold tabular-nums text-amber-700">{tabStats.unassigned.toLocaleString()}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Pending (unassigned)</div>
          </div>
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
            <div className="text-lg font-bold tabular-nums text-blue-700">{tabStats.assigned.toLocaleString()}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Synced (assigned)</div>
          </div>
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
            <div className="text-lg font-bold tabular-nums text-emerald-700">{tabStats.converted.toLocaleString()}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Converted</div>
          </div>
          <div className="rounded-lg bg-violet-50 border border-violet-200 px-3 py-2">
            <div className="text-lg font-bold tabular-nums text-violet-700">{tabStats.today.toLocaleString()}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Today</div>
          </div>
        </div>
      )}

      {list.isLoading ? <Skeleton className="h-32" /> : !tabConfigs.length ? (
        <div className="rounded-lg border border-dashed border-emerald-200 bg-white px-4 py-6 text-center">
          <Upload className="h-6 w-6 mx-auto text-emerald-400 mb-2" />
          <div className="text-sm font-medium text-slate-900">No {tab === 'traders' ? 'Traders' : 'Partners'} sheet uploaded yet</div>
          <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
            Click <strong>Upload {tab === 'traders' ? 'Traders' : 'Partners'} Credentials</strong> and pick the Google Service Account <code>.json</code> file.
            Each imported lead will be tagged <code>category = {tab === 'traders' ? 'trader' : 'partner'}</code> so {tab === 'traders' ? 'trader' : 'partner'} lead-requests pull from this pool only.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tabConfigs.map(c => (
            <div key={c.id}
              className={clsx(
                'rounded-lg border bg-white p-3 transition',
                c.is_active ? 'border-emerald-300 ring-1 ring-emerald-200' : 'border-slate-200',
              )}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className={clsx('h-2 w-2 rounded-full shrink-0', c.is_active ? 'bg-emerald-500' : 'bg-slate-300')} />
                    <span className="text-sm font-semibold text-slate-900">{c.label}</span>
                    {c.is_active && <span className="chip-emerald text-[10px]">Active</span>}
                    {c.has_credentials ? (
                      <span className="chip-slate text-[10px]">JSON stored</span>
                    ) : (
                      <span className="chip-amber text-[10px]">No JSON</span>
                    )}
                    {c.last_test_ok === true && <span className="chip-emerald text-[10px]">Test OK</span>}
                    {c.last_test_ok === false && <span className="chip-rose text-[10px]" title={c.last_test_error || ''}>Test failed</span>}
                  </div>
                  <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                    <div><span className="text-slate-400">Sheet ID:</span> <span className="font-mono text-slate-700 truncate inline-block max-w-[260px] align-middle">{c.sheet_id || '—'}</span></div>
                    <div><span className="text-slate-400">Tab:</span> <span className="text-slate-700">{c.sheet_name}</span></div>
                    <div className="sm:col-span-2"><span className="text-slate-400">Service account:</span> <span className="font-mono text-slate-700 truncate inline-block max-w-[420px] align-middle">{c.service_account_email || '—'}</span></div>
                    {c.last_synced_at && <div className="sm:col-span-2"><span className="text-slate-400">Last synced:</span> <span className="text-slate-700">{fmtRelative(c.last_synced_at)} · {c.last_sync_count ?? 0} rows</span></div>}
                    {c.last_test_ok === false && c.last_test_error && (
                      <div className="sm:col-span-2 text-rose-600 truncate" title={c.last_test_error}>⚠ {c.last_test_error}</div>
                    )}
                    {c.last_import_at && c.last_import_stats && (
                      <div className="sm:col-span-2 text-emerald-700">
                        <ArrowDownToLine className="h-3 w-3 inline mr-1" />
                        Last import {fmtRelative(c.last_import_at)}:
                        <strong className="ml-1">{c.last_import_stats.imported}</strong> imported ·
                        <span className="ml-1">{c.last_import_stats.duplicates} dup</span> ·
                        <span className="ml-1 text-rose-600">{c.last_import_stats.failed} failed</span>
                        <span className="ml-1 text-slate-400">/ {c.last_import_stats.total}</span>
                      </div>
                    )}
                    {c.is_active && c.has_credentials && (
                      <div className="sm:col-span-2 flex items-center gap-2 mt-1">
                        <label className="inline-flex items-center gap-1.5 text-slate-600">
                          <input
                            type="checkbox"
                            checked={c.auto_import_enabled}
                            onChange={(e) => toggleAuto.mutate(
                              { id: c.id, enabled: e.target.checked },
                              {
                                onSuccess: () => toast.success(e.target.checked ? 'Auto-import enabled' : 'Auto-import disabled'),
                                onError: () => toast.error('Failed'),
                              },
                            )}
                            className="rounded border-slate-300"
                          />
                          <Timer className="h-3 w-3" />
                          Auto-import every
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={c.auto_import_minutes}
                          onChange={(e) => {
                            const m = Math.max(1, Math.min(60, Number(e.target.value) || 5));
                            toggleAuto.mutate({ id: c.id, minutes: m });
                          }}
                          className="input h-6 w-14 text-[11px] py-0 px-1"
                          disabled={!c.auto_import_enabled}
                        />
                        <span className="text-slate-500">minutes</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => testOne.mutate(c.id, {
                      onSuccess: (r) => toast.success(r.ok ? `OK — ${r.sheet_title || 'sheet reached'}` : `Failed — ${r.error || 'unknown'}`),
                      onError: (e: unknown) => toast.error((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Test failed'),
                    })}
                    disabled={!c.has_credentials || testOne.isPending}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    <FlaskConical className="h-3 w-3" /> Test
                  </button>
                  {!c.is_active && (
                    <button
                      onClick={() => activate.mutate(c.id, {
                        onSuccess: () => toast.success(`${c.label} is now active`),
                        onError: () => toast.error('Activation failed'),
                      })}
                      disabled={activate.isPending}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                      <Power className="h-3 w-3" /> Activate
                    </button>
                  )}
                  {c.is_active && (
                    <button
                      onClick={() => syncOne.mutate(c.id, {
                        onSuccess: (r) => toast.success(`Pushed ${r.synced} leads → Sheet`),
                        onError: (e: unknown) => toast.error((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Sync failed'),
                      })}
                      disabled={syncOne.isPending}
                      className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                      title="CRM → Sheet (push all leads from DB to the sheet)">
                      <PlayCircle className="h-3 w-3" /> Push to Sheet
                    </button>
                  )}
                  {c.is_active && c.has_credentials && (
                    <button
                      onClick={() => importNow.mutate({ id: c.id, max_rows: 5000, assign: true }, {
                        onSuccess: (r) => toast.success(`Imported ${r.imported} · ${r.duplicates} duplicates · ${r.failed} failed (of ${r.total})`),
                        onError: (e: unknown) => toast.error((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Import failed'),
                      })}
                      disabled={importNow.isPending}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                      title="Sheet → CRM (read all rows and create leads)">
                      {importNow.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowDownToLine className="h-3 w-3" />}
                      Import Leads From Sheet
                    </button>
                  )}
                  <button
                    onClick={() => setLogsTarget(c)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                    title="View import history">
                    <ScrollText className="h-3 w-3" /> Logs
                  </button>
                  <button
                    onClick={() => setEditTarget(c)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50">
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                  <button
                    onClick={() => {
                      if (!confirm(`Delete "${c.label}"? This will remove the credentials too.`)) return;
                      del.mutate(c.id, {
                        onSuccess: () => toast.success('Deleted'),
                        onError: () => toast.error('Delete failed'),
                      });
                    }}
                    disabled={del.isPending}
                    className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                    <Trash className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <SheetCredentialsModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        target={null}
        defaultPurpose={uploadDefaultPurpose}
      />
      <SheetCredentialsModal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        target={editTarget}
        defaultPurpose={editTarget?.purpose || uploadDefaultPurpose}
      />
      <SheetPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        data={preview.data ?? null}
        isLoading={preview.isFetching}
        error={preview.error as { response?: { data?: { error?: { message?: string } } } } | null}
      />
      <SheetImportLogsModal
        open={!!logsTarget}
        onClose={() => setLogsTarget(null)}
        config={logsTarget}
      />
    </div>
  );
}

function SheetImportLogsModal({ open, onClose, config }: { open: boolean; onClose: () => void; config: SheetConfigPublic | null }) {
  const logs = useSheetImportLogs(open && config ? config.id : null, 25);
  return (
    <Modal open={open} onClose={onClose} title={config ? `Import history — ${config.label}` : 'Import history'} size="xl">
      {logs.isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : !(logs.data || []).length ? (
        <div className="py-8 text-center text-sm text-slate-500">No imports yet.</div>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {(logs.data || []).map(l => (
            <div key={l.id} className={clsx(
              'rounded-lg border bg-white p-3',
              l.error_message ? 'border-rose-200' : l.failed > 0 ? 'border-amber-200' : 'border-slate-200',
            )}>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className={clsx('chip text-[10px]', l.triggered_by === 'auto' ? 'chip-blue' : 'chip-slate')}>
                  {l.triggered_by === 'auto' ? '⏱ Auto' : '👤 Manual'}
                </span>
                <span className="text-slate-700 font-medium">{fmtRelative(l.started_at)}</span>
                {l.triggered_by_name && <span className="text-slate-500">by {l.triggered_by_name}</span>}
                <span className="ml-auto text-slate-500">{l.finished_at ? `(${Math.max(0, Math.round((new Date(l.finished_at).getTime() - new Date(l.started_at).getTime()) / 100) / 10)}s)` : 'running…'}</span>
              </div>
              <div className="mt-1.5 grid grid-cols-4 gap-2 text-xs">
                <div className="rounded-md bg-emerald-50 px-2 py-1 text-center">
                  <div className="font-bold text-emerald-700">{l.imported}</div>
                  <div className="text-[9px] uppercase tracking-wide text-slate-500">Imported</div>
                </div>
                <div className="rounded-md bg-slate-50 px-2 py-1 text-center">
                  <div className="font-bold text-slate-700">{l.duplicates}</div>
                  <div className="text-[9px] uppercase tracking-wide text-slate-500">Duplicates</div>
                </div>
                <div className="rounded-md bg-rose-50 px-2 py-1 text-center">
                  <div className="font-bold text-rose-700">{l.failed}</div>
                  <div className="text-[9px] uppercase tracking-wide text-slate-500">Failed</div>
                </div>
                <div className="rounded-md bg-white border border-slate-200 px-2 py-1 text-center">
                  <div className="font-bold text-slate-900">{l.total_rows}</div>
                  <div className="text-[9px] uppercase tracking-wide text-slate-500">Total rows</div>
                </div>
              </div>
              {l.error_message && (
                <div className="mt-2 rounded-md bg-rose-50 border border-rose-200 px-2 py-1.5 text-xs text-rose-700">
                  {l.error_message}
                </div>
              )}
              {l.failed_samples && l.failed_samples.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700">Failure samples ({l.failed_samples.length})</summary>
                  <ul className="mt-1 space-y-0.5">
                    {l.failed_samples.map((s, i) => (
                      <li key={i} className="text-[11px] text-slate-600">Row {s.row_index}: <span className="text-rose-600">{s.error}</span></li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function SheetCredentialsModal({ open, onClose, target, defaultPurpose = 'traders' }: { open: boolean; onClose: () => void; target: SheetConfigPublic | null; defaultPurpose?: 'traders' | 'partners' }) {
  const create = useCreateSheetConfig();
  const update = useUpdateSheetConfig();
  const [label, setLabel] = useState('');
  const [sheetId, setSheetId] = useState('');
  const [sheetName, setSheetName] = useState('Leads');
  const [pasted, setPasted] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [makeActive, setMakeActive] = useState(true);
  const [purpose, setPurpose] = useState<'traders' | 'partners'>(defaultPurpose);

  // Hydrate on open
  React.useEffect(() => {
    if (!open) return;
    setLabel(target?.label || '');
    setSheetId(target?.sheet_id || '');
    setSheetName(target?.sheet_name || 'Leads');
    setPasted('');
    setFile(null);
    setMakeActive(target ? false : true);
    setPurpose((target?.purpose === 'partners' ? 'partners' : (target?.purpose === 'traders' ? 'traders' : defaultPurpose)));
  }, [open, target, defaultPurpose]);

  function pickFile(f: File | null) {
    setFile(f);
    if (f) setPasted(''); // mutually exclusive
  }

  function handleSave() {
    if (!sheetId.trim()) { toast.error('Sheet ID is required'); return; }
    if (!target) {
      create.mutate(
        { sheet_id: sheetId.trim(), label: label.trim() || `Sheet ${sheetId.slice(0, 8)}`, sheet_name: sheetName.trim() || 'Leads', purpose, make_active: makeActive, file, credentials_json: pasted || undefined },
        {
          onSuccess: () => { toast.success(makeActive ? 'Saved & activated' : 'Saved'); onClose(); },
          onError: (e: unknown) => toast.error((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Upload failed'),
        }
      );
    } else {
      const patch: { id: string; sheet_id?: string; sheet_name?: string; label?: string; purpose?: 'traders' | 'partners'; credentials_json?: string; file?: File | null } = { id: target.id };
      if (sheetId.trim() !== (target.sheet_id || '')) patch.sheet_id = sheetId.trim();
      if (sheetName.trim() !== target.sheet_name) patch.sheet_name = sheetName.trim();
      if (label.trim() !== target.label) patch.label = label.trim();
      if (purpose !== target.purpose) patch.purpose = purpose;
      if (file) patch.file = file;
      else if (pasted) patch.credentials_json = pasted;
      update.mutate(patch, {
        onSuccess: () => { toast.success('Updated'); onClose(); },
        onError: (e: unknown) => toast.error((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Update failed'),
      });
    }
  }

  const busy = create.isPending || update.isPending;

  return (
    <Modal open={open} onClose={onClose} title={target ? `Edit "${target.label}"` : 'Upload Google Sheets Credentials'} size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={busy}>{target ? 'Save changes' : 'Upload & save'}</Button>
        </>
      }>
      <div className="space-y-3">
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
          <AlertCircle className="h-3.5 w-3.5 inline mr-1" />
          Share the target sheet with the <strong>service-account email</strong> from inside the JSON (Editor access).
          File never leaves the server — encrypted at rest with the JWT secret.
        </div>

        <div>
          <label className="label">Sheet purpose *</label>
          <div className="flex gap-2">
            {(['traders', 'partners'] as const).map(p => (
              <button key={p} type="button" onClick={() => setPurpose(p)}
                className={clsx(
                  'flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition',
                  purpose === p
                    ? (p === 'traders' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-violet-300 bg-violet-50 text-violet-700')
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                )}>
                {p === 'traders' ? '📊 Traders sheet (leads.category = trader)' : '🤝 Partners sheet (leads.category = partner)'}
              </button>
            ))}
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            Every row imported from this sheet is tagged with the chosen category. Partner lead-requests will only see rows from a <em>partners</em> sheet, and trader requests only see <em>traders</em> sheet rows.
          </div>
        </div>

        <Input label="Label (internal name)" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Production Sheet 2026" />
        <Input label="Google Sheet ID *" value={sheetId} onChange={(e) => setSheetId(e.target.value)} placeholder="1kRY_XL7hTJfZng8…" />
        <Input label="Tab name" value={sheetName} onChange={(e) => setSheetName(e.target.value)} placeholder="Sheet1 / Leads" />

        <div>
          <label className="label">Service Account JSON {target ? '(leave blank to keep current)' : '*'}</label>
          <div className="flex gap-2 items-center">
            <label className={clsx(
              'flex-1 cursor-pointer rounded-lg border-2 border-dashed px-3 py-3 text-center text-xs transition',
              file ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600',
            )}>
              <input type="file" accept=".json,application/json" className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] || null)} />
              {file ? (
                <span className="inline-flex items-center gap-1"><Upload className="h-3 w-3" /> {file.name}</span>
              ) : (
                <span className="inline-flex items-center gap-1"><Upload className="h-3 w-3" /> Pick .json file…</span>
              )}
            </label>
            {file && (
              <button onClick={() => setFile(null)} className="text-[11px] text-slate-500 underline">Clear</button>
            )}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 mb-1">…or paste the JSON below:</div>
          <textarea
            className="input min-h-[110px] font-mono text-[11px]"
            placeholder='{ "type": "service_account", "client_email": "…", "private_key": "-----BEGIN PRIVATE KEY-----…" }'
            value={pasted}
            onChange={(e) => { setPasted(e.target.value); if (e.target.value) setFile(null); }}
          />
        </div>

        {!target && (
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={makeActive} onChange={(e) => setMakeActive(e.target.checked)} />
            Activate immediately (replaces the current active config — backend auto-reloads, no PM2 restart)
          </label>
        )}
      </div>
    </Modal>
  );
}

function SheetPreviewModal({ open, onClose, data, isLoading, error }: {
  open: boolean;
  onClose: () => void;
  data: { sheet_id: string; sheet_name: string; header: string[]; rows: string[][] } | null;
  isLoading: boolean;
  error: { response?: { data?: { error?: { message?: string } } } } | null;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Live Sheet Preview" size="xl">
      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error?.response?.data?.error?.message || 'Failed to read sheet'}
        </div>
      ) : !data ? (
        <div className="py-8 text-center text-sm text-slate-500">No preview yet — click Preview Rows again.</div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-slate-500 font-mono">{data.sheet_id} · {data.sheet_name}</div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  {data.header.map((h, i) => (
                    <th key={i} className="px-3 py-2 text-left font-semibold text-slate-700 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {row.map((cell, j) => (
                      <td key={j} className="px-3 py-1.5 text-slate-700 max-w-[260px] truncate" title={cell}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-slate-500">Showing first {data.rows.length} data row(s).</div>
        </div>
      )}
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
