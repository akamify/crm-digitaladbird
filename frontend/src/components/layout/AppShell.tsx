'use client';
import { ReactNode, useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { AuthGate } from './AuthGate';
import { useSocketConnection } from '@/hooks/useChat';
import type { Role } from '@/types';

interface AppShellProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  roles?: Role[];
  right?: ReactNode;
}

export function AppShell({ children, title, subtitle, roles, right }: AppShellProps) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useSocketConnection();

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem('crm_sidebar_collapsed') === 'true');
    } catch {
      setCollapsed(false);
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem('crm_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  }

  function expandSidebar() {
    setCollapsed((value) => {
      if (!value) return value;
      try {
        window.localStorage.setItem('crm_sidebar_collapsed', 'false');
      } catch {}
      return false;
    });
  }

  return (
    <AuthGate roles={roles}>
      <div className="min-h-screen bg-slate-50">
        <div className="fixed inset-y-0 left-0 z-40 hidden md:flex md:flex-col">
          <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} onExpand={expandSidebar} />
        </div>

        {open && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <div className="relative h-full">
              <Sidebar onNavigate={() => setOpen(false)} />
            </div>
          </div>
        )}

        <div className={`flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ${collapsed ? 'md:pl-20' : 'md:pl-60'}`}>
          <Topbar title={title} subtitle={subtitle} onMenuClick={() => setOpen(true)} right={right} />
          <main className="flex-1 overflow-x-hidden px-4 py-5 sm:px-6 lg:px-8 page-enter">
            <div className="mx-auto w-full max-w-[1800px] space-y-5">
              {children}
            </div>
          </main>
        </div>
      </div>
    </AuthGate>
  );
}
