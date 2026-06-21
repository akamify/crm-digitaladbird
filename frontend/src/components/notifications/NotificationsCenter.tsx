'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bell, CheckCheck, ChevronDown, ChevronUp, ExternalLink, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { EmptyState, Skeleton } from '@/components/ui/Modal';
import { useInfiniteNotifications, useMarkAllRead, useMarkRead, type UserNotification } from '@/hooks/useNotifications';
import { dashboardPath, useAuth } from '@/lib/auth';
import { formatISTCompact, formatISTTooltip } from '@/lib/date';
import { clsx, humanize } from '@/lib/format';

function notificationTarget(n: UserNotification) {
  const metadata = n.metadata || {};
  const link = typeof metadata.link === 'string' ? metadata.link : null;
  if (link && link.startsWith('/')) return link;
  const leadId = typeof metadata.lead_id === 'string' ? metadata.lead_id : null;
  if (leadId) return `/leads/${leadId}`;
  if (Array.isArray(metadata.lead_ids) && metadata.lead_ids.length > 0) return '/leads';
  const eventType = String(metadata.event_type || n.type || '');
  if (eventType.includes('partner_request')) return '/partner-requests';
  if (eventType.includes('lead_request') || eventType.includes('rm_lead_request') || eventType.includes('request_')) return '/partner-requests';
  if (eventType.includes('reassigned') || eventType.includes('assigned')) return '/leads';
  return null;
}

function notificationBody(notification: UserNotification) {
  return notification.body || notification.message || 'No details available.';
}

function shouldShowReadMore(notification: UserNotification) {
  return notificationBody(notification).length > 150 || Object.keys(notification.metadata || {}).length > 0;
}

export function NotificationsCenter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const notificationId = searchParams.get('notificationId');

  const notifications = useInfiniteNotifications(20);
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const items = useMemo(() => {
    const seen = new Set<string>();
    const merged: UserNotification[] = [];
    for (const page of notifications.data?.pages || []) {
      for (const item of page.notifications || []) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          merged.push(item);
        }
      }
    }
    return merged;
  }, [notifications.data]);

  const unreadCount = notifications.data?.pages[0]?.unread ?? 0;
  const total = notifications.data?.pages[0]?.pagination?.total;

  useEffect(() => {
    if (!notificationId || items.length === 0) return;
    const current = items.find(item => item.id === notificationId);
    if (!current) return;
    setExpanded(prev => new Set(prev).add(current.id));
    if (!current.is_read) markRead.mutate(current.id);
  }, [items, markRead, notificationId]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry.isIntersecting && notifications.hasNextPage && !notifications.isFetchingNextPage) {
        notifications.fetchNextPage();
      }
    }, { rootMargin: '240px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [notifications]);

  function goBack() {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push(dashboardPath(user?.role || 'member'));
  }

  function handleOpen(notification: UserNotification) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(notification.id)) next.delete(notification.id);
      else next.add(notification.id);
      return next;
    });
    if (!notification.is_read) markRead.mutate(notification.id);
  }

  function handleMarkAllRead() {
    markAllRead.mutate(undefined, {
      onSuccess: () => toast.success('All notifications marked as read.'),
      onError: (error: unknown) =>
        toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not mark all as read.'),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {unreadCount} unread
          </span>
          {typeof total === 'number' && (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              {total} total
            </span>
          )}
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={markAllRead.isPending || unreadCount === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {markAllRead.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
            Mark all read
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-4">
          <h2 className="text-base font-semibold text-slate-900">Notifications</h2>
          <p className="mt-1 text-sm text-slate-500">Personal notifications for your account. Older items load automatically as you scroll.</p>
        </div>

        {notifications.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-24" />)}
          </div>
        ) : notifications.isError ? (
          <div className="p-6">
            <EmptyState
              title="Could not load notifications"
              description="Please refresh the page or login again if your session expired."
              icon={<Bell className="h-6 w-6" />}
            />
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
          <div className="divide-y divide-slate-100">
            {items.map((notification) => (
              <NotificationCard
                key={notification.id}
                notification={notification}
                expanded={expanded.has(notification.id)}
                targetHref={notificationTarget(notification)}
                onToggle={() => handleOpen(notification)}
                onMarkRead={() => markRead.mutate(notification.id)}
              />
            ))}
          </div>
        )}

        {items.length > 0 && (
          <div className="border-t border-slate-100 px-4 py-4">
            <div ref={sentinelRef} className="flex min-h-10 items-center justify-center text-sm text-slate-500">
              {notifications.isFetchingNextPage ? (
                <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading 20 more...</span>
              ) : notifications.hasNextPage ? (
                'Scroll to load more'
              ) : (
                'You are all caught up'
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationCard({
  notification,
  expanded,
  targetHref,
  onToggle,
  onMarkRead,
}: {
  notification: UserNotification;
  expanded: boolean;
  targetHref: string | null;
  onToggle: () => void;
  onMarkRead: () => void;
}) {
  const body = notificationBody(notification);
  const canReadMore = shouldShowReadMore(notification);

  return (
    <article className={clsx('px-4 py-4 transition', notification.is_read ? 'bg-white' : 'bg-blue-50/50')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <div className={clsx('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', notification.is_read ? 'bg-slate-300' : 'bg-brand-600')} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className={clsx('truncate text-sm', notification.is_read ? 'font-medium text-slate-800' : 'font-semibold text-slate-900')}>
                  {notification.title || 'Notification'}
                </h3>
                <p className={clsx('mt-1 text-sm leading-6 text-slate-600', expanded ? '' : 'line-clamp-2')}>
                  {body}
                </p>
              </div>
              <time className="shrink-0 text-xs text-slate-400" title={formatISTTooltip(notification.created_at)}>
                {formatISTCompact(notification.created_at)}
              </time>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                {humanize(notification.type || 'notification')}
              </span>
              {!notification.is_read && <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-medium text-blue-700">Unread</span>}
            </div>
          </div>
        </button>

        <div className="flex flex-wrap items-center gap-2 sm:pl-3">
          {!notification.is_read && (
            <button type="button" onClick={onMarkRead} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
              Mark read
            </button>
          )}
          {canReadMore && (
            <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700 hover:bg-brand-100">
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
          {targetHref && (
            <Link href={targetHref} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </Link>
          )}
        </div>
      </div>

      {expanded && Object.keys(notification.metadata || {}).length > 0 && (
        <details className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">Details</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {Object.entries(notification.metadata || {}).map(([key, value]) => (
              <div key={key} className="rounded-lg bg-slate-50 px-3 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{humanize(key)}</div>
                <div className="mt-1 break-words text-sm text-slate-700">
                  {typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value)}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}
