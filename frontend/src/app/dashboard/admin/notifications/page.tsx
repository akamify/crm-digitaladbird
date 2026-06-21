'use client';

import { NotificationsCenter } from '@/components/notifications/NotificationsCenter';
import { AppShell } from '@/components/layout/AppShell';

export default function AdminNotificationsPage() {
  return (
    <AppShell
      title="Notifications"
      subtitle="Assignment, request, and workflow notifications in one place"
      roles={['super_admin', 'admin']}
    >
      <NotificationsCenter />
    </AppShell>
  );
}
