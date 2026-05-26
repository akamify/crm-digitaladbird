'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';

export interface UserNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export function useNotifications(page = 1) {
  return useQuery({
    queryKey: ['notifications', page],
    queryFn: () => apiGet<{ notifications: UserNotification[]; unread: number }>(`/notifications?page=${page}`),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
