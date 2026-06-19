'use client';
import { useState, useMemo } from 'react';
import { UserPlus, Pencil, Trash2, Users as UsersIcon, Power } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton, EmptyState } from '@/components/ui/Modal';
import { UserFormModal } from '@/components/users/UserFormModal';
import { UserEmailActions } from '@/components/users/UserEmailActions';
import { useUsers, useUpdateUser, useDeleteUser } from '@/hooks/useUsers';
import { useAuth } from '@/lib/auth';
import { fmtRelative, fmtDate, humanize, initials, clsx } from '@/lib/format';
import type { User } from '@/types';

export default function UsersPage() {
  return (
    <AppShell title="Team" subtitle="Manage members, RMs and their reporting hierarchy" roles={['super_admin', 'rm']}>
      <UsersInner />
    </AppShell>
  );
}

function UsersInner() {
  const { user } = useAuth();
  const { data: users, isLoading } = useUsers();
  const update = useUpdateUser();
  const del    = useDeleteUser();

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  const filtered = useMemo(() => {
    const list = users ?? [];
    if (!q.trim()) return list;
    const needle = q.toLowerCase();
    return list.filter(u =>
      u.full_name.toLowerCase().includes(needle) ||
      u.email.toLowerCase().includes(needle) ||
      (u.phone ?? '').includes(needle) ||
      (u.cp_id ?? '').toLowerCase().includes(needle) ||
      (u.team_name ?? '').toLowerCase().includes(needle),
    );
  }, [users, q]);

  const rms = useMemo(() => (users ?? []).filter(u => u.role === 'rm' || u.role === 'super_admin'), [users]);
  const canManage = user?.role === 'super_admin';
  const canEmailTeam = user?.role === 'rm';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[14rem]">
          <Input placeholder="Search by name, email, phone, team…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {canManage && (
          <Button leftIcon={<UserPlus className="h-4 w-4" />} onClick={() => { setEditing(null); setOpen(true); }}>
            Add member
          </Button>
        )}
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No team members yet"
            description="Add your first member or RM to start distributing leads."
            icon={<UsersIcon className="h-6 w-6" />}
            action={canManage ? <Button onClick={() => setOpen(true)} leftIcon={<UserPlus className="h-4 w-4" />}>Add member</Button> : null}
          />
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Member</th>
                  <th className="px-4 py-2.5 font-medium">Role / team</th>
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <th className="px-4 py-2.5 font-medium text-right">Cap</th>
                  <th className="px-4 py-2.5 font-medium text-right">Weight</th>
                  <th className="px-4 py-2.5 font-medium">Joined</th>
                  {(canManage || canEmailTeam) && <th className="px-4 py-2.5 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id} className="table-row">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className={clsx(
                          'grid h-9 w-9 place-items-center rounded-full text-xs font-semibold',
                          u.role === 'super_admin' && 'bg-brand-100 text-brand-700',
                          u.role === 'rm'    && 'bg-sky-100 text-sky-700',
                          u.role === 'member' && 'bg-slate-100 text-slate-700',
                        )}>{initials(u.full_name)}</span>
                        <div>
                          <div className="font-medium text-slate-900">{u.full_name}</div>
                          <div className="text-xs text-slate-500">{u.email}</div>
                          <div className="font-mono text-[11px] text-slate-400">{u.cp_id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="capitalize text-slate-800">{humanize(u.role)}</div>
                      <div className="text-xs text-slate-500">{u.team_name || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 tabular-nums">{u.phone}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{u.daily_lead_cap ?? '∞'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{u.distribution_weight ?? 1}</td>
                    <td className="px-4 py-3 text-xs text-slate-500" title={fmtDate(u.created_at)}>{fmtRelative(u.created_at)}</td>
                    {(canManage || canEmailTeam) && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {(canManage || u.report_to_id === user?.id) && <UserEmailActions userId={u.id} />}
                          {canManage && <>
                          <button
                            onClick={() => update.mutate({ id: u.id, is_available: !u.is_available }, {
                              onSuccess: () => toast.success(`Marked ${!u.is_available ? 'available' : 'unavailable'}`),
                              onError:   () => toast.error('Update failed'),
                            })}
                            className={clsx(
                              'inline-flex h-8 w-8 items-center justify-center rounded-md transition',
                              u.is_available ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100',
                            )}
                            title={u.is_available ? 'Available for leads' : 'Unavailable'}
                          >
                            <Power className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => { setEditing(u); setOpen(true); }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (!confirm(`Deactivate ${u.full_name}? Their account will no longer receive leads.`)) return;
                              del.mutate(u.id, {
                                onSuccess: () => toast.success('User deactivated'),
                                onError:   () => toast.error('Could not deactivate'),
                              });
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-rose-500 hover:bg-rose-50"
                            title="Deactivate"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          </>}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canManage && (
        <UserFormModal open={open} onClose={() => setOpen(false)} initial={editing} rms={rms} />
      )}
    </div>
  );
}
