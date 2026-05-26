'use client';
import { ReactNode, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth, dashboardPath } from '@/lib/auth';
import { PageLoader } from '@/components/ui/Modal';
import type { Role } from '@/types';

interface AuthGateProps {
  children: ReactNode;
  /** If provided, user role must be in this list. */
  roles?: Role[];
}

export function AuthGate({ children, roles }: AuthGateProps) {
  const router   = useRouter();
  const pathname = usePathname();
  const { user, initialized, init } = useAuth();

  useEffect(() => { if (!initialized) init(); }, [initialized, init]);

  useEffect(() => {
    if (!initialized) return;
    if (!user) {
      const next = pathname && pathname !== '/login' ? `?next=${encodeURIComponent(pathname)}` : '';
      router.replace(`/login${next}`);
      return;
    }
    if (roles && roles.length && !roles.includes(user.role)) {
      // Wrong portal — redirect to the user's own dashboard
      router.replace(dashboardPath(user.role));
    }
  }, [initialized, user, pathname, roles, router]);

  if (!initialized || !user || (roles?.length && !roles.includes(user.role))) {
    return <PageLoader />;
  }
  return <>{children}</>;
}
