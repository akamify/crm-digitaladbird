'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Users, ArrowLeft, Search, Plus, Loader2, UserRound, RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Modal, Skeleton, EmptyState } from '@/components/ui/Modal';
import { useUsers, useCreateUser, useUpdateUser, useBulkUpdateLeadAvailability } from '@/hooks/useUsers';
import { useUpdateUserSettings, useAdminUserDetail } from '@/hooks/useAdminEnterprise';
import { fmtDate, clsx, humanize } from '@/lib/format';
import type { Role, User } from '@/types';
import { formatPhone, formatUserStatus, getUserStatusBadgeVariant, validateEmail, validatePhone } from '@/lib/uiData';

export default function UsersManagerPage() {
  return (
    <AppShell title="User Management" subtitle="Manage all RMs, members, and partners" roles={['super_admin', 'admin']}>
      <UsersInner />
    </AppShell>
  );
}

function UsersInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: users, isLoading, isFetching, isError, refetch } = useUsers();
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [roleFilter, setRoleFilter] = useState<string>(() => searchParams.get('role') || 'all');
  const [statusFilter, setStatusFilter] = useState<string>(() => searchParams.get('status') || 'all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkConfirm, setBulkConfirm] = useState<{ isAvailable: boolean } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [settingsUser, setSettingsUser] = useState<User | null>(null);
  const [settings, setSettings] = useState({ daily_lead_cap: '', distribution_weight: '', team_name: '' });
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', role: 'member' as Role, team_name: '', report_to_id: '', sendWelcomeEmail: true });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const bulkAvailability = useBulkUpdateLeadAvailability();
  const updateSettings = useUpdateUserSettings();
  const userDetail = useAdminUserDetail(detailUserId);

  const rms = (users || []).filter(u => u.role === 'rm');
  const selectedRm = rms.find(r => r.id === form.report_to_id);

  const filtered = (users || [])
    .filter(u => roleFilter === 'all' || u.role === roleFilter)
    .filter(u => statusFilter === 'all' || effectiveStatus(u) === statusFilter)
    .filter(u => !search || u.full_name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase()) || u.phone?.includes(search));

  const usersById = useMemo(() => new Map((users || []).map(user => [user.id, user])), [users]);
  const selectedUsers = selectedIds.map(id => usersById.get(id)).filter(Boolean) as User[];
  const selectedRoleBucket = selectedUsers[0] ? selectionRoleBucket(selectedUsers[0]) : null;
  const selectedAvailable = selectedUsers.length ? isLeadAvailable(selectedUsers[0]) : null;
  const selectedIsRm = selectedRoleBucket === 'rm';
  const canMarkAvailable = selectedUsers.length > 0 && selectedAvailable === false;
  const canMarkUnavailable = selectedUsers.length > 0 && selectedAvailable === true;

  const counts = {
    total: users?.length ?? 0,
    admin: users?.filter(u => u.role === 'super_admin').length ?? 0,
    rm: users?.filter(u => u.role === 'rm').length ?? 0,
    member: users?.filter(u => u.role === 'member').length ?? 0,
    blocked: users?.filter(u => u.status === 'blocked').length ?? 0,
  };

  useEffect(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (roleFilter !== 'all') params.set('role', roleFilter);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    const next = params.toString();
    const current = searchParams.toString();
    if (next !== current) {
      router.replace(`/dashboard/admin/users${next ? `?${next}` : ''}`, { scroll: false });
    }
  }, [roleFilter, router, search, searchParams, statusFilter]);

  function clearFilters() {
    setSearch('');
    setRoleFilter('all');
    setStatusFilter('all');
  }

  function toggleSelection(user: User, checked: boolean) {
    if (!checked) {
      setSelectedIds(ids => ids.filter(id => id !== user.id));
      return;
    }
    if (!isBulkSelectable(user)) {
      toast.error('Only RM and member rows can be selected.');
      return;
    }
    const bucket = selectionRoleBucket(user);
    const availability = isLeadAvailable(user);
    if (selectedUsers.length > 0 && selectedRoleBucket !== bucket) {
      toast.error('Select either RM users or members, not both.');
      return;
    }
    if (selectedUsers.length > 0 && selectedAvailable !== availability) {
      toast.error('Available and unavailable users cannot be selected together.');
      return;
    }
    setSelectedIds(ids => ids.includes(user.id) ? ids : [...ids, user.id]);
  }

  function toggleCurrentPage(checked: boolean) {
    if (!checked) {
      setSelectedIds(ids => ids.filter(id => !filtered.some(user => user.id === id)));
      return;
    }
    const selectable = filtered.filter(isBulkSelectable);
    if (!selectable.length) return;
    const bucket = selectionRoleBucket(selectable[0]);
    const availability = isLeadAvailable(selectable[0]);
    const valid = selectable.filter(user => selectionRoleBucket(user) === bucket && isLeadAvailable(user) === availability);
    if (valid.length !== selectable.length) {
      toast.error('Current page has mixed roles or availability. Select rows manually.');
      return;
    }
    setSelectedIds(ids => [...new Set([...ids, ...valid.map(user => user.id)])]);
  }

  function submitBulkAvailability() {
    if (!bulkConfirm) return;
    bulkAvailability.mutate({ userIds: selectedIds, isAvailable: bulkConfirm.isAvailable }, {
      onSuccess: () => {
        toast.success(`Marked ${selectedIds.length} user${selectedIds.length === 1 ? '' : 's'} ${bulkConfirm.isAvailable ? 'available' : 'unavailable'}`);
        setSelectedIds([]);
        setBulkConfirm(null);
        refetch();
      },
      onError: (e: any) => {
        toast.error(e?.response?.data?.error?.message || e?.response?.data?.message || 'Could not update availability');
      },
    });
  }

  function openCreate() {
    setForm({ full_name: '', email: '', phone: '', role: 'member', team_name: '', report_to_id: '', sendWelcomeEmail: true });
    setCreateOpen(true);
    setFormErrors({});
  }

  function handleSaveUser() {
    const nextErrors: Record<string, string> = {};
    if (!form.full_name.trim()) nextErrors.full_name = 'Name is required.';
    if (!validateEmail(form.email)) nextErrors.email = 'Enter a valid email address.';
    if (!validatePhone(form.phone)) nextErrors.phone = 'Enter a valid Indian mobile number.';
    if (form.role === 'rm' && !form.team_name.trim()) nextErrors.team_name = 'Team name is required for RM.';
    if (form.role === 'member' && !form.report_to_id) nextErrors.report_to_id = 'Reporting RM is required.';
    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const body = {
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      role: form.role,
      report_to_id: form.role === 'member' ? form.report_to_id : null,
      team_name: form.role === 'rm' ? form.team_name.trim() : null,
      sendWelcomeEmail: form.sendWelcomeEmail,
    };
    if (editUser) {
      updateUser.mutate({ id: editUser.id, ...body }, {
        onSuccess: () => { toast.success('User updated'); setEditUser(null); },
        onError: (e: any) => toast.error(e?.response?.data?.error?.message || 'Failed'),
      });
    } else {
      createUser.mutate(body, {
        onSuccess: (created) => { toast.success('User created'); if (created.emailWarning) toast.error(created.emailWarning); setCreateOpen(false); },
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
        </select>
        <select className="input w-32" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="blocked">Blocked</option>
          <option value="unavailable">Unavailable</option>
          <option value="disabled">Disabled</option>
          <option value="inactive">Inactive</option>
          <option value="unknown">Unknown</option>
        </select>
        <button onClick={clearFilters} className="btn-outline rounded-lg px-3 py-2 text-sm">Clear Filters</button>
        <button onClick={() => refetch()} disabled={isFetching} className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm"><RefreshCw className={clsx('h-4 w-4', isFetching && 'animate-spin')} />Refresh</button>
        <button onClick={openCreate} className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add User
        </button>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
          <div className="font-medium text-blue-950">{selectedIds.length} selected</div>
          <div className="text-blue-700">
            {selectedRoleBucket === 'rm' ? 'RM selection' : 'Member selection'} · currently {selectedAvailable ? 'available' : 'unavailable'}
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              disabled={!canMarkAvailable}
              onClick={() => setBulkConfirm({ isAvailable: true })}
              className="btn-outline rounded-lg px-3 py-2 text-xs disabled:opacity-50"
            >
              Mark Available
            </button>
            <button
              disabled={!canMarkUnavailable}
              onClick={() => setBulkConfirm({ isAvailable: false })}
              className="btn-outline rounded-lg px-3 py-2 text-xs disabled:opacity-50"
            >
              Mark Unavailable
            </button>
            <button onClick={() => setSelectedIds([])} className="btn-ghost rounded-lg px-3 py-2 text-xs">Clear Selection</button>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? <Skeleton className="h-64" /> : isError ? <EmptyState title="Could not load users" description="Please retry without reloading the page." action={<button className="btn-outline rounded-lg px-3 py-2 text-sm" onClick={() => refetch()}>Retry</button>} /> : filtered.length === 0 ? (
        <EmptyState title="No users found" description="Adjust filters or add a new user." icon={<Users className="h-6 w-6" />} />
      ) : (
        <div className="card-padded">
          <div className="grid gap-3 md:hidden">{filtered.map(user => <UserMobileCard key={user.id} user={user} onOpen={() => router.push(`/dashboard/admin/users/${user.id}`)} />)}</div>
          <div className="hidden overflow-x-auto md:block"><table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="w-10 py-2 pr-3 font-medium">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.filter(isBulkSelectable).every(user => selectedIds.includes(user.id))}
                    onChange={event => toggleCurrentPage(event.target.checked)}
                    aria-label="Select current page"
                  />
                </th>
                <th className="py-2 pr-3 font-medium">User</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 pr-3 font-medium">CP ID</th>
                <th className="py-2 pr-3 font-medium">Team</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Lead Cap</th>
                <th className="py-2 pr-3 font-medium">Joined</th>
                <th className="py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(u => (
                <tr key={u.id} className="hover:bg-slate-50 transition cursor-pointer" onClick={() => router.push(`/dashboard/admin/users/${u.id}`)}>
                  <td className="py-3 pr-3" onClick={event => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      disabled={!isBulkSelectable(u)}
                      checked={selectedIds.includes(u.id)}
                      onChange={event => toggleSelection(u, event.target.checked)}
                      aria-label={`Select ${u.full_name}`}
                      title={!isBulkSelectable(u) ? 'Only RM and member rows can be selected' : undefined}
                    />
                  </td>
                  <td className="py-3 pr-3">
                    <Link href={`/dashboard/admin/users/${u.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {u.full_name}
                    </Link>
                    <div className="text-xs text-slate-500">{u.email} · {u.phone}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <span className={clsx('chip', u.role === 'super_admin' ? 'chip-violet' : u.role === 'rm' ? 'chip-blue' : 'chip-slate')}>
                      {humanize(u.role)}
                    </span>
                  </td>
                  <td className="py-3 pr-3 font-mono text-xs text-slate-600">{u.cp_id || 'â€”'}</td>
                  <td className="py-3 pr-3 text-slate-600">{u.team_name || '—'}</td>
                  <td className="py-3 pr-3">
                    <span className={getUserStatusBadgeVariant(effectiveStatus(u))}>{formatUserStatus(effectiveStatus(u))}</span>
                  </td>
                  <td className="py-3 pr-3 text-slate-600 tabular-nums">{u.daily_lead_cap ?? '—'}</td>
                  <td className="py-3 pr-3 text-xs text-slate-500">{fmtDate(u.created_at, 'dd MMM yyyy')}</td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                 
                      <Link onClick={(e) => e.stopPropagation()} href={`/dashboard/admin/users/${u.id}`} className="btn-outline inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs" title="Profile">
                        <UserRound className="h-3.5 w-3.5" /> Profile
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal open={createOpen || !!editUser} onClose={() => { setCreateOpen(false); setEditUser(null); }}
        title={editUser ? `Edit ${editUser.full_name}` : 'Add New User'} size="md">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Full Name *</label><input className={formErrors.full_name ? 'input border-red-500' : 'input'} value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />{formErrors.full_name && <p className="mt-1 text-xs text-red-500">{formErrors.full_name}</p>}</div>
            <div><label className="label">Role *</label>
              <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))}>
                <option value="member">Member</option><option value="rm">RM</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Email *</label><input className={formErrors.email ? 'input border-red-500' : 'input'} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />{formErrors.email && <p className="mt-1 text-xs text-red-500">{formErrors.email}</p>}</div>
            <div><label className="label">Phone *</label><input className={formErrors.phone ? 'input border-red-500' : 'input'} type="tel" inputMode="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/[^+\d\s()-]/g, '') }))} />{formErrors.phone && <p className="mt-1 text-xs text-red-500">{formErrors.phone}</p>}</div>
          </div>
          {editUser && <div><label className="label">CP ID</label><input className="input font-mono uppercase" value={editUser.cp_id || 'System generated'} disabled /></div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Reporting RM {form.role === 'member' ? '*' : ''}</label>
              <select className="input" value={form.report_to_id} disabled={form.role !== 'member'} onChange={e => setForm(f => ({ ...f, report_to_id: e.target.value }))}>
                <option value="">— None —</option>
                {rms.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
              </select>
            </div>
            <div><label className="label">Team Name {form.role === 'rm' ? '*' : ''}</label><input className="input" value={form.role === 'member' ? (selectedRm?.team_name || 'Derived from RM') : form.team_name} disabled={form.role === 'member'} onChange={e => setForm(f => ({ ...f, team_name: e.target.value }))} /></div>
          </div>
          {!editUser && <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.sendWelcomeEmail} onChange={e => setForm(f => ({ ...f, sendWelcomeEmail: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />Send onboarding email with password setup link</label>}
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

      <Modal open={!!bulkConfirm} onClose={() => setBulkConfirm(null)} title={bulkConfirm?.isAvailable ? 'Mark users available?' : 'Mark users unavailable?'} size="sm">
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            {selectedIsRm
              ? 'This will update the selected RM users and every member under their teams.'
              : 'This will update only the selected members.'}
          </p>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            {bulkConfirm?.isAvailable
              ? 'Selected users will become eligible for future lead distribution if their account status is active.'
              : 'Selected users will stop receiving new leads during distribution.'}
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setBulkConfirm(null)} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button onClick={submitBulkAvailability} disabled={bulkAvailability.isPending} className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
            {bulkAvailability.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirm
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
          <div><label className="label">Team Name</label><input className="input" value={settingsUser?.role === 'member' ? (settingsUser.team_name || 'Derived from RM') : settings.team_name} disabled={settingsUser?.role === 'member'} onChange={e => setSettings(s => ({ ...s, team_name: e.target.value }))} /></div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setSettingsUser(null)} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button disabled={updateSettings.isPending} onClick={() => {
            updateSettings.mutate({
              userId: settingsUser!.id,
              ...(settings.daily_lead_cap ? { daily_lead_cap: Number(settings.daily_lead_cap) } : {}),
              ...(settings.distribution_weight ? { distribution_weight: Number(settings.distribution_weight) } : {}),
              ...(settingsUser?.role === 'rm' && settings.team_name ? { team_name: settings.team_name } : {}),
            }, { onSuccess: () => { toast.success('Settings saved'); setSettingsUser(null); }, onError: () => toast.error('Failed') });
          }} className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
            {updateSettings.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
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

function effectiveStatus(user: User): string {
  if (user.status && user.status !== 'active') return user.status;
  if (user.lead_assignment_status && user.lead_assignment_status !== 'available') return user.lead_assignment_status;
  return user.status || user.lead_assignment_status || 'unknown';
}

function isLeadAvailable(user: User): boolean {
  if (user.status && user.status !== 'active') return false;
  if (['unavailable', 'blocked', 'disabled'].includes(String(user.lead_assignment_status || '').toLowerCase())) return false;
  return user.is_available !== false;
}

function selectionRoleBucket(user: User): 'rm' | 'member' {
  return user.role === 'rm' ? 'rm' : 'member';
}

function isBulkSelectable(user: User): boolean {
  return user.role === 'rm' || user.role === 'member';
}

function UserMobileCard({ user, onOpen }: { user: User; onOpen: () => void }) {
  return <button onClick={onOpen} className="rounded-lg border border-slate-200 p-4 text-left"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate font-medium text-slate-950">{user.full_name}</div><div className="mt-1 break-all text-xs text-slate-500">{user.email}</div><div className="mt-0.5 text-xs text-slate-500">{formatPhone(user.phone)}</div></div><span className={getUserStatusBadgeVariant(effectiveStatus(user))}>{formatUserStatus(effectiveStatus(user))}</span></div><div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500"><span className="chip-slate">{humanize(user.role)}</span><span className={isLeadAvailable(user) ? 'chip-green' : 'chip-amber'}>{isLeadAvailable(user) ? 'Available' : 'Unavailable'}</span>{user.team_name && <span>{user.team_name}</span>}</div></button>;
}
