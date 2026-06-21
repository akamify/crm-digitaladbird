'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bell, CheckCheck, ChevronRight } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { NotificationDetailModal } from '@/components/notifications/NotificationDetailModal';
import { EmptyState, Skeleton } from '@/components/ui/Modal';
import { useInfiniteNotifications, useMarkAllRead, useMarkRead, type UserNotification } from '@/hooks/useNotifications';
import { formatISTCompact, formatISTTooltip } from '@/lib/date';
import { clsx, humanize } from '@/lib/format';

function notificationTarget(n: UserNotification) {
  const leadId = typeof n.metadata?.lead_id === 'string' ? n.metadata.lead_id : null;
  if (leadId) return `/leads/${leadId}`;
  if (Array.isArray(n.metadata?.lead_ids) && n.metadata.lead_ids.length > 0) return '/leads';
  const eventType = String(n.metadata?.event_type || n.type || '');
  if (eventType.includes('partner_request')) return '/partner-requests';
  if (eventType.includes('lead_request') || eventType.includes('rm_lead_request') || eventType.includes('request_')) return '/partner-requests';
  if (eventType.includes('reassigned') || eventType.includes('assigned')) return '/leads';
  return null;
}

export function NotificationsCenter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<UserNotification | null>(null);
  const notificationId = searchParams.get('notificationId');

  const notifications = useInfiniteNotifications(20);
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const items = useMemo(
    () => notifications.data?.pages.flatMap(page => page.notifications || []) ?? [],
    [notifications.data],
  );
  const unreadCount = notifications.data?.pages[0]?.unread ?? 0;

  useEffect(() => {
    if (!notificationId || items.length === 0) return;
    const current = items.find(item => item.id === notificationId);
    if (!current) return;
    setSelected(current);
    if (!current.is_read) {
      markRead.mutate(current.id);
    }
  }, [items, markRead, notificationId]);

  function closeModal() {
    setSelected(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('notificationId');
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ''}`);
  }

  function handleOpen(notification: UserNotification) {
    setSelected(notification);
    if (!notification.is_read) {
      markRead.mutate(notification.id);
    }
    router.replace(`${pathname}?notificationId=${notification.id}`);
  }

  function handleMarkAllRead() {
    markAllRead.mutate(undefined, {
      onSuccess: () => toast.success('All notifications marked as read.'),
      onError: (error: unknown) =>
        toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not mark all as read.'),
    });
  }

  return (
    <>
      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Notifications</h2>
            <p className="mt-1 text-sm text-slate-500">Recent 20 notifications are shown first. Load more to view older entries.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              {unreadCount} unread
            </span>
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={markAllRead.isPending || unreadCount === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCheck className="h-4 w-4" />
              Mark all read
            </button>
          </div>
        </div>

        {notifications.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-20" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No notifications yet"
              description="Lead assignments, request approvals, and workflow updates will appear here."
              icon={<Bell className="h-6 w-6" />}
            />
          </div>
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {items.map((notification) => {
                const target = notificationTarget(notification);
                return (
                  <div
                    key={notification.id}
                    className={clsx(
                      'flex flex-col gap-3 px-4 py-4 transition sm:flex-row sm:items-start sm:justify-between',
                      notification.is_read ? 'bg-white hover:bg-slate-50' : 'bg-blue-50/50 hover:bg-blue-50',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleOpen(notification)}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    >
                      <div className={clsx(
                        'mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full',
                        notification.is_read ? 'bg-slate-300' : 'bg-brand-600',
                      )} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className={clsx('truncate text-sm', notification.is_read ? 'font-medium text-slate-800' : 'font-semibold text-slate-900')}>
                              {notification.title}
                            </div>
                            <div className="mt-1 line-clamp-2 text-sm text-slate-500">
                              {notification.body || 'No additional message available.'}
                            </div>
                          </div>
                          <div className="shrink-0 text-xs text-slate-400" title={formatISTTooltip(notification.created_at)}>
                            {formatISTCompact(notification.created_at)}
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                            {humanize(notification.type)}
                          </span>
                          {target && (
                            <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700">
                              Opens related record
                            </span>
                          )}
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-2 sm:pl-3">
                      {!notification.is_read && (
                        <button
                          type="button"
                          onClick={() => markRead.mutate(notification.id)}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Mark read
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleOpen(notification)}
                        className="inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700 hover:bg-brand-100"
                      >
                        Full view
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-4">
              <span className="text-sm text-slate-500">{items.length} notification(s) loaded</span>
              {notifications.hasNextPage ? (
                <button
                  type="button"
                  onClick={() => notifications.fetchNextPage()}
                  disabled={notifications.isFetchingNextPage}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {notifications.isFetchingNextPage ? 'Loading...' : 'Load 20 more'}
                </button>
              ) : (
                <span className="text-xs text-slate-400">No older notifications</span>
              )}
            </div>
          </>
        )}
      </div>

      <NotificationDetailModal
        notification={selected}
        open={!!selected}
        onClose={closeModal}
        targetHref={selected ? notificationTarget(selected) : null}
      />
    </>
  );
}
