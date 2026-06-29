'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  UsersRound,
  Briefcase,
  BarChart3,
  Settings,
  HandMetal,
  Trophy,
  Megaphone,
  Globe,
  GitBranch,
  ScrollText,
  FileSpreadsheet,
  PieChart,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Bell,
  LifeBuoy,
  UserCircle,
} from 'lucide-react';
import { useState } from 'react';
import { LogoLockup } from '@/components/ui/BirdLogo';
import { dashboardPath, useAuth } from '@/lib/auth';
import { useChatUnread } from '@/hooks/useChat';
import { clsx } from '@/lib/format';
import type { Role } from '@/types';

interface NavItem {
  href: string;
  label: string;
  Icon: typeof LayoutDashboard;
  roles?: Role[];
  children?: { href: string; label: string; Icon: typeof LayoutDashboard }[];
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/leads', label: 'Leads', Icon: Briefcase },
  { href: '/chat', label: 'Messages', Icon: MessageSquare },
  { href: '/notifications', label: 'Notifications', Icon: Bell },
  { href: '/profile', label: 'My Profile', Icon: UserCircle, roles: ['super_admin', 'admin', 'rm', 'member', 'partner'] },
  { href: '/my-google-sheet', label: 'My Google Sheet', Icon: FileSpreadsheet, roles: ['rm', 'member', 'partner'] },
  { href: '/reports', label: 'Reports', Icon: BarChart3, roles: ['super_admin', 'rm'] },
  { href: '/lead-requests', label: 'Lead Requests', Icon: HandMetal, roles: ['super_admin', 'admin', 'rm', 'member', 'partner'] },
  { href: '/support', label: 'Support', Icon: LifeBuoy, roles: ['super_admin', 'admin', 'rm', 'member', 'partner'] },
  { href: '/leaderboard', label: 'Leaderboard', Icon: Trophy },
  { href: '/users', label: 'Team', Icon: Users, roles: ['super_admin', 'rm'] },
  { href: '/rm-teams', label: 'RM Teams', Icon: UsersRound, roles: ['super_admin'] },
  { href: '/settings', label: 'Settings', Icon: Settings, roles: ['super_admin'] },
];

const ADMIN_NAV = [
  { href: '/dashboard/admin/campaigns', label: 'Campaigns', Icon: Megaphone },
  { href: '/dashboard/admin/users', label: 'User Mgmt', Icon: Users },
  { href: '/dashboard/admin/leads-manager', label: 'Lead Mgmt', Icon: Briefcase },
  { href: '/dashboard/admin/sources', label: 'Lead Sources', Icon: Globe },
  { href: '/dashboard/admin/distribution', label: 'Distribution', Icon: GitBranch },
  { href: '/dashboard/admin/analytics', label: 'Analytics', Icon: PieChart },
  { href: '/dashboard/admin/sheets', label: 'Google Sheets', Icon: FileSpreadsheet },
  { href: '/dashboard/admin/support-tickets', label: 'Raised Tickets', Icon: LifeBuoy },
  { href: '/dashboard/admin/activity', label: 'Activity Logs', Icon: ScrollText },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { data: chatUnread } = useChatUnread();
  const unreadCount = chatUnread?.unread || 0;
  const [adminOpen, setAdminOpen] = useState(() => pathname?.startsWith('/dashboard/admin/') ?? false);

  if (!user) return null;

  const items = NAV
    .filter((n) => !n.roles || n.roles.includes(user.role))
    .map((n) => (n.href === '/dashboard' ? { ...n, href: dashboardPath(user.role) } : n));

  const isAdmin = user.role === 'super_admin';

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <style jsx>{`
        .sidebar-scroll-area {
          scrollbar-width: none;
          -ms-overflow-style: none;
          overscroll-behavior: contain;
        }

        .sidebar-scroll-area::-webkit-scrollbar {
          display: none;
          width: 0;
          height: 0;
        }
      `}</style>

      <div className="flex h-16 shrink-0 items-center border-b border-slate-100 px-4">
        <LogoLockup tone="dark" />
      </div>

      <nav className="sidebar-scroll-area flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map(({ href, label, Icon }) => {
          const active = label === 'Dashboard'
            ? pathname === href
            : pathname === href || pathname?.startsWith(`${href}/`);

          const showBadge = href === '/chat' && unreadCount > 0;

          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={clsx(
                'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-150',
                active
                  ? 'sidebar-active font-semibold'
                  : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )}
            >
              <Icon
                className={clsx(
                  'h-[18px] w-[18px] shrink-0',
                  active ? 'text-white' : 'text-slate-400 group-hover:text-slate-700',
                )}
              />

              <span className="flex-1">{label}</span>

              {showBadge && (
                <span
                  className={clsx(
                    'grid h-5 min-w-[20px] place-items-center rounded-full px-1.5 text-[10px] font-bold',
                    active ? 'bg-white/25 text-white' : 'bg-brand-600 text-white',
                  )}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
          );
        })}

        {isAdmin && (
          <>
            <div className="pt-4 pb-1">
              <button
                type="button"
                onClick={() => setAdminOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-700 transition hover:text-violet-700"
              >
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                  Admin Control
                </span>

                {adminOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                )}
              </button>
            </div>

            {adminOpen && ADMIN_NAV.map(({ href, label, Icon }) => {
              const active = pathname === href;

              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  className={clsx(
                    'group ml-1 flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] transition-all duration-150',
                    active
                      ? 'sidebar-active-sub font-semibold'
                      : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  )}
                >
                  <Icon
                    className={clsx(
                      'h-[16px] w-[16px] shrink-0',
                      active ? 'text-white' : 'text-slate-400 group-hover:text-violet-600',
                    )}
                  />
                  <span className="flex-1">{label}</span>
                </Link>
              );
            })}
          </>
        )}
      </nav>
    </aside>
  );
}
