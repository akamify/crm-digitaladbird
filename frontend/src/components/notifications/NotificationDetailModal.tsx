'use client';

import Link from 'next/link';
import { Bell, ExternalLink } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { formatISTDateTime } from '@/lib/date';
import { humanize } from '@/lib/format';
import type { UserNotification } from '@/hooks/useNotifications';

interface Props {
  notification: UserNotification | null;
  open: boolean;
  onClose: () => void;
  targetHref: string | null;
}

export function NotificationDetailModal({ notification, open, onClose, targetHref }: Props) {
  if (!notification) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Notification Details"
      description="Full notification content and related record link"
      size="lg"
    >
      <div className="space-y-4 py-3">
        <section className="card-padded space-y-3">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-50 text-brand-700">
              <Bell className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-slate-900">{notification.title}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{formatISTDateTime(notification.created_at)}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                  {humanize(notification.type)}
                </span>
                <span className={`rounded-full px-2 py-0.5 font-medium ${notification.is_read ? 'bg-slate-100 text-slate-600' : 'bg-blue-100 text-blue-700'}`}>
                  {notification.is_read ? 'Read' : 'Unread'}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
            {notification.body || 'No additional message available.'}
          </div>

          {targetHref && (
            <div className="flex justify-end">
              <Link
                href={targetHref}
                className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100"
              >
                <ExternalLink className="h-4 w-4" />
                Open related record
              </Link>
            </div>
          )}
        </section>

        <section className="card-padded">
          <h4 className="text-sm font-semibold text-slate-900">Metadata</h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {Object.entries(notification.metadata || {}).length === 0 ? (
              <div className="text-sm text-slate-500">No metadata available.</div>
            ) : (
              Object.entries(notification.metadata || {}).map(([key, value]) => (
                <div key={key} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{humanize(key)}</div>
                  <div className="mt-1 break-words text-sm text-slate-700">
                    {typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
                      ? String(value)
                      : JSON.stringify(value)}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}
