'use client';

import { NotificationsCenter } from '@/components/notifications/NotificationsCenter';
import { AppShell } from '@/components/layout/AppShell';

export default function NotificationsPage() {
  return (
    <AppShell
      title="Notifications"
      subtitle="Recent lead assignments, requests, and workflow updates"
      roles={['super_admin', 'admin', 'rm', 'member', 'partner']}
    >
      <NotificationsCenter />
    </AppShell>
  );
}
