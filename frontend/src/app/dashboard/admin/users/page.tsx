'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  Users, ArrowLeft, Search, Plus, Pencil, Trash2, ShieldBan, ShieldCheck,
  KeyRound, Settings2, Loader2, Eye, ChevronDown, UserRound,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Modal, Skeleton, EmptyState } from '@/components/ui/Modal';
import { useUsers, useCreateUser, useUpdateUser, useDeleteUser } from '@/hooks/useUsers';
import { useBlockUser, useUnblockUser, useResetPassword } from '@/hooks/useAdmin';
import { useUpdateUserSettings, useAdminUserDetail } from '@/hooks/useAdminEnterprise';
import { fmtDate, clsx, humanize } from '@/lib/format';
import type { Role, User } from '@/types';

export default function UsersManagerPage() {
  return (
    <AppShell title="User Management" subtitle="Manage all RMs, members, and partners" roles={['super_admin', 'admin']}>
      <UsersInner />
    </AppShell>
  );
}

function UsersInner() {
  const { data: users, isLoading } = useUsers();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [resetPwdUser, setResetPwdUser] = useState<User | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [settingsUser, setSettingsUser] = useState<User | null>(null);
  const [settings, setSettings] = useState({ daily_lead_cap: '', distribution_weight: '', team_name: '' });
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', role: 'member' as Role, team_name: '', report_to_id: '' });

  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const blockUser = useBlockUser();
  const unblockUser = useUnblockUser();
  const resetPassword = useResetPassword();
  const updateSettings = useUpdateUserSettings();
  const userDetail = useAdminUserDetail(detailUserId);

  const rms = (users || []).filter(u => u.role === 'rm');

  const filtered = (users || [])
    .filter(u => roleFilter === 'all' || u.role === roleFilter)
    .filter(u => statusFilter === 'all' || u.status === statusFilter)
    .filter(u => !search || u.full_name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase()) || u.phone?.includes(search));

  const counts = {
    total: users?.length ?? 0,
    admin: users?.filter(u => u.role === 'super_admin').length ?? 0,
    rm: users?.filter(u => u.role === 'rm').length ?? 0,
    member: users?.filter(u => u.role === 'member').length ?? 0,
    partner: users?.filter(u => u.role === 'partner').length ?? 0,
    blocked: users?.filter(u => u.status === 'blocked').length ?? 0,
  };

  function openCreate() {
    setForm({ full_name: '', email: '', phone: '', role: 'member', team_name: '', report_to_id: '' });
    setCreateOpen(true);
  }
  function openEdit(u: User) {
    setForm({ full_name: u.full_name, email: u.email, phone: u.phone, role: u.role, team_name: u.team_name || '', report_to_id: u.report_to_id || '' });
    setEditUser(u);
  }
  function openSettings(u: User) {
    setSettings({ daily_lead_cap: String(u.daily_lead_cap ?? ''), distribution_weight: String(u.distribution_weight ?? ''), team_name: u.team_name || '' });
    setSettingsUser(u);
  }

  function handleSaveUser() {
    if (!form.full_name || !form.email || !form.phone) { toast.error('Name, email, phone required'); return; }
    const body: any = { full_name: form.full_name, email: form.email, phone: form.phone, role: form.role, report_to_id: form.report_to_id || null, team_name: form.team_name || null };
    if (editUser) {
      updateUser.mutate({ id: editUser.id, ...body }, {
        onSuccess: () => { toast.success('User updated'); setEditUser(null); },
        onError: (e: any) => toast.error(e?.response?.data?.error?.message || 'Failed'),
      });
    } else {
      createUser.mutate(body, {
        onSuccess: () => { toast.success('User created'); setCreateOpen(false); },
        onError: (e: any) => toast.error(e?.response?.data?.error?.message || 'Failed'),
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="h-4 w-4" /></Link>
        <Users className="h-5 w-5 text-brand-600" />
        <h1 className="text-lg font-semibold text-slate-900">User Management</h1>
      </div>

      {/* Count cards */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        <CountCard label="Total" value={counts.total} color="text-slate-900" />
        <CountCard label="Admins" value={counts.admin} color="text-violet-700" />
        <CountCard label="RMs" value={counts.rm} color="text-blue-700" />
        <CountCard label="Members" value={counts.member} color="text-sky-700" />
        <CountCard label="Partners" value={counts.partner} color="text-emerald-700" />
        <CountCard label="Blocked" value={counts.blocked} color="text-red-700" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input className="input pl-10" placeholder="Search name, email, phone..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-32" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="all">All Roles</option>
          <option value="super_admin">Admin</option>
          <option value="rm">RM</option>
          <option value="member">Member</option>
          <option value="partner">Partner</option>
        </select>
        <select className="input w-32" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="blocked">Blocked</option>
        </select>
        <button onClick={openCreate} className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add User
        </button>
      </div>

      {/* Table */}
      {isLoading ? <Skeleton className="h-64" /> : filtered.length === 0 ? (
        <EmptyState title="No users found" description="Adjust filters or add a new user." icon={<Users className="h-6 w-6" />} />
      ) : (
        <div className="card-padded overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-medium">User</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 pr-3 font-medium">Team</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Lead Cap</th>
                <th className="py-2 pr-3 font-medium">Joined</th>
                <th className="py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(u => (
                <tr key={u.id} className="hover:bg-slate-50 transition">
                  <td className="py-3 pr-3">
                    <Link href={`/dashboard/admin/users/${u.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {u.full_name}
                    </Link>
                    <div className="text-xs text-slate-500">{u.email} · {u.phone}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <span className={clsx('chip', u.role === 'super_admin' ? 'chip-violet' : u.role === 'rm' ? 'chip-blue' : u.role === 'partner' ? 'chip-green' : 'chip-slate')}>
                      {humanize(u.role)}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-slate-600">{u.team_name || '—'}</td>
                  <td className="py-3 pr-3">
                    <span className={clsx('text-[10px] rounded-full px-2 py-0.5 font-medium', u.status === 'blocked' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700')}>
                      {u.status === 'blocked' ? 'Blocked' : 'Active'}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-slate-600 tabular-nums">{u.daily_lead_cap ?? '—'}</td>
                  <td className="py-3 pr-3 text-xs text-slate-500">{fmtDate(u.created_at, 'dd MMM yyyy')}</td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/dashboard/admin/users/${u.id}`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600" title="Open Profile">
                        <UserRound className="h-3.5 w-3.5" />
                      </Link>
                      <button onClick={() => setDetailUserId(u.id)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-600" title="View Details"><Eye className="h-3.5 w-3.5" /></button>
                      <button onClick={() => openEdit(u)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-600" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => openSettings(u)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-violet-600" title="Settings"><Settings2 className="h-3.5 w-3.5" /></button>
                      <button onClick={() => setResetPwdUser(u)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-orange-600" title="Reset Password"><KeyRound className="h-3.5 w-3.5" /></button>
                      {u.role !== 'super_admin' && (u.status === 'blocked' ? (
                        <button onClick={() => unblockUser.mutate(u.id, { onSuccess: () => toast.success('Unblocked') })}
                          className="rounded p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600" title="Unblock"><ShieldCheck className="h-3.5 w-3.5" /></button>
                      ) : (
                        <button onClick={() => { if (confirm(`Block ${u.full_name}?`)) blockUser.mutate({ userId: u.id }, { onSuccess: () => toast.success('Blocked') }); }}
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Block"><ShieldBan className="h-3.5 w-3.5" /></button>
                      ))}
                      {u.role !== 'super_admin' && (
                        <button onClick={() => { if (confirm(`Delete ${u.full_name}? This is permanent.`)) deleteUser.mutate(u.id, { onSuccess: () => toast.success('Deleted') }); }}
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal open={createOpen || !!editUser} onClose={() => { setCreateOpen(false); setEditUser(null); }}
        title={editUser ? `Edit ${editUser.full_name}` : 'Add New User'} size="md">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Full Name *</label><input className="input" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} /></div>
            <div><label className="label">Role *</label>
              <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))}>
                <option value="member">Member</option><option value="rm">RM</option><option value="partner">Partner</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Email *</label><input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div><label className="label">Phone *</label><input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Reports To (RM)</label>
              <select className="input" value={form.report_to_id} onChange={e => setForm(f => ({ ...f, report_to_id: e.target.value }))}>
                <option value="">— None —</option>
                {rms.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
              </select>
            </div>
            <div><label className="label">Team Name</label><input className="input" value={form.team_name} onChange={e => setForm(f => ({ ...f, team_name: e.target.value }))} /></div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => { setCreateOpen(false); setEditUser(null); }} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button onClick={handleSaveUser} disabled={createUser.isPending || updateUser.isPending}
            className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
            {(createUser.isPending || updateUser.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
            {editUser ? 'Update' : 'Create'}
          </button>
        </div>
      </Modal>

      {/* User Detail Modal */}
      <Modal open={!!detailUserId} onClose={() => setDetailUserId(null)} title="User Details" size="lg">
        {userDetail.isLoading ? <Skeleton className="h-48" /> : userDetail.data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><span className="text-xs text-slate-500">Name</span><div className="font-medium">{userDetail.data.user.full_name}</div></div>
              <div><span className="text-xs text-slate-500">Role</span><div className="font-medium">{humanize(userDetail.data.user.role)}</div></div>
              <div><span className="text-xs text-slate-500">Email</span><div className="text-sm">{userDetail.data.user.email}</div></div>
              <div><span className="text-xs text-slate-500">Phone</span><div className="text-sm">{userDetail.data.user.phone}</div></div>
              <div><span className="text-xs text-slate-500">Team</span><div className="text-sm">{userDetail.data.user.team_name || '—'}</div></div>
              <div><span className="text-xs text-slate-500">Status</span><div className="text-sm">{userDetail.data.user.status}</div></div>
            </div>
            <div className="border-t pt-3">
              <div className="text-xs font-medium text-slate-500 uppercase mb-2">Lead Stats</div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-slate-50 p-2 text-center"><div className="text-lg font-bold">{userDetail.data.lead_stats?.total_leads ?? 0}</div><div className="text-[10px] text-slate-500">Total</div></div>
                <div className="rounded-lg bg-amber-50 p-2 text-center"><div className="text-lg font-bold text-amber-700">{userDetail.data.lead_stats?.pending ?? 0}</div><div className="text-[10px] text-slate-500">Pending</div></div>
                <div className="rounded-lg bg-emerald-50 p-2 text-center"><div className="text-lg font-bold text-emerald-700">{userDetail.data.lead_stats?.conversions ?? 0}</div><div className="text-[10px] text-slate-500">Converted</div></div>
              </div>
            </div>
            {userDetail.data.reportees?.length > 0 && (
              <div className="border-t pt-3">
                <div className="text-xs font-medium text-slate-500 uppercase mb-2">Reportees ({userDetail.data.reportees.length})</div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {userDetail.data.reportees.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                      <div><div className="text-sm font-medium">{r.full_name}</div><div className="text-xs text-slate-500">{r.email}</div></div>
                      <span className={clsx('text-[10px] rounded-full px-2 py-0.5 font-medium', r.status === 'blocked' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700')}>{r.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : <div className="py-8 text-center text-sm text-slate-500">User not found</div>}
      </Modal>

      {/* Settings Modal */}
      <Modal open={!!settingsUser} onClose={() => setSettingsUser(null)} title={`Settings — ${settingsUser?.full_name}`} size="sm">
        <div className="space-y-3">
          <div><label className="label">Daily Lead Cap</label><input className="input" type="number" value={settings.daily_lead_cap} onChange={e => setSettings(s => ({ ...s, daily_lead_cap: e.target.value }))} /></div>
          <div><label className="label">Distribution Weight</label><input className="input" type="number" value={settings.distribution_weight} onChange={e => setSettings(s => ({ ...s, distribution_weight: e.target.value }))} /></div>
          <div><label className="label">Team Name</label><input className="input" value={settings.team_name} onChange={e => setSettings(s => ({ ...s, team_name: e.target.value }))} /></div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setSettingsUser(null)} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button disabled={updateSettings.isPending} onClick={() => {
            updateSettings.mutate({
              userId: settingsUser!.id,
              ...(settings.daily_lead_cap ? { daily_lead_cap: Number(settings.daily_lead_cap) } : {}),
              ...(settings.distribution_weight ? { distribution_weight: Number(settings.distribution_weight) } : {}),
              ...(settings.team_name ? { team_name: settings.team_name } : {}),
            }, { onSuccess: () => { toast.success('Settings saved'); setSettingsUser(null); }, onError: () => toast.error('Failed') });
          }} className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
            {updateSettings.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
        </div>
      </Modal>

      {/* Reset Password Modal */}
      <Modal open={!!resetPwdUser} onClose={() => { setResetPwdUser(null); setNewPwd(''); }} title={`Reset Password — ${resetPwdUser?.full_name}`} size="sm">
        <div><label className="label">New Password *</label><input className="input" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="Min 6 characters" /></div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => { setResetPwdUser(null); setNewPwd(''); }} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button disabled={resetPassword.isPending || newPwd.length < 6} onClick={() => {
            resetPassword.mutate({ userId: resetPwdUser!.id, new_password: newPwd }, {
              onSuccess: () => { toast.success('Password reset'); setResetPwdUser(null); setNewPwd(''); },
              onError: () => toast.error('Failed'),
            });
          }} className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
            {resetPassword.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Reset
          </button>
        </div>
      </Modal>
    </div>
  );
}

function CountCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center">
      <div className={clsx('text-xl font-bold tabular-nums', color)}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
