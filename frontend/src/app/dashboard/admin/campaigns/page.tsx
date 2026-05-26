'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  Megaphone, Plus, Pencil, Trash2, Play, Pause, ArrowLeft, Search,
  TrendingUp, Loader2, BarChart3, Filter,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Modal, Skeleton, EmptyState } from '@/components/ui/Modal';
import { useAdminCampaigns, useCreateCampaign, useUpdateCampaign, useDeleteCampaign } from '@/hooks/useAdminEnterprise';
import { fmtDate, clsx, humanize } from '@/lib/format';

export default function CampaignsPage() {
  return (
    <AppShell title="Campaign Management" subtitle="Create, edit, pause and monitor all campaigns" roles={['super_admin']}>
      <CampaignsInner />
    </AppShell>
  );
}

function CampaignsInner() {
  const { data: campaigns, isLoading } = useAdminCampaigns();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'paused'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState({ campaign_name: '', internal_label: '', category: '', ad_account_id: '' });

  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const deleteCampaign = useDeleteCampaign();

  const filtered = (campaigns || [])
    .filter(c => filter === 'all' || (filter === 'active' ? c.is_active : !c.is_active))
    .filter(c => !search || c.campaign_name?.toLowerCase().includes(search.toLowerCase()) || c.internal_label?.toLowerCase().includes(search.toLowerCase()));

  const totals = (campaigns || []).reduce((a, c) => ({
    leads: a.leads + c.total_leads, today: a.today + c.today_leads, conv: a.conv + c.conversions, pending: a.pending + c.pending_leads,
  }), { leads: 0, today: 0, conv: 0, pending: 0 });

  function openCreate() {
    setForm({ campaign_name: '', internal_label: '', category: '', ad_account_id: '' });
    setCreateOpen(true);
  }

  function openEdit(c: any) {
    setForm({ campaign_name: c.campaign_name, internal_label: c.internal_label || '', category: c.category || '', ad_account_id: c.ad_account_id || '' });
    setEditItem(c);
  }

  function handleSave() {
    if (!form.campaign_name.trim()) { toast.error('Campaign name required'); return; }
    if (editItem) {
      updateCampaign.mutate({ id: editItem.id, ...form }, {
        onSuccess: () => { toast.success('Campaign updated'); setEditItem(null); },
        onError: () => toast.error('Update failed'),
      });
    } else {
      createCampaign.mutate(form, {
        onSuccess: () => { toast.success('Campaign created'); setCreateOpen(false); },
        onError: () => toast.error('Create failed'),
      });
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
          {(['all', 'active', 'paused'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={clsx('rounded-md px-3 py-1.5 text-xs font-medium transition', filter === f ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>
              {f === 'all' ? 'All' : f === 'active' ? 'Active' : 'Paused'}
            </button>
          ))}
        </div>
        <button onClick={openCreate} className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
          <Plus className="h-4 w-4" /> New Campaign
        </button>
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
                  <td className="py-3 pr-3">{c.category ? <span className="chip-blue">{humanize(c.category)}</span> : '—'}</td>
                  <td className="py-3 pr-3">
                    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                      c.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
                      {c.is_active ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                      {c.is_active ? 'Active' : 'Paused'}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums font-medium">{c.total_leads}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-emerald-700">{c.today_leads}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-green-700">{c.conversions}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-amber-700">{c.pending_leads}</td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => updateCampaign.mutate({ id: c.id, is_active: !c.is_active }, { onSuccess: () => toast.success(c.is_active ? 'Paused' : 'Activated') })}
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title={c.is_active ? 'Pause' : 'Activate'}>
                        {c.is_active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </button>
                      <button onClick={() => openEdit(c)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-600" title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => { if (confirm(`Delete "${c.campaign_name}"?`)) deleteCampaign.mutate(c.id, { onSuccess: () => toast.success('Deleted') }); }}
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
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
      <Modal open={createOpen || !!editItem} onClose={() => { setCreateOpen(false); setEditItem(null); }}
        title={editItem ? 'Edit Campaign' : 'Create Campaign'} size="md">
        <div className="space-y-3">
          <div>
            <label className="label">Campaign Name *</label>
            <input className="input" value={form.campaign_name} onChange={e => setForm(f => ({ ...f, campaign_name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Internal Label</label>
              <input className="input" value={form.internal_label} onChange={e => setForm(f => ({ ...f, internal_label: e.target.value }))} />
            </div>
            <div>
              <label className="label">Category</label>
              <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                <option value="">None</option>
                <option value="partner">Partner</option>
                <option value="trader">Trader</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Ad Account ID</label>
            <input className="input" value={form.ad_account_id} onChange={e => setForm(f => ({ ...f, ad_account_id: e.target.value }))} placeholder="e.g. act_123456" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => { setCreateOpen(false); setEditItem(null); }} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button onClick={handleSave} disabled={createCampaign.isPending || updateCampaign.isPending}
            className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
            {(createCampaign.isPending || updateCampaign.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
            {editItem ? 'Save Changes' : 'Create Campaign'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className={clsx('text-2xl font-bold tabular-nums', color)}>{value.toLocaleString()}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}
