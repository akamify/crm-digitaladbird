'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '@/lib/api';

export interface MyGoogleSheetStatus {
  connected: boolean;
  google_email?: string | null;
  spreadsheet_id?: string | null;
  spreadsheet_name?: string | null;
  default_sheet_name?: string | null;
  trader_sheet_name?: string | null;
  partner_sheet_name?: string | null;
  unknown_sheet_name?: string | null;
  sync_enabled?: boolean;
  last_sync_at?: string | null;
  last_error?: string | null;
  open_url?: string | null;
}

export interface MyGoogleSheetSyncLog {
  id: string;
  sync_type: string;
  status: string;
  records_synced?: number;
  started_at?: string;
  error_message?: string | null;
}

export interface MyGoogleSheetLogResponse {
  data: MyGoogleSheetSyncLog[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
    has_more: boolean;
  };
}

export function useMyGoogleSheetStatus() {
  return useQuery({
    queryKey: ['my-google-sheets', 'status'],
    queryFn: () => apiGet<MyGoogleSheetStatus>('/my/google-sheets/status'),
  });
}

export function useStartMyGoogleOAuth() {
  return useMutation({
    mutationFn: () => apiGet<{ url: string }>('/my/google-sheets/oauth/start'),
  });
}

export function useCreateMyGoogleSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (spreadsheet_name?: string) => apiPost<MyGoogleSheetStatus>('/my/google-sheets/create', { spreadsheet_name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-google-sheets'] }),
  });
}

export function useConnectExistingMyGoogleSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (spreadsheet_url_or_id: string) =>
      apiPost<MyGoogleSheetStatus>('/my/google-sheets/connect-existing', { spreadsheet_url_or_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-google-sheets'] }),
  });
}

export function useUpdateMyGoogleSheetSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<MyGoogleSheetStatus>) => apiPatch<MyGoogleSheetStatus>('/my/google-sheets/settings', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-google-sheets'] }),
  });
}

export function useTestMyGoogleSheet() {
  return useMutation({
    mutationFn: () => apiPost('/my/google-sheets/test', {}),
  });
}

export function useSyncMyGoogleSheetNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/my/google-sheets/sync-now', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-google-sheets'] }),
  });
}

export function useDisconnectMyGoogleSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/my/google-sheets/disconnect', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-google-sheets'] }),
  });
}

export function useMyGoogleSheetLogs() {
  return useQuery({
    queryKey: ['my-google-sheets', 'logs'],
    queryFn: () => apiGet<MyGoogleSheetLogResponse>('/my/google-sheets/sync-logs', { page: 1, page_size: 20 }),
  });
}
