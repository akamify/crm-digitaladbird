'use client';
import { useState, useRef, useEffect } from 'react';
import { Bell, Check, CheckCheck, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useNotifications, useMarkRead, useMarkAllRead, type UserNotification } from '@/hooks/useNotifications';
import { useAuth } from '@/lib/auth';
import { fmtRelative } from '@/lib/format';
import { clsx } from '@/lib/format';
import { connectSocket } from '@/lib/socket';

const TYPE_COLORS: Record<string, string> = {
  partner_request: 'bg-violet-100 text-violet-700',
  request_approved: 'bg-emerald-100 text-emerald-700',
  request_rejected: 'bg-rose-100 text-rose-700',
  request_partially_fulfilled: 'bg-amber-100 text-amber-700',
  lead_request: 'bg-indigo-100 text-indigo-700',
  lead_request_created: 'bg-indigo-100 text-indigo-700',
  lead_request_approved: 'bg-emerald-100 text-emerald-700',
  lead_request_partially_approved: 'bg-amber-100 text-amber-700',
  lead_request_rejected: 'bg-rose-100 text-rose-700',
  lead_request_submitted: 'bg-indigo-100 text-indigo-700',
  rm_lead_request: 'bg-cyan-100 text-cyan-700',
  rm_lead_request_created: 'bg-cyan-100 text-cyan-700',
  rm_lead_request_approved: 'bg-emerald-100 text-emerald-700',
  rm_lead_request_rejected: 'bg-rose-100 text-rose-700',
  rm_lead_request_submitted: 'bg-cyan-100 text-cyan-700',
  leads_assigned: 'bg-blue-100 text-blue-700',
  leads_reassigned: 'bg-purple-100 text-purple-700',
  leads_delivered: 'bg-blue-100 text-blue-700',
  bulk_leads_assigned: 'bg-blue-100 text-blue-700',
  auto_leads_distributed: 'bg-sky-100 text-sky-700',
  lead_request_needs_approval: 'bg-amber-100 text-amber-700',
  partner_request_created: 'bg-violet-100 text-violet-700',
  partner_request_approved: 'bg-emerald-100 text-emerald-700',
  partner_request_partially_approved: 'bg-amber-100 text-amber-700',
  partner_request_rejected: 'bg-rose-100 text-rose-700',
  lead_assigned: 'bg-blue-100 text-blue-700',
  rm_assigned: 'bg-sky-100 text-sky-700',
};

function typeLabel(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

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

export function NotificationBell() {
  const router = useRouter();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const { data, isLoading } = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  const unread = data?.unread ?? 0;
  const items = data?.notifications ?? [];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    connectSocket().then((socket) => {
      const handler = (notification?: UserNotification) => {
        qc.invalidateQueries({ queryKey: ['notifications'] });
        if (notification?.title) {
          toast.success(notification.title, { id: `notif-${notification.id || notification.type}`, duration: 4000 });
        }
      };
      socket.on('notification:new', handler);
      cleanup = () => socket.off('notification:new', handler);
    }).catch(() => {});
    return () => { cleanup?.(); };
  }, [qc]);

  const notificationsPage = user?.role === 'super_admin' || user?.role === 'admin'
    ? '/dashboard/admin/notifications'
    : '/notifications';

  function handleNotificationClick(notification: UserNotification) {
    if (!notification.is_read) {
      markRead.mutate(notification.id);
    }
    setOpen(false);
    router.push(`${notificationsPage}?notificationId=${notification.id}`);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
        aria-label="Notifications"
      >
        <Bell className="h-4.5 w-4.5" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-sm">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl z-50">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-slate-500" />
              <span className="text-sm font-semibold text-slate-900">Notifications</span>
              {unread > 0 && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                  {unread} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  onClick={() => markAll.mutate()}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition"
                  title="Mark all read"
                >
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all
                </button>
              )}
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">Loading...</div>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-400">No notifications yet</p>
              </div>
            ) : (
              items.map((n: UserNotification) => {
                const content = (
                  <>
                    <div className="shrink-0 mt-0.5">
                      <div className={clsx(
                        'grid h-8 w-8 place-items-center rounded-full text-xs font-bold',
                        TYPE_COLORS[n.type] || 'bg-slate-100 text-slate-600'
                      )}>
                        {!n.is_read ? (
                          <span className="h-2 w-2 rounded-full bg-blue-500" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className={clsx('text-sm', !n.is_read ? 'font-semibold text-slate-900' : 'font-medium text-slate-700')}>
                          {n.title}
                        </span>
                        <span className="shrink-0 text-[10px] text-slate-400">{fmtRelative(n.created_at)}</span>
                      </div>
                      {n.body && <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{n.body}</p>}
                      <span className={clsx('mt-1 inline-block rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider', TYPE_COLORS[n.type] || 'bg-slate-100 text-slate-500')}>
                        {typeLabel(n.type)}
                      </span>
                    </div>
                  </>
                );
                const className = clsx(
                  'flex gap-3 border-b border-slate-50 px-4 py-3 transition cursor-pointer',
                  !n.is_read ? 'bg-blue-50/50 hover:bg-blue-50' : 'hover:bg-slate-50',
                );
                return (
                  <button
                  key={n.id}
                  type="button"
                  onClick={() => handleNotificationClick(n)}
                  className={className}
                  title={notificationTarget(n) || undefined}
                >
                  {content}
                </button>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <span className="text-xs text-slate-500">Latest {items.length} notifications</span>
            <Link
              href={notificationsPage}
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-brand-700 hover:text-brand-800"
            >
              View all
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
