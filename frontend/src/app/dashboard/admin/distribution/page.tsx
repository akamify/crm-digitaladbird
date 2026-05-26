'use client';
import { useState } from 'react';
import Link from 'next/link';
import { GitBranch, ArrowLeft, Plus, Pencil, Trash2, Play, Pause, Loader2, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Modal, Skeleton, EmptyState } from '@/components/ui/Modal';
import { useDistributionRules, useCreateRule, useUpdateRule, useDeleteRule } from '@/hooks/useAdminEnterprise';
import { apiGet } from '@/lib/api';
import { fmtDate, clsx, humanize } from '@/lib/format';

export default function DistributionPage() {
  return (
    <AppShell title="Distribution Rules" subtitle="Configure lead auto-distribution strategy" roles={['super_admin']}>
      <DistributionInner />
    </AppShell>
  );
}

function DistributionInner() {
  const { data: rules, isLoading } = useDistributionRules();
  const distStats = useQuery({ queryKey: ['dist-stats'], queryFn: () => apiGet<any>('/distribution/stats'), staleTime: 30_000, refetchInterval: 60_000 });
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState({ name: '', strategy: 'round_robin', priority: '100' });

  const createRule = useCreateRule();
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();

  function openCreate() { setForm({ name: '', strategy: 'round_robin', priority: '100' }); setCreateOpen(true); }
  function openEdit(r: any) { setForm({ name: r.name, strategy: r.strategy, priority: String(r.priority ?? 100) }); setEditItem(r); }

  function handleSave() {
    if (!form.name.trim()) { toast.error('Rule name required'); return; }
    const body = { name: form.name, strategy: form.strategy, priority: Number(form.priority) };
    if (editItem) {
      updateRule.mutate({ id: editItem.id, ...body }, { onSuccess: () => { toast.success('Rule updated'); setEditItem(null); }, onError: () => toast.error('Failed') });
    } else {
      createRule.mutate(body, { onSuccess: () => { toast.success('Rule created'); setCreateOpen(false); }, onError: () => toast.error('Failed') });
    }
  }

  const ds = distStats.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="h-4 w-4" /></Link>
        <GitBranch className="h-5 w-5 text-brand-600" />
        <h1 className="text-lg font-semibold text-slate-900">Distribution Rules</h1>
      </div>

      {/* Live Stats */}
      {ds && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <StatCard label="Queued" value={ds.queued_leads} color="text-amber-700" />
          <StatCard label="Pending Work" value={ds.total_pending} color="text-rose-700" />
          <StatCard label="Today Distributed" value={ds.today_distributed} color="text-green-700" />
          <StatCard label="Today Received" value={ds.today_received} color="text-blue-700" />
          <StatCard label="Blocked Members" value={ds.blocked_members} color="text-red-700" />
          <StatCard label="Distribution" value={ds.distribution_enabled === 'true' ? 'Active' : 'Paused'} color={ds.distribution_enabled === 'true' ? 'text-green-700' : 'text-amber-700'} />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-700">Rules ({rules?.length ?? 0})</h2>
        <button onClick={openCreate} className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
          <Plus className="h-4 w-4" /> New Rule
        </button>
      </div>

      {/* Rules table */}
      {isLoading ? <Skeleton className="h-48" /> : !rules?.length ? (
        <EmptyState title="No distribution rules" description="Create your first auto-distribution rule." icon={<GitBranch className="h-6 w-6" />} />
      ) : (
        <div className="card-padded overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-medium">Rule Name</th>
                <th className="py-2 pr-3 font-medium">Strategy</th>
                <th className="py-2 pr-3 font-medium">Priority</th>
                <th className="py-2 pr-3 font-medium">Form ID</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Created</th>
                <th className="py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rules.map((r: any) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="py-3 pr-3 font-medium text-slate-900">{r.name}</td>
                  <td className="py-3 pr-3"><span className="chip-blue">{humanize(r.strategy)}</span></td>
                  <td className="py-3 pr-3 tabular-nums text-slate-600">{r.priority ?? '—'}</td>
                  <td className="py-3 pr-3 text-xs text-slate-500 max-w-[120px] truncate">{r.form_id || '—'}</td>
                  <td className="py-3 pr-3">
                    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                      r.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
                      {r.is_active ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                      {r.is_active ? 'Active' : 'Paused'}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-xs text-slate-500">{fmtDate(r.created_at, 'dd MMM yyyy')}</td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => updateRule.mutate({ id: r.id, is_active: !r.is_active }, { onSuccess: () => toast.success(r.is_active ? 'Paused' : 'Activated') })}
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        {r.is_active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </button>
                      <button onClick={() => openEdit(r)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-600"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => { if (confirm(`Delete "${r.name}"?`)) deleteRule.mutate(r.id, { onSuccess: () => toast.success('Deleted') }); }}
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
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
        title={editItem ? 'Edit Rule' : 'New Distribution Rule'} size="sm">
        <div className="space-y-3">
          <div><label className="label">Rule Name *</label><input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div><label className="label">Strategy *</label>
            <select className="input" value={form.strategy} onChange={e => setForm(f => ({ ...f, strategy: e.target.value }))}>
              <option value="round_robin">Round Robin</option>
              <option value="weighted">Weighted</option>
              <option value="priority_queue">Priority Queue</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <div><label className="label">Priority (lower = first)</label><input className="input" type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} /></div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => { setCreateOpen(false); setEditItem(null); }} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button onClick={handleSave} disabled={createRule.isPending || updateRule.isPending}
            className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
            {(createRule.isPending || updateRule.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
            {editItem ? 'Save' : 'Create'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <div className={clsx('text-xl font-bold tabular-nums', color)}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
