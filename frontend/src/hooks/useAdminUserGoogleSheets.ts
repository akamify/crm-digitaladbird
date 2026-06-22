'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';

export type UserSheetConnection = {
  id: string;
  user_id: string;
  user_name: string;
  role: string;
  rm_name?: string | null;
  team_name?: string | null;
  google_email?: string | null;
  spreadsheet_id?: string | null;
  spreadsheet_name?: string | null;
  default_sheet_name?: string | null;
  trader_sheet_name?: string | null;
  partner_sheet_name?: string | null;
  unknown_sheet_name?: string | null;
  sync_enabled: boolean;
  last_sync_at?: string | null;
  last_error?: string | null;
  status: 'connected' | 'disconnected' | 'needs_reconnect';
};

export type UserSheetList = {
  data: UserSheetConnection[];
  pagination: { page: number; page_size: number; total: number; total_pages: number; has_more: boolean };
};

export type UserSheetPreview = {
  connection: Pick<UserSheetConnection, 'id' | 'user_id' | 'user_name' | 'role' | 'google_email' | 'spreadsheet_id' | 'spreadsheet_name'>;
  sheet_name: string;
  headers: string[];
  rows: Record<string, string>[];
  pagination: { page: number; page_size: number; has_more: boolean };
};

export type UserSheetLog = {
  id: string;
  user_name?: string | null;
  role?: string | null;
  sync_type: string;
  status: string;
  records_attempted: number;
  records_synced: number;
  records_failed: number;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

export function useAdminUserSheetConnections(params: { page?: number; search?: string; role?: string; status?: string; user_id?: string } = {}) {
  return useQuery({
    queryKey: ['admin-user-google-sheets', 'connections', params],
    queryFn: () => apiGet<UserSheetList>('/admin/user-google-sheets/connections', { ...params, page_size: 20 }),
  });
}

export function useAdminUserSheetPreview(connectionId: string | null, sheetName: string, page: number) {
  return useQuery({
    queryKey: ['admin-user-google-sheets', 'preview', connectionId, sheetName, page],
    queryFn: () => apiGet<UserSheetPreview>(`/admin/user-google-sheets/connections/${connectionId}/preview`, { sheet_name: sheetName, page, page_size: 20 }),
    enabled: !!connectionId,
  });
}

export function useAdminUserSheetLogs(userId?: string) {
  return useQuery({
    queryKey: ['admin-user-google-sheets', 'logs', userId || 'all'],
    queryFn: () => apiGet<{ data: UserSheetLog[]; pagination: UserSheetList['pagination'] }>('/admin/user-google-sheets/sync-logs', { page: 1, page_size: 20, user_id: userId }),
  });
}

export function useAdminTestUserSheet() {
  return useMutation({ mutationFn: (connectionId: string) => apiPost(`/admin/user-google-sheets/connections/${connectionId}/test`, {}) });
}

export function useAdminSyncUserSheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) => apiPost(`/admin/user-google-sheets/connections/${connectionId}/sync-now`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-user-google-sheets'] }),
  });
}

export function useAdminPullUserSheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) => apiPost(`/admin/user-google-sheets/connections/${connectionId}/pull-sync`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-user-google-sheets'] }),
  });
}
