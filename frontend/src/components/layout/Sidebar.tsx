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
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  Bell,
  LifeBuoy,
  UserCircle,
  Tag,
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
  { href: '/chat', label: 'Messages', Icon: MessageSquare, roles: ['super_admin', 'admin', 'rm', 'member', 'partner'] },
  { href: '/notifications', label: 'Notifications', Icon: Bell, roles: ['super_admin', 'admin', 'rm', 'member', 'partner'] },
  // { href: '/my-google-sheet', label: 'My Google Sheet', Icon: FileSpreadsheet, roles: ['rm', 'member', 'partner'] },
  { href: '/reports', label: 'Reports', Icon: BarChart3, roles: ['super_admin', 'rm'] },
  { href: '/lead-requests', label: 'Lead Requests', Icon: HandMetal, roles: ['super_admin', 'admin', 'rm', 'member', 'partner'] },
  { href: '/leaderboard', label: 'Leaderboard', Icon: Trophy, roles: ['super_admin', 'admin', 'rm', 'member', 'partner'] },
  { href: '/users', label: 'Team', Icon: Users, roles: ['super_admin', 'rm'] },
  { href: '/rm-teams', label: 'RM Teams', Icon: UsersRound, roles: ['super_admin'] },
  { href: '/settings', label: 'Settings', Icon: Settings, roles: ['super_admin', 'client'] },
  { href: '/support', label: 'Support', Icon: LifeBuoy, roles: ['rm', 'member', 'partner', 'client'] },
  { href: '/profile', label: 'My Profile', Icon: UserCircle, roles: ['rm', 'member', 'partner', 'client'] },
];

const ADMIN_NAV = [
  { href: '/dashboard/admin/campaigns', label: 'Campaigns', Icon: Megaphone },
  { href: '/dashboard/admin/users', label: 'User Mgmt', Icon: Users },
  { href: '/dashboard/admin/clients', label: 'Client Mgmt', Icon: UserCircle },
  { href: '/dashboard/admin/leads-manager', label: 'Lead Mgmt', Icon: Briefcase },
  { href: '/dashboard/admin/sources', label: 'Lead Sources', Icon: Globe },
  { href: '/dashboard/admin/distribution', label: 'Distribution', Icon: GitBranch },
  { href: '/dashboard/admin/analytics', label: 'Analytics', Icon: PieChart },
  { href: '/dashboard/admin/sheets', label: 'Google Sheets', Icon: FileSpreadsheet },
  { href: '/dashboard/admin/labels', label: 'Labels', Icon: Tag },
  { href: '/dashboard/admin/support-tickets', label: 'Raised Tickets', Icon: LifeBuoy },
  { href: '/dashboard/admin/activity', label: 'Activity Logs', Icon: ScrollText },
];

export function Sidebar({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
  onExpand,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onExpand?: () => void;
}) {
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
    <aside
      onMouseEnter={collapsed ? onExpand : undefined}
      className={clsx(
      'flex h-full shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200',
      collapsed ? 'w-20' : 'w-60',
      )}
    >
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

      <div className={clsx('relative flex h-16 shrink-0 items-center border-b border-slate-100 px-4', collapsed ? 'justify-center gap-3' : 'justify-between gap-1')}>
        <LogoLockup tone="dark" showTagline={!collapsed} className={collapsed ? '[&>div:last-child]:hidden' : ''} />
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className={clsx(
              'hidden h-9 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 md:grid',
              collapsed && 'absolute left-[62px] z-10 border border-slate-200 bg-white shadow-sm',
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        )}
      </div>

      <nav className={clsx('sidebar-scroll-area flex-1 space-y-1 overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')}>
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
              title={collapsed ? label : undefined}
              className={clsx(
                'group flex items-center rounded-xl text-sm transition-all duration-150',
                collapsed ? 'justify-center px-2 py-3' : 'gap-3 px-3 py-2.5',
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

              {!collapsed && <span className="flex-1 truncate">{label}</span>}

              {showBadge && (
                <span
                  className={clsx(
                    'grid h-5 min-w-[20px] place-items-center rounded-full px-1.5 text-[10px] font-bold',
                    collapsed && 'absolute ml-8 -mt-7',
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
                title={collapsed ? 'Admin Control' : undefined}
                className={clsx(
                  'flex w-full items-center rounded-lg py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-700 transition hover:text-violet-700',
                  collapsed ? 'justify-center px-2' : 'justify-between px-3',
                )}
              >
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                  {!collapsed && 'Admin Control'}
                </span>

                {!collapsed && (adminOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                ))}
              </button>
            </div>

            {adminOpen && ADMIN_NAV.map(({ href, label, Icon }) => {
              const active = pathname === href;

              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  title={collapsed ? label : undefined}
                  className={clsx(
                    'group flex items-center rounded-xl text-[13px] transition-all duration-150',
                    collapsed ? 'justify-center px-2 py-3' : 'ml-1 gap-3 px-3 py-2',
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
                  {!collapsed && <span className="flex-1 truncate">{label}</span>}
                </Link>
              );
            })}
          </>
        )}
      </nav>
    </aside>
  );
}
