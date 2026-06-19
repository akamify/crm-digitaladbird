'use client';
import { ReactNode, useState } from 'react';
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
  useSocketConnection();

  return (
    <AuthGate roles={roles}>
      <div className="min-h-screen bg-slate-50">
        <div className="fixed inset-y-0 left-0 z-40 hidden md:flex md:flex-col">
          <Sidebar />
        </div>

        {open && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <div className="relative h-full">
              <Sidebar onNavigate={() => setOpen(false)} />
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col md:pl-60">
          <Topbar title={title} subtitle={subtitle} onMenuClick={() => setOpen(true)} right={right} />
          <main className="flex-1 overflow-x-hidden p-4 sm:p-6 page-enter">{children}</main>
        </div>
      </div>
    </AuthGate>
  );
}
