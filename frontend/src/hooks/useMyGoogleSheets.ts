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
  retry_after_at?: string | null;
  open_url?: string | null;
  status?: 'connected' | 'needs_reconnect' | 'sync_failed' | 'quota_cooldown' | 'disconnected';
  setup?: {
    sheet_created?: boolean;
    tabs_valid?: boolean;
    headers_valid?: boolean;
    missing_tabs?: string[];
    invalid_headers?: string[];
  };
}

export interface GoogleSpreadsheetOption {
  id: string;
  name: string;
  modified_time?: string | null;
  web_view_link?: string | null;
}

export interface SheetSetupResult {
  [sheetName: string]: { sheet_name: string; ready: boolean; created?: boolean; header_fixed?: boolean };
}

export interface MyGoogleSheetSyncLog {
  id: string;
  sync_type: string;
  status: string;
  records_synced?: number;
  records_failed?: number;
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

export function useMyGoogleSpreadsheets(connected: boolean, refreshKey = 0) {
  return useQuery({
    queryKey: ['my-google-sheets', 'spreadsheets', refreshKey],
    queryFn: () => apiGet<GoogleSpreadsheetOption[]>('/my/google-sheets/spreadsheets', refreshKey ? { refresh: true } : undefined),
    enabled: connected,
    staleTime: 7 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateMyGoogleSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { spreadsheet_name: string; sheet_names?: Record<string, string> }) => apiPost<MyGoogleSheetStatus & { setup?: SheetSetupResult }>('/my/google-sheets/create', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-google-sheets'] }),
  });
}

export function useConnectExistingMyGoogleSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { spreadsheet_id: string; auto_create_tabs?: boolean; auto_fix_headers?: boolean; sheet_names?: Record<string, string> }) =>
      apiPost<MyGoogleSheetStatus & { setup?: SheetSetupResult }>('/my/google-sheets/connect-existing', body),
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

export function useSetupMyGoogleSheet(action: 'create-missing-tabs' | 'fix-headers') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost(`/my/google-sheets/${action}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-google-sheets'] }),
  });
}

export function useSyncMyGoogleSheetNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/my/google-sheets/sync-now', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-google-sheets'] }),
  });
}

export function usePullMyGoogleSheet() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => apiPost('/my/google-sheets/pull-sync', {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['my-google-sheets'] }) });
}

export function useTwoWayMyGoogleSheet() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => apiPost('/my/google-sheets/two-way-sync', {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['my-google-sheets'] }) });
}

export function useDisconnectMyGoogleSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/my/google-sheets/disconnect', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-google-sheets'] }),
  });
}

export function useMyGoogleSheetLogs(page = 1) {
  return useQuery({
    queryKey: ['my-google-sheets', 'logs', page],
    queryFn: () => apiGet<MyGoogleSheetLogResponse>('/my/google-sheets/sync-logs', { page, page_size: 20 }),
    placeholderData: previous => previous,
  });
}
