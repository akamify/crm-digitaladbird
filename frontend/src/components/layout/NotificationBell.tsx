'use client';
import { useState, useRef, useEffect } from 'react';
import { Bell, Check, CheckCheck, X } from 'lucide-react';
import { useNotifications, useMarkRead, useMarkAllRead, type UserNotification } from '@/hooks/useNotifications';
import { fmtRelative } from '@/lib/format';
import { clsx } from '@/lib/format';

const TYPE_COLORS: Record<string, string> = {
  partner_request: 'bg-violet-100 text-violet-700',
  request_approved: 'bg-emerald-100 text-emerald-700',
  request_rejected: 'bg-rose-100 text-rose-700',
  request_partially_fulfilled: 'bg-amber-100 text-amber-700',
  lead_request: 'bg-indigo-100 text-indigo-700',
  lead_request_submitted: 'bg-indigo-100 text-indigo-700',
  rm_lead_request: 'bg-cyan-100 text-cyan-700',
  rm_lead_request_submitted: 'bg-cyan-100 text-cyan-700',
  lead_assigned: 'bg-blue-100 text-blue-700',
  leads_delivered: 'bg-blue-100 text-blue-700',
  rm_assigned: 'bg-sky-100 text-sky-700',
};

function typeLabel(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
              items.map((n: UserNotification) => (
                <div
                  key={n.id}
                  onClick={() => { if (!n.is_read) markRead.mutate(n.id); }}
                  className={clsx(
                    'flex gap-3 border-b border-slate-50 px-4 py-3 transition cursor-pointer',
                    !n.is_read ? 'bg-blue-50/50 hover:bg-blue-50' : 'hover:bg-slate-50',
                  )}
                >
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
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
