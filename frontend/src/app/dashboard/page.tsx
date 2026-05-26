'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, dashboardPath } from '@/lib/auth';
import { PageLoader } from '@/components/ui/Modal';

/** Role router — redirects each role to their dedicated dashboard. */
export default function DashboardPage() {
  const router = useRouter();
  const { user, initialized, init } = useAuth();

  useEffect(() => { if (!initialized) init(); }, [initialized, init]);

  useEffect(() => {
    if (!initialized) return;
    if (!user) { router.replace('/login'); return; }
    router.replace(dashboardPath(user.role));
  }, [initialized, user, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <PageLoader />
    </div>
  );
}
