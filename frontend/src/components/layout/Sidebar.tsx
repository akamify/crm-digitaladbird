'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, UsersRound, Briefcase, BarChart3, Settings, HandMetal, Trophy,
  Megaphone, Globe, GitBranch, ScrollText, FileSpreadsheet, PieChart, ChevronDown, ChevronRight,
  MessageSquare,
} from 'lucide-react';
import { useState } from 'react';
import { BirdLogo } from '@/components/ui/BirdLogo';
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
      <div className="flex h-16 items-center gap-3 border-b border-slate-100 px-5">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow">
          <BirdLogo className="h-5 w-5" />
        </div>
        <div>
          <div className="font-display text-base font-semibold leading-none text-slate-900">DigitalADbird</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">CRM</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto space-y-1 px-3 py-4">
        {items.map(({ href, label, Icon }) => {
          const active = pathname === href || (pathname?.startsWith(`${href}/`) && href !== '/dashboard');
          const showBadge = href === '/chat' && unreadCount > 0;
          return (
            <Link
              key={href} href={href} onClick={onNavigate}
              className={clsx(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                active
                  ? 'bg-brand-50 text-brand-700 font-medium'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
              )}
            >
              <Icon className={clsx('h-4 w-4', active ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600')} />
              <span className="flex-1">{label}</span>
              {showBadge && (
                <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
          );
        })}

        {/* Admin Control Center sub-nav */}
        {isAdmin && (
          <>
            <div className="pt-3 pb-1">
              <button
                onClick={() => setAdminOpen(v => !v)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600 transition"
              >
                <span>Admin Control</span>
                {adminOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            </div>
            {adminOpen && ADMIN_NAV.map(({ href, label, Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href} href={href} onClick={onNavigate}
                  className={clsx(
                    'group flex items-center gap-3 rounded-lg px-3 py-1.5 text-[13px] transition ml-1',
                    active
                      ? 'bg-violet-50 text-violet-700 font-medium'
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800',
                  )}
                >
                  <Icon className={clsx('h-3.5 w-3.5', active ? 'text-violet-600' : 'text-slate-400 group-hover:text-slate-500')} />
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
