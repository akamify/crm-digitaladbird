'use client';
import { useState, useRef, useEffect } from 'react';
import { LogOut, ChevronDown, Menu, UserCircle } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useChatUnread } from '@/hooks/useChat';
import { initials } from '@/lib/format';
import { requestBrowserNotificationPermission, saveNotificationSoundPreferences, unlockNotificationSound } from '@/lib/notificationSound';
import { NotificationBell } from './NotificationBell';

interface TopbarProps {
  title: string;
  subtitle?: string;
  onMenuClick?: () => void;
  right?: React.ReactNode;
}

export function Topbar({ title, subtitle, onMenuClick, right }: TopbarProps) {
  const { user, logout } = useAuth();
  const { data: chatUnread } = useChatUnread();
  const unreadCount = chatUnread?.unread || 0;
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!user?.id || typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    const key = `crm_notification_permission_prompted:${user.id}`;
    if (window.localStorage.getItem(key) === 'true') return;
    window.localStorage.setItem(key, 'true');
    const timer = window.setTimeout(async () => {
      const permission = await requestBrowserNotificationPermission();
      saveNotificationSoundPreferences({
        browserNotifications: permission === 'granted',
        soundEnabled: permission === 'granted',
      });
      if (permission === 'granted') {
        unlockNotificationSound().catch(() => {});
      }
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [user?.id]);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 sm:gap-3 border-b border-slate-200 bg-white/85 px-3 sm:px-4 lg:px-6 backdrop-blur">
      {onMenuClick && (
        <button
          onClick={onMenuClick}
          className="grid h-10 w-10 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 md:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <h1 className="font-display text-base font-semibold leading-tight text-slate-900 sm:text-lg lg:text-xl truncate">{title}</h1>
        {subtitle && <p className="mt-0.5 truncate text-[11px] sm:text-xs text-slate-500">{subtitle}</p>}
      </div>

      {/* `right` slot is page-defined — hide it on extra-narrow phones if a page passes a wide bar; pages can override with their own breakpoints */}
      {right && <div className="hidden sm:flex shrink-0">{right}</div>}

      <div className="relative grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:text-slate-700 transition shrink-0">
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-brand-600 px-1 text-[9px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </div>

      <NotificationBell />

      <div className="relative shrink-0" ref={menuRef}>
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 sm:px-2.5 py-1.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
            {initials(user?.name)}
          </span>
          {/* Hide name on phones so the cluster doesn't push the title off-screen */}
          <span className="hidden truncate md:inline-block max-w-[10rem]">{user?.name}</span>
          <ChevronDown className="hidden sm:block h-3.5 w-3.5 text-slate-400" />
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card">
            <div className="border-b border-slate-100 px-3 py-2.5">
              <div className="truncate text-sm font-medium text-slate-900">{user?.name}</div>
              <div className="truncate text-xs text-slate-500">{user?.email}</div>
              <div className="mt-1 inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-brand-700">{user?.role}</div>
            </div>
            {(user?.role === 'rm' || user?.role === 'member' || user?.role === 'partner') && (
              <Link
                href="/profile"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <UserCircle className="h-4 w-4 text-slate-400" /> My Profile
              </Link>
            )}
            <button
              onClick={() => logout()}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4 text-slate-400" /> Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
