'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, ArrowLeft, Trash2, UserX } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { EmptyState, Modal, Skeleton } from '@/components/ui/Modal';
import { useBulkDeleteUsers, useDeletedUsers, useDeleteUser } from '@/hooks/useUsers';
import { fmtDate, humanize } from '@/lib/format';
import type { User } from '@/types';

export default function DeletedUsersPage() {
  const deleted = useDeletedUsers();
  const deleteUser = useDeleteUser();
  const bulkDeleteUsers = useBulkDeleteUsers();
  const [target, setTarget] = useState<User | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const rows = deleted.data || [];
  const selectableRows = rows.filter(user => user.role === 'rm' || user.role === 'member');
  const allSelected = selectableRows.length > 0 && selectableRows.every(user => selectedIds.includes(user.id));

  function toggleUser(id: string, checked: boolean) {
    setSelectedIds(ids => checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id));
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? selectableRows.map(user => user.id) : []);
  }

  async function confirmBulkDelete() {
    if (!selectedIds.length) return;
    try {
      const result = await bulkDeleteUsers.mutateAsync({
        userIds: selectedIds,
        reason: 'Bulk permanent cleanup from deleted users page',
      });
      toast.success(`${result.deleted_count} deleted user${result.deleted_count === 1 ? '' : 's'} permanently removed.`);
      setSelectedIds([]);
      setBulkDeleteOpen(false);
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Could not permanently delete selected users');
    }
  }

  return (
    <AppShell title="Deleted Users" subtitle="Previously soft-deleted profiles retained until permanent cleanup" roles={['super_admin', 'admin']}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/dashboard/admin/users" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800">
            <ArrowLeft className="h-4 w-4" /> Back to users
          </Link>
          <Link href="/users/deleted" className="btn-outline rounded-lg px-3 py-1.5 text-xs">
            Open `/users/deleted`
          </Link>
        </div>
        {deleted.isLoading ? (
          <Skeleton className="h-64" />
        ) : !deleted.data?.length ? (
          <EmptyState title="No deleted users" description="Disabled profiles will appear here for read-only audit review." icon={<UserX className="h-6 w-6" />} />
        ) : (
          <div className="space-y-3">
            {selectedIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm">
                <div className="font-medium text-rose-950">{selectedIds.length} deleted user{selectedIds.length === 1 ? '' : 's'} selected</div>
                <div className="text-rose-700">Only RM and member rows can be permanently deleted in bulk.</div>
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button variant="danger" size="sm" onClick={() => setBulkDeleteOpen(true)}>
                    Delete All Selected
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                    Clear
                  </Button>
                </div>
              </div>
            )}
            <div className="card-padded overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 font-medium">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(event) => toggleAll(event.target.checked)}
                      aria-label="Select all deleted users"
                    />
                  </th>
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
                      {user.role === 'rm' || user.role === 'member' ? (
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(user.id)}
                          onChange={(event) => toggleUser(user.id, event.target.checked)}
                          aria-label={`Select ${user.full_name}`}
                        />
                      ) : (
                        <span className="text-xs text-slate-300">-</span>
                      )}
                    </td>
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
      <Modal
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title="Delete Selected Users Permanently"
        description="This will remove all selected deleted RM/member users from the database."
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setBulkDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              size="sm"
              loading={bulkDeleteUsers.isPending}
              onClick={confirmBulkDelete}
            >
              I am sure, delete all
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-2">
              <div className="font-semibold">{selectedIds.length} selected deleted user{selectedIds.length === 1 ? '' : 's'}</div>
              <div>Select-all works on the current deleted-users list and will permanently remove all selected RM/member records.</div>
              <div>The same email and phone can be reused after this cleanup.</div>
            </div>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
