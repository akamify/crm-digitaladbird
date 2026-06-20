'use client';
import Link from 'next/link';
import { ArrowLeft, UserX } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, Skeleton } from '@/components/ui/Modal';
import { useDeletedUsers } from '@/hooks/useUsers';
import { fmtDate, humanize } from '@/lib/format';

export default function DeletedUsersPage() {
  const deleted = useDeletedUsers();

  return (
    <AppShell title="Deleted Users" subtitle="Soft-deleted profiles retained for audit history" roles={['super_admin', 'admin']}>
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
                  <th className="py-2 font-medium text-right">Profile</th>
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
                      <Link href={`/dashboard/admin/users/${user.id}`} className="btn-outline rounded-lg px-3 py-1.5 text-xs">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
