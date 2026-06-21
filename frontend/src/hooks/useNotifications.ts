'use client';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';

export interface UserNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  message?: string | null;
  metadata: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
  read_at?: string | null;
}

export interface NotificationPage {
  notifications: UserNotification[];
  unread: number;
  pagination?: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
    has_more: boolean;
  };
}

export interface AdminNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export function useNotifications(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ['notifications', page, pageSize],
    queryFn: () => apiGet<NotificationPage>(`/notifications?page=${page}&page_size=${pageSize}`),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useInfiniteNotifications(pageSize = 20) {
  return useInfiniteQuery({
    queryKey: ['notifications', 'infinite', pageSize],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      apiGet<NotificationPage>(`/notifications?page=${pageParam}&page_size=${pageSize}`),
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.pagination) return lastPage.pagination.has_more ? allPages.length + 1 : undefined;
      if ((lastPage.notifications || []).length < pageSize) return undefined;
      return allPages.length + 1;
    },
    staleTime: 30_000,
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

export function useAdminNotifications(limit = 20, unreadOnly = false) {
  return useQuery({
    queryKey: ['admin-notifications', limit, unreadOnly],
    queryFn: () => apiGet<{ rows: AdminNotification[]; unread_count: number }>(`/admin/notifications?limit=${limit}${unreadOnly ? '&unread=true' : ''}`),
    staleTime: 30_000,
    retry: false,
  });
}

export function useAdminMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost(`/admin/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-notifications'] }),
  });
}

export function useAdminMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/admin/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-notifications'] }),
  });
}
