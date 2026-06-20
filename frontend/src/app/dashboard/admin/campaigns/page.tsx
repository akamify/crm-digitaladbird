'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  Megaphone, Pencil, ArrowLeft, Search, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Modal, Skeleton, EmptyState } from '@/components/ui/Modal';
import { useAdminCampaigns, useUpdateCampaignCategory, useBackfillCampaignCategory, type AdminCampaign } from '@/hooks/useAdminEnterprise';
import { LeadCategoryBadge } from '@/components/leads/LeadCategoryBadge';
import { clsx, humanize } from '@/lib/format';

type ApiErrorLike = {
  response?: {
    data?: {
      message?: string;
      error?: { message?: string };
    };
  };
};

export default function CampaignsPage() {
  return (
    <AppShell title="Campaign Management" subtitle="Create, edit, pause and monitor all campaigns" roles={['super_admin']}>
      <CampaignsInner />
    </AppShell>
  );
}

function CampaignsInner() {
  const { data: campaigns, isLoading, refetch } = useAdminCampaigns();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'attention'>('all');
  const [editItem, setEditItem] = useState<AdminCampaign | null>(null);
  const [form, setForm] = useState({ campaign_name: '', internal_label: '', category: 'unknown' as 'trader' | 'partner' | 'unknown', ad_account_id: '', category_notes: '', backfill_mode: 'none' as 'none' | 'dry_run' | 'unknown_only' | 'force_all' });

  const updateCategory = useUpdateCampaignCategory();
  const backfillCategory = useBackfillCampaignCategory();

  const filtered = (campaigns || [])
    .filter(c => {
      if (filter === 'all') return true;
      const status = metaStatusTone(c).key;
      if (filter === 'active') return status === 'active';
      if (filter === 'paused') return status === 'paused';
      return status === 'attention';
    })
    .filter(c => !search || c.campaign_name?.toLowerCase().includes(search.toLowerCase()) || c.internal_label?.toLowerCase().includes(search.toLowerCase()));

  const totals = (campaigns || []).reduce((a, c) => ({
    leads: a.leads + c.total_leads, today: a.today + c.today_leads, conv: a.conv + c.conversions, pending: a.pending + c.pending_leads,
  }), { leads: 0, today: 0, conv: 0, pending: 0 });

  function openEdit(c: AdminCampaign) {
    const category = c.lead_category || (c.category as 'trader' | 'partner' | 'unknown') || 'unknown';
    setForm({ campaign_name: c.campaign_name, internal_label: c.internal_label || '', category, ad_account_id: c.ad_account_id || '', category_notes: c.category_notes || '', backfill_mode: 'none' });
    setEditItem(c);
  }

  function errorMessage(error: unknown, fallback: string) {
    return (error as ApiErrorLike)?.response?.data?.message
      || (error as ApiErrorLike)?.response?.data?.error?.message
      || fallback;
  }

  async function handleSave() {
    if (editItem) {
      try {
        if (process.env.NODE_ENV === 'development') {
          console.debug('[CampaignSave] step=updateCategory:start', {
            campaignId: editItem.campaign_id,
            category: form.category,
            backfill_mode: form.backfill_mode,
          });
        }
        await updateCategory.mutateAsync({ campaignId: editItem.campaign_id, category: form.category, notes: form.category_notes });

        if (form.backfill_mode !== 'none') {
          if (process.env.NODE_ENV === 'development') {
            console.debug('[CampaignSave] step=backfillCategory:start', {
              campaignId: editItem.campaign_id,
              mode: form.backfill_mode,
            });
          }
          const summary = await backfillCategory.mutateAsync({ campaignId: editItem.campaign_id, mode: form.backfill_mode });
          if (process.env.NODE_ENV === 'development') {
            console.debug('[CampaignSave] step=backfillCategory:success', summary);
          }
          toast.success(
            form.backfill_mode === 'dry_run'
              ? `Campaign category updated successfully. Dry run: ${summary.updated} update candidates, ${summary.skipped} skipped.`
              : `Campaign category updated successfully. Backfill: ${summary.updated} updated, ${summary.skipped} skipped.`,
          );
        } else {
          toast.success('Campaign category updated successfully.');
        }
        await refetch();
        setEditItem(null);
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('[CampaignSave] step=failed', error);
        }
        toast.error(errorMessage(error, 'Campaign category update failed.'));
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="h-4 w-4" /></Link>
        <Megaphone className="h-5 w-5 text-brand-600" />
        <h1 className="text-lg font-semibold text-slate-900">Campaigns</h1>
        <span className="chip-slate ml-1">{campaigns?.length ?? 0} total</span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Total Leads" value={totals.leads} color="text-brand-700" />
        <SummaryCard label="Today" value={totals.today} color="text-emerald-700" />
        <SummaryCard label="Conversions" value={totals.conv} color="text-green-700" />
        <SummaryCard label="Pending" value={totals.pending} color="text-amber-700" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input className="input pl-10" placeholder="Search campaigns..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5">
          {(['all', 'active', 'paused', 'attention'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={clsx('rounded-md px-3 py-1.5 text-xs font-medium transition', filter === f ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>
              {f === 'all' ? 'All' : f === 'active' ? 'Active' : f === 'paused' ? 'Paused' : 'Needs attention'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? <Skeleton className="h-64" /> : filtered.length === 0 ? (
        <EmptyState title="No campaigns found" description="Create your first campaign or adjust filters." icon={<Megaphone className="h-6 w-6" />} />
      ) : (
        <div className="card-padded overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-medium">Campaign</th>
                <th className="py-2 pr-3 font-medium">Label</th>
                <th className="py-2 pr-3 font-medium">Category</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium text-right">Leads</th>
                <th className="py-2 pr-3 font-medium text-right">Today</th>
                <th className="py-2 pr-3 font-medium text-right">Conv</th>
                <th className="py-2 pr-3 font-medium text-right">Pending</th>
                <th className="py-2 pr-3 font-medium">Meta Source</th>
                <th className="py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-slate-50 transition">
                  <td className="py-3 pr-3">
                    <div className="font-medium text-slate-900 max-w-[200px] truncate">{c.campaign_name}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{c.campaign_id}</div>
                  </td>
                  <td className="py-3 pr-3 text-slate-600">{c.internal_label || '—'}</td>
                  <td className="py-3 pr-3"><LeadCategoryBadge category={c.lead_category || (c.category as 'trader' | 'partner' | 'unknown')} /></td>
                  <td className="py-3 pr-3">
                    <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium', metaStatusTone(c).className)}>
                      {metaStatusTone(c).label}
                    </span>
                    <div className="mt-1 text-[10px] text-slate-400">
                      {c.effective_status || c.meta_status || 'Unknown'}
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums font-medium">{c.total_leads}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-emerald-700">{c.today_leads}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-green-700">{c.conversions}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-amber-700">{c.pending_leads}</td>
                  <td className="py-3 pr-3 text-xs text-slate-500">{c.source === 'meta_api' ? 'Meta API' : humanize(c.source || 'legacy')}</td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(c)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-600" title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal open={!!editItem} onClose={() => setEditItem(null)}
        title="Edit Campaign Category" size="md">
        <div className="space-y-3">
          <div>
            <label className="label">Campaign Name</label>
            <input className="input bg-slate-50 text-slate-600" value={form.campaign_name} readOnly />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Internal Label</label>
              <input className="input bg-slate-50 text-slate-600" value={form.internal_label} readOnly />
            </div>
            <div>
              <label className="label">Category</label>
              <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as 'trader' | 'partner' | 'unknown' }))}>
                <option value="trader">Trader Lead</option>
                <option value="partner">Partner Lead</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Ad Account ID</label>
            <input className="input" value={form.ad_account_id} readOnly placeholder="e.g. act_123456" />
          </div>
          <div><label className="label">Category notes</label><textarea className="input min-h-20" value={form.category_notes} onChange={e => setForm(f => ({ ...f, category_notes: e.target.value }))} /></div>
          <p className="text-xs text-slate-500">Campaign name and status are fetched dynamically from Meta. Pause, activate, delete, or rename must be done in Meta Ads Manager.</p>
          <div>
            <label className="label">Existing leads</label>
            <select className="input" value={form.backfill_mode} onChange={e => setForm(f => ({ ...f, backfill_mode: e.target.value as typeof f.backfill_mode }))}>
              <option value="none">No, only future leads</option>
              <option value="dry_run">Dry run</option>
              <option value="unknown_only">Yes, update only unknown leads</option>
              <option value="force_all">Yes, force update all leads</option>
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setEditItem(null)} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button onClick={handleSave} disabled={updateCategory.isPending || backfillCategory.isPending}
            className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
            {(updateCategory.isPending || backfillCategory.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Changes
          </button>
        </div>
      </Modal>
    </div>
  );
}

function metaStatusTone(c: AdminCampaign) {
  const status = String(c.effective_status || c.meta_status || c.configured_status || '').toUpperCase();
  if (status === 'ACTIVE') return { key: 'active', label: 'Active', className: 'bg-emerald-100 text-emerald-700' };
  if (['PAUSED', 'ARCHIVED', 'DELETED'].includes(status)) return { key: 'paused', label: status === 'PAUSED' ? 'Paused' : humanize(status), className: 'bg-slate-100 text-slate-600' };
  if (['IN_PROCESS', 'WITH_ISSUES', 'PENDING_REVIEW', 'DISAPPROVED'].includes(status)) return { key: 'attention', label: humanize(status), className: 'bg-amber-100 text-amber-700' };
  return { key: 'attention', label: 'Unknown', className: 'bg-slate-100 text-slate-500' };
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className={clsx('text-2xl font-bold tabular-nums', color)}>{value.toLocaleString()}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}
