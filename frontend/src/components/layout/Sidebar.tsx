'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, UsersRound, Briefcase, BarChart3, Settings, HandMetal, Trophy,
  Megaphone, Globe, GitBranch, ScrollText, FileSpreadsheet, PieChart, ChevronDown, ChevronRight,
  MessageSquare,
} from 'lucide-react';
import { useState } from 'react';
import { LogoLockup } from '@/components/ui/BirdLogo';
import { useAuth } from '@/lib/auth';
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
  { href: '/leads',     label: 'Leads',     Icon: Briefcase },
  { href: '/chat',      label: 'Messages',  Icon: MessageSquare },
  { href: '/reports',   label: 'Reports',   Icon: BarChart3,  roles: ['super_admin', 'rm'] },
  { href: '/partner-requests', label: 'Partner Requests', Icon: HandMetal },
  { href: '/leaderboard', label: 'Leaderboard', Icon: Trophy },
  { href: '/users',     label: 'Team',      Icon: Users,      roles: ['super_admin', 'rm'] },
  { href: '/rm-teams',  label: 'RM Teams',  Icon: UsersRound, roles: ['super_admin'] },
  { href: '/settings',  label: 'Settings',  Icon: Settings,   roles: ['super_admin'] },
];

const ADMIN_NAV = [
  { href: '/dashboard/admin/campaigns',    label: 'Campaigns',    Icon: Megaphone },
  { href: '/dashboard/admin/users',        label: 'User Mgmt',    Icon: Users },
  { href: '/dashboard/admin/leads-manager', label: 'Lead Mgmt',   Icon: Briefcase },
  { href: '/dashboard/admin/sources',      label: 'Lead Sources', Icon: Globe },
  { href: '/dashboard/admin/distribution', label: 'Distribution', Icon: GitBranch },
  { href: '/dashboard/admin/analytics',    label: 'Analytics',    Icon: PieChart },
  { href: '/dashboard/admin/sheets',       label: 'Google Sheets', Icon: FileSpreadsheet },
  { href: '/dashboard/admin/activity',     label: 'Activity Logs', Icon: ScrollText },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { data: chatUnread } = useChatUnread();
  const unreadCount = chatUnread?.unread || 0;
  const [adminOpen, setAdminOpen] = useState(() => pathname?.startsWith('/dashboard/admin/') ?? false);
  if (!user) return null;

  const items = NAV.filter(n => !n.roles || n.roles.includes(user.role));
  const isAdmin = user.role === 'super_admin';

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex h-16 items-center border-b border-slate-100 px-4">
        <LogoLockup tone="dark" />
      </div>

      <nav className="flex-1 overflow-y-auto space-y-1 px-3 py-4">
        {items.map(({ href, label, Icon }) => {
          const active = pathname === href || (pathname?.startsWith(`${href}/`) && href !== '/dashboard');
          const showBadge = href === '/chat' && unreadCount > 0;
          return (
            <Link
              key={href} href={href} onClick={onNavigate}
              className={clsx(
                'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-150',
                active
                  ? 'sidebar-active font-semibold'
                  : 'text-slate-600 font-medium hover:bg-slate-100 hover:text-slate-900',
              )}
            >
              <Icon className={clsx('h-[18px] w-[18px] shrink-0', active ? 'text-white' : 'text-slate-400 group-hover:text-slate-700')} />
              <span className="flex-1">{label}</span>
              {showBadge && (
                <span className={clsx(
                  'grid h-5 min-w-[20px] place-items-center rounded-full px-1.5 text-[10px] font-bold',
                  active ? 'bg-white/25 text-white' : 'bg-brand-600 text-white',
                )}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
          );
        })}

        {/* Admin Control Center sub-nav */}
        {isAdmin && (
          <>
            <div className="pt-4 pb-1">
              <button
                onClick={() => setAdminOpen(v => !v)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-700 hover:text-violet-700 transition"
              >
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                  Admin Control
                </span>
                {adminOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            </div>
            {adminOpen && ADMIN_NAV.map(({ href, label, Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href} href={href} onClick={onNavigate}
                  className={clsx(
                    'group flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] transition-all duration-150 ml-1',
                    active
                      ? 'sidebar-active-sub font-semibold'
                      : 'text-slate-600 font-medium hover:bg-slate-100 hover:text-slate-900',
                  )}
                >
                  <Icon className={clsx('h-[16px] w-[16px] shrink-0', active ? 'text-white' : 'text-slate-400 group-hover:text-violet-600')} />
                  {label}
                </Link>
              );
            })}
          </>
        )}
      </nav>

      <div className="border-t border-slate-100 p-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Signed in as</div>
          <div className="mt-1 truncate text-sm font-medium text-slate-900">{user.name}</div>
          <div className="mt-0.5 text-xs capitalize text-slate-500">{user.role}{user.team ? ` · ${user.team}` : ''}</div>
        </div>
      </div>
    </aside>
  );
}
