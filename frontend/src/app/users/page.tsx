'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UserPlus, Users as UsersIcon, UserRound, Trash2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton, EmptyState, Modal } from '@/components/ui/Modal';
import { UserFormModal } from '@/components/users/UserFormModal';
import { useDeleteUser, useUsers } from '@/hooks/useUsers';
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
  const router = useRouter();
  const { user } = useAuth();
  const { data: users, isLoading } = useUsers();
  const deleteUser = useDeleteUser();

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[14rem]">
          <Input placeholder="Search by name, email, phone, team…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {canManage && (
          <Link href="/users/deleted" className="btn-outline inline-flex items-center rounded-lg px-3 py-2 text-sm">
            Deleted users
          </Link>
        )}
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
                  <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id} className="table-row cursor-pointer" onClick={() => router.push(`/dashboard/admin/users/${u.id}`)}>
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
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link onClick={(e) => e.stopPropagation()} href={`/dashboard/admin/users/${u.id}`} className="btn-outline inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs">
                          <UserRound className="h-3.5 w-3.5" /> Profile
                        </Link>
                        {canManage && u.id !== user?.id && ['rm', 'member'].includes(u.role) && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(u);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
                            title={u.role === 'rm' ? 'Delete RM and team' : 'Delete user'}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
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

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget?.role === 'rm' ? 'Delete RM Team' : 'Delete User'}
        description={deleteTarget?.role === 'rm'
          ? 'Deleting this RM will also permanently delete all members reporting to this RM.'
          : 'This user will be permanently deleted from the CRM.'}
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              size="sm"
              loading={deleteUser.isPending}
              className="bg-rose-600 hover:bg-rose-700"
              onClick={() => {
                if (!deleteTarget) return;
                deleteUser.mutate(
                  {
                    id: deleteTarget.id,
                    reason: deleteTarget.role === 'rm'
                      ? 'RM and reporting team deleted by super admin'
                      : 'User deleted by super admin',
                  },
                  {
                    onSuccess: () => {
                      toast.success(deleteTarget.role === 'rm' ? 'RM and team permanently deleted' : 'User permanently deleted');
                      setDeleteTarget(null);
                    },
                    onError: (error: any) => {
                      toast.error(error?.response?.data?.error?.message || 'Could not delete user');
                    },
                  },
                );
              }}
            >
              I am sure, delete
            </Button>
          </>
        }
      >
        {deleteTarget && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="space-y-2">
                <div className="font-semibold">{deleteTarget.full_name}</div>
                <div>
                  {deleteTarget.role === 'rm'
                    ? 'If you continue, this RM and all team members under this RM will be permanently deleted.'
                    : 'If you continue, this user will be permanently deleted.'}
                </div>
                <div>This is a hard delete. The same email and phone can be reused after deletion.</div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
