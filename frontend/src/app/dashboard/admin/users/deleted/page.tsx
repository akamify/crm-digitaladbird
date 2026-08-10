'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, ArrowLeft, Trash2, UserX } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { EmptyState, Modal, Skeleton } from '@/components/ui/Modal';
import { useDeletedUsers, useDeleteUser } from '@/hooks/useUsers';
import { fmtDate, humanize } from '@/lib/format';
import type { User } from '@/types';

export default function DeletedUsersPage() {
  const deleted = useDeletedUsers();
  const deleteUser = useDeleteUser();
  const [target, setTarget] = useState<User | null>(null);

  return (
    <AppShell title="Deleted Users" subtitle="Previously soft-deleted profiles retained until permanent cleanup" roles={['super_admin', 'admin']}>
      <div className="space-y-4">
        <Link href="/dashboard/admin/users" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Back to users
        </Link>
        {deleted.isLoading ? (
          <Skeleton className="h-64" />
        ) : !deleted.data?.length ? (
          <EmptyState title="No deleted users" description="Disabled profiles will appear here for read-only audit review." icon={<UserX className="h-6 w-6" />} />
        ) : (
          <div className="card-padded overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 font-medium">User</th>
                  <th className="py-2 pr-3 font-medium">Role</th>
                  <th className="py-2 pr-3 font-medium">CP ID</th>
                  <th className="py-2 pr-3 font-medium">Former team/RM</th>
                  <th className="py-2 pr-3 font-medium">Deleted at</th>
                  <th className="py-2 pr-3 font-medium">Reason</th>
                  <th className="py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {deleted.data.map(user => (
                  <tr key={user.id}>
                    <td className="py-3 pr-3">
                      <div className="font-medium text-slate-900">{user.full_name}</div>
                      <div className="text-xs text-slate-500">{user.email} - {user.phone}</div>
                    </td>
                    <td className="py-3 pr-3">{humanize(user.role)}</td>
                    <td className="py-3 pr-3 font-mono text-xs">{user.cp_id}</td>
                    <td className="py-3 pr-3">{user.team_name || user.manager_name || '-'}</td>
                    <td className="py-3 pr-3">{fmtDate(user.deleted_at || '')}</td>
                    <td className="py-3 pr-3 text-slate-600">{user.delete_reason || '-'}</td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/dashboard/admin/users/${user.id}`} className="btn-outline rounded-lg px-3 py-1.5 text-xs">View</Link>
                        {(user.role === 'rm' || user.role === 'member') && (
                          <button
                            type="button"
                            onClick={() => setTarget(user)}
                            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Hard Delete
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
      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title="Permanently Delete User"
        description="This will remove the user record from the database."
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setTarget(null)}>Cancel</Button>
            <Button
              variant="danger"
              size="sm"
              loading={deleteUser.isPending}
              onClick={() => {
                if (!target) return;
                deleteUser.mutate(
                  {
                    id: target.id,
                    reason: target.role === 'rm'
                      ? 'Previously soft-deleted RM permanently removed by super admin'
                      : 'Previously soft-deleted member permanently removed by super admin',
                  },
                  {
                    onSuccess: () => {
                      toast.success(target.role === 'rm' ? 'RM permanently deleted' : 'User permanently deleted');
                      setTarget(null);
                    },
                    onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Could not permanently delete user'),
                  },
                );
              }}
            >
              I am sure, hard delete
            </Button>
          </>
        }
      >
        {target && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="space-y-2">
                <div className="font-semibold">{target.full_name}</div>
                <div>This will permanently remove the user record from the CRM database.</div>
                <div>The same email and phone can be reused after this cleanup.</div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
