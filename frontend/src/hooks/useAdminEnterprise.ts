'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';

export interface AssignmentSettings {
  autoAssignEnabled: boolean;
  assignStartHour: number;
  assignEndHour: number;
  timezone: string;
  scheduledAssignmentTime?: string | null;
  scheduledTimezone?: string | null;
  maxLeadsPerScheduledRun?: number;
  lastScheduledRunAt?: string | null;
  nextScheduledRunAt?: string | null;
  isDistributionRunning?: boolean;
  lastDistributionStatus?: string | null;
  lastDistributionError?: string | null;
  autoAssignApprovedRequests: boolean;
  autoReassignEnabled: boolean;
  reassignAfterHours: number;
  reassignToHighPerformers: boolean;
  assignmentTickLimit: number;
  requestFulfillmentLimit: number;
  reassignmentTickLimit: number;
  approvedRequestFulfillment?: { assigned?: number; processed?: number; requests?: Array<{ requestId: string; assigned: number }> } | null;
}

export function useAssignmentOverview() {
  return useQuery({
    queryKey: ['admin', 'assignment-overview'],
    queryFn: () => apiGet<{ settings: AssignmentSettings; stats: Record<string, number> }>('/admin/assignment/overview'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useUpdateAssignmentSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<AssignmentSettings>) => apiPatch<AssignmentSettings>('/admin/assignment/settings', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'assignment-overview'] });
      qc.invalidateQueries({ queryKey: ['dist-stats'] });
    },
  });
}

export function useRunDistributionNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/admin/distribution/run-now'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['admin', 'assignment-overview'] });
      qc.invalidateQueries({ queryKey: ['lead-request-stats'] });
    },
  });
}

export function useRunApprovedRequestAssignmentNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/admin/assignment/approved-requests/run-now'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['admin', 'assignment-overview'] });
      qc.invalidateQueries({ queryKey: ['lead-request-stats'] });
      qc.invalidateQueries({ queryKey: ['lead-requests'] });
    },
  });
}

export function useSyncAssignedLeadSheets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/admin/assignment/sync-assigned-sheets', { limit: 300 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['admin', 'assignment-overview'] });
    },
  });
}

export function useRunReassignmentNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/admin/reassignment/run-now'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['admin', 'assignment-overview'] });
    },
  });
}

// ── Campaign Management ──────────────────────────────────────────
export interface AdminCampaign {
  id: string; campaign_id: string; campaign_name: string; internal_label: string | null;
  ad_account_id: string | null; is_active: boolean; category: string | null; created_at: string;
  total_leads: number; today_leads: number; conversions: number; pending_leads: number;
  lead_category?: 'trader' | 'partner' | 'unknown'; lead_category_label?: string;
  category_notes?: string | null; category_updated_at?: string | null; category_updated_by_name?: string | null;
  meta_status?: string | null;
  effective_status?: string | null;
  configured_status?: string | null;
  source?: string | null;
  last_meta_status_checked_at?: string | null;
}

export function useAdminCampaigns() {
  return useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => apiGet<AdminCampaign[]>('/admin/campaigns'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { campaign_name: string; internal_label?: string; category?: string; ad_account_id?: string }) =>
      apiPost('/admin/campaigns', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] }),
  });
}

export function useUpdateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; campaign_name?: string; internal_label?: string; is_active?: boolean; category?: string }) =>
      apiPatch(`/admin/campaigns/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] }),
  });
}

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/admin/campaigns/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] }),
  });
}

// ── Lead Sources ─────────────────────────────────────────────────
export interface LeadSourceStat {
  source: string | null; total_leads: number; today_leads: number; conversions: number;
  pending: number; won: number; conv_rate: number; last_lead_at: string | null;
}
export interface CampaignSourceStat {
  campaign: string; source: string | null; total_leads: number; today_leads: number;
  conversions: number; conv_rate: number;
}

export function useLeadSources() {
  return useQuery({
    queryKey: ['admin', 'lead-sources'],
    queryFn: () => apiGet<{ sources: LeadSourceStat[]; campaigns: CampaignSourceStat[]; daily: { day: string; source: string; count: number }[] }>('/admin/lead-sources'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ── Google Sheets Control ────────────────────────────────────────
export interface SheetsConfig {
  config: { sheet_id: string | null; service_account_email: string | null; sheet_name: string; key_path: string | null; configured: boolean };
  sync_logs: { id: string; action: string; metadata: Record<string, unknown>; created_at: string }[];
}

export function useSheetsConfig() {
  return useQuery({
    queryKey: ['admin', 'sheets-config'],
    queryFn: () => apiGet<SheetsConfig>('/admin/sheets/config'),
  });
}

export function useTriggerSheetSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/admin/sheets/trigger-sync'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'sheets-config'] }),
  });
}

// ── Dynamic Google Sheets Configs (admin-uploaded credentials) ───
export type SheetPurpose = 'traders' | 'partners' | null;

export interface SheetConfigPublic {
  id: string;
  kind: 'google_sheets';
  label: string;
  purpose: SheetPurpose;
  is_active: boolean;
  sheet_id: string | null;
  sheet_name: string;
  service_account_email: string | null;
  has_credentials: boolean;
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  last_synced_at: string | null;
  last_sync_count: number | null;
  auto_import_enabled: boolean;
  auto_import_minutes: number;
  last_import_at: string | null;
  last_import_stats: { total: number; imported: number; duplicates: number; failed: number; finished_at?: string } | null;
  created_at: string;
  updated_at: string;
}

export interface SheetsConnectivity {
  configured: boolean;
  source: 'db' | 'env' | null;
  sheet_id: string;
  sheet_name: string;
  service_account_email: string;
  api_connected: boolean;
  sheet_accessible: boolean;
  sheet_title: string | null;
  row_count: number;
  error: string | null;
}

export interface GoogleSheetRoutingSettings {
  connected?: boolean;
  source?: 'db' | 'env_path' | 'env_json' | null | string;
  config_id: string | null;
  spreadsheet_id: string | null;
  default_sheet_name: string;
  trader_sheet_name: string;
  partner_sheet_name: string;
  unknown_sheet_name: string;
  auto_create_missing_sheets: boolean;
  category_sheet_routing_enabled: boolean;
  service_account_email?: string | null;
  key_path?: string | null;
  credentials_managed_by?: string;
  editable_fields?: string[];
}

export function useSheetConfigs() {
  return useQuery({
    queryKey: ['admin', 'sheet-configs'],
    queryFn: () => apiGet<SheetConfigPublic[]>('/admin/sheets/configs'),
    staleTime: 15_000,
  });
}

export function useSheetsConnectivity() {
  return useQuery({
    queryKey: ['admin', 'sheets-connectivity'],
    queryFn: () => apiGet<SheetsConnectivity>('/admin/sheets/connectivity'),
    staleTime: 30_000,
  });
}

/**
 * Upload a new config — supports either a File (drag-drop / file picker) OR a
 * pasted JSON string. The endpoint accepts both.
 */
export function useCreateSheetConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      sheet_id: string;
      label: string;
      purpose?: SheetPurpose;
      sheet_name?: string;
      make_active?: boolean;
      file?: File | null;
      credentials_json?: string;
    }) => {
      const fd = new FormData();
      fd.append('sheet_id', body.sheet_id);
      fd.append('label', body.label);
      if (body.purpose) fd.append('purpose', body.purpose);
      if (body.sheet_name) fd.append('sheet_name', body.sheet_name);
      if (body.make_active) fd.append('make_active', 'true');
      if (body.file) fd.append('credentials_file', body.file);
      else if (body.credentials_json) fd.append('credentials_json', body.credentials_json);
      else throw new Error('Provide either a file or pasted JSON.');
      const { api } = await import('@/lib/api');
      const { data } = await api.post('/admin/sheets/configs', fd);
      return data.data as SheetConfigPublic;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'sheet-configs'] });
      qc.invalidateQueries({ queryKey: ['admin', 'sheets-connectivity'] });
      qc.invalidateQueries({ queryKey: ['admin', 'sheets-enriched'] });
      qc.invalidateQueries({ queryKey: ['admin', 'sheets-stats'] });
    },
  });
}

export function useUpdateSheetConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; sheet_id?: string; sheet_name?: string; label?: string; purpose?: SheetPurpose; credentials_json?: string; file?: File | null }) => {
      const fd = new FormData();
      if (patch.sheet_id   !== undefined) fd.append('sheet_id', patch.sheet_id);
      if (patch.sheet_name !== undefined) fd.append('sheet_name', patch.sheet_name);
      if (patch.label      !== undefined) fd.append('label', patch.label);
      if (patch.purpose    !== undefined && patch.purpose !== null) fd.append('purpose', patch.purpose);
      if (patch.file) fd.append('credentials_file', patch.file);
      else if (patch.credentials_json) fd.append('credentials_json', patch.credentials_json);
      const { api } = await import('@/lib/api');
      const { data } = await api.patch(`/admin/sheets/configs/${id}`, fd);
      return data.data as SheetConfigPublic;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'sheet-configs'] });
      qc.invalidateQueries({ queryKey: ['admin', 'sheets-connectivity'] });
      qc.invalidateQueries({ queryKey: ['admin', 'sheets-stats'] });
    },
  });
}

// Per-purpose lead stats — populates Traders vs Partners stat cards
export interface SheetStats {
  traders: { total: number; unassigned: number; assigned: number; converted: number; today: number };
  partners: { total: number; unassigned: number; assigned: number; converted: number; today: number };
}
export function useSheetStats() {
  return useQuery({
    queryKey: ['admin', 'sheets-stats'],
    queryFn: () => apiGet<SheetStats>('/admin/sheets/stats'),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

export function useActivateSheetConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost(`/admin/sheets/configs/${id}/activate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'sheet-configs'] });
      qc.invalidateQueries({ queryKey: ['admin', 'sheets-connectivity'] });
    },
  });
}

export function useTestSheetConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost<{ ok: boolean; sheet_title?: string; tabs?: string[]; row_count?: number; error?: string }>(`/admin/sheets/configs/${id}/test`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'sheet-configs'] }),
  });
}

export function useSyncSheetConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost<{ synced: number }>(`/admin/sheets/configs/${id}/sync-now`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'sheet-configs'] });
      qc.invalidateQueries({ queryKey: ['admin', 'sheets-enriched'] });
    },
  });
}

export function useDeleteSheetConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      return import('@/lib/api').then(({ api }) => api.delete(`/admin/sheets/configs/${id}`).then(r => r.data.data));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'sheet-configs'] }),
  });
}

export function useSheetPreview(limit = 10, purpose: SheetPurpose = null) {
  const qs = `limit=${limit}` + (purpose ? `&purpose=${purpose}` : '');
  return useQuery({
    queryKey: ['admin', 'sheet-preview', limit, purpose || 'any'],
    queryFn: () => apiGet<{ sheet_id: string; sheet_name: string; purpose: SheetPurpose; header: string[]; rows: string[][] }>(`/admin/sheets/preview?${qs}`),
    enabled: false, // user clicks "Preview" to trigger
    staleTime: 30_000,
    retry: false,
  });
}

// ── Sheet → CRM Import ────────────────────────────────────────────
export interface SheetImportStats {
  total: number; imported: number; duplicates: number; failed: number;
  failed_samples?: { row_index: number; error: string }[];
  log_id?: string;
}

export interface SheetImportLog {
  id: string;
  triggered_by: 'manual' | 'auto';
  triggered_by_name: string | null;
  started_at: string;
  finished_at: string | null;
  total_rows: number;
  imported: number;
  duplicates: number;
  failed: number;
  error_message: string | null;
  failed_samples: { row_index: number; error: string }[] | null;
}

export function useSheetImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, max_rows = 5000, assign = true }: { id: string; max_rows?: number; assign?: boolean }) =>
      apiPost<SheetImportStats>(`/admin/sheets/configs/${id}/import`, { max_rows, assign }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'sheet-configs'] });
      qc.invalidateQueries({ queryKey: ['admin', 'sheet-import-logs'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['admin', 'live-stats'] });
    },
  });
}

export function useSheetImportLogs(configId: string | null, limit = 10) {
  return useQuery({
    queryKey: ['admin', 'sheet-import-logs', configId, limit],
    queryFn: () => apiGet<SheetImportLog[]>(`/admin/sheets/configs/${configId}/import-logs?limit=${limit}`),
    enabled: !!configId,
    staleTime: 10_000,
  });
}

// Fresh-leads tab data — drives /dashboard/admin/fresh
export type FreshLeadsScope = 'today' | 'trader' | 'partner' | 'all';
export interface FreshLeadRow {
  id: string; full_name: string | null; phone: string | null; email: string | null;
  city: string | null; state: string | null;
  category: 'partner' | 'trader' | null; source: string | null;
  stage: string; call_status: string;
  campaign_name: string | null; adset_name: string | null; ad_name: string | null;
  campaign_label: string | null; product_tag: string | null;
  meta_form_id: string | null; meta_campaign_id: string | null;
  assigned_to_user_id: string | null; assigned_to_name: string | null; assigned_to_role: string | null;
  created_at: string; assigned_at: string | null;
}
export interface FreshLeadsResponse {
  scope: FreshLeadsScope;
  counts: {
    today_total: number; today_trader: number; today_partner: number;
    trader_total: number; partner_total: number;
    unassigned: number; assigned: number; total_active: number;
  };
  rows: FreshLeadRow[];
  sheet_links: { traders: string | null; partners: string | null };
}
export function useFreshLeads(scope: FreshLeadsScope = 'today', limit = 100) {
  return useQuery({
    queryKey: ['admin', 'fresh-leads', scope, limit],
    queryFn: () => apiGet<FreshLeadsResponse>(`/admin/leads/fresh?scope=${scope}&limit=${limit}`),
    staleTime: 10_000,
    refetchInterval: 30_000, // pulse every 30s — Socket.IO lead:new also forces invalidation
  });
}

export function useToggleAutoImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled, minutes }: { id: string; enabled?: boolean; minutes?: number }) =>
      apiPatch<{ id: string; auto_import_enabled: boolean; auto_import_minutes: number }>(
        `/admin/sheets/configs/${id}/auto-import`,
        { enabled, minutes },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'sheet-configs'] }),
  });
}

// ── Distribution Rules ───────────────────────────────────────────
export function useDistributionRules() {
  return useQuery({
    queryKey: ['admin', 'distribution-rules'],
    queryFn: () => apiGet<any[]>('/rules'),
  });
}

export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; strategy: string; form_id?: string; eligible_user_ids?: string[]; priority?: number }) =>
      apiPost('/rules', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'distribution-rules'] }),
  });
}

export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; strategy?: string; is_active?: boolean; priority?: number }) =>
      apiPatch(`/admin/rules/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'distribution-rules'] }),
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/admin/rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'distribution-rules'] }),
  });
}

// ── Analytics ────────────────────────────────────────────────────
export interface AnalyticsOverview {
  counts: Record<string, number>;
  dailyTrend: { day: string; leads: number; conversions: number; remarks: number }[];
  topPerformers: { id: string; full_name: string; role: string; team_name: string | null; total_leads: number; conversions: number; conv_rate: number }[];
  stageBreakdown: { stage: string; count: number }[];
  statusBreakdown: { call_status: string; count: number }[];
  hourlyToday: { hour: number; count: number }[];
}

export function useAnalyticsOverview() {
  return useQuery({
    queryKey: ['admin', 'analytics-overview'],
    queryFn: () => apiGet<AnalyticsOverview>('/admin/analytics/overview'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export interface ConversionAnalytics {
  byUser: { id: string; full_name: string; role: string; team_name: string | null; total_leads: number; conversions: number; conv_rate: number; avg_response_hours: number | null }[];
  bySource: { source: string; total: number; conversions: number; conv_rate: number }[];
  byCampaign: { campaign: string; total: number; conversions: number; conv_rate: number }[];
}

export function useConversionAnalytics() {
  return useQuery({
    queryKey: ['admin', 'conversion-analytics'],
    queryFn: () => apiGet<ConversionAnalytics>('/admin/analytics/conversions'),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

// ── Followups ────────────────────────────────────────────────────
export interface AdminFollowup {
  id: string; full_name: string; phone: string; source: string; campaign_name: string | null;
  stage: string; call_status: string; next_followup_at: string; assigned_to_user_id: string | null;
  assigned_to_name: string | null;
}

export function useAdminFollowups(type: string) {
  return useQuery({
    queryKey: ['admin', 'followups', type],
    queryFn: () => apiGet<AdminFollowup[]>(`/admin/followups?type=${type}`),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ── Meta Overview ────────────────────────────────────────────────
export function useMetaOverview() {
  return useQuery({
    queryKey: ['admin', 'meta-overview'],
    queryFn: () => apiGet<{ forms: any[]; pages: any[]; campaigns: any[]; recent_leads: any[] }>('/admin/meta/overview'),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

// ── Meta Pages Enriched ─────────────────────────────────────────
export interface MetaPageEnriched {
  id: string; page_id: string; page_name: string; is_active: boolean; has_token: boolean;
  form_count: number; lead_count: number; today_leads: number; conversions: number;
  last_lead_at: string | null; created_at: string;
  token_is_valid?: boolean | null; token_last_checked?: string | null; token_last_error?: string | null;
  webhook_subscribed?: boolean | null; webhook_last_checked?: string | null;
  forms_status?: string | null; forms_last_checked?: string | null;
  stale_at?: string | null; deactivated_at?: string | null;
  connection_status?: 'active' | 'discovered' | 'deactivated' | 'stale';
  selected_at?: string | null; selected_by_user_id?: string | null;
  deactivation_reason?: string | null;
}

export function useGoogleSheetRoutingSettings() {
  return useQuery({
    queryKey: ['admin', 'google-sheet-routing-settings'],
    queryFn: () => apiGet<GoogleSheetRoutingSettings>('/admin/google-sheets/settings'),
    staleTime: 15_000,
  });
}

export function useUpdateGoogleSheetRoutingSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<GoogleSheetRoutingSettings>) => apiPatch<GoogleSheetRoutingSettings>('/admin/google-sheets/settings', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'google-sheet-routing-settings'] });
      qc.invalidateQueries({ queryKey: ['admin', 'sheet-configs'] });
      qc.invalidateQueries({ queryKey: ['admin', 'sheets-connectivity'] });
      qc.invalidateQueries({ queryKey: ['admin', 'sheets-enriched'] });
    },
  });
}

export function useTestGoogleSheetRouting() {
  return useMutation({
    mutationFn: (body: {
      default_sheet_name: string;
      trader_sheet_name: string;
      partner_sheet_name: string;
      unknown_sheet_name: string;
    }) =>
      apiPost<{
        spreadsheet_id: string | null;
        results: {
          default: { sheet_name: string; exists: boolean; header_valid?: boolean; header_missing_columns?: string[] };
          trader: { sheet_name: string; exists: boolean; header_valid?: boolean; header_missing_columns?: string[] };
          partner: { sheet_name: string; exists: boolean; header_valid?: boolean; header_missing_columns?: string[] };
          unknown: { sheet_name: string; exists: boolean; header_valid?: boolean; header_missing_columns?: string[] };
        };
        data?: {
          results?: {
            default: { sheet_name: string; exists: boolean; header_valid?: boolean; header_missing_columns?: string[] };
            trader: { sheet_name: string; exists: boolean; header_valid?: boolean; header_missing_columns?: string[] };
            partner: { sheet_name: string; exists: boolean; header_valid?: boolean; header_missing_columns?: string[] };
            unknown: { sheet_name: string; exists: boolean; header_valid?: boolean; header_missing_columns?: string[] };
          };
        };
        demo_written?: boolean;
        demo_writes?: Record<string, Array<{ sheetName: string; action: string; row?: number | null }>> | null;
        message: string;
      }>('/admin/google-sheets/test-sheet-routing', { ...body, write_demo: true }),
  });
}

export function useCreateMissingGoogleSheetTabs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ created: string[]; existing: string[]; failed: string[] }>('/admin/google-sheets/create-missing-tabs', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'google-sheet-routing-settings'] });
      qc.invalidateQueries({ queryKey: ['admin', 'sheets-connectivity'] });
    },
  });
}

export function useExportLeadsByCategoryToSheets() {
  return useMutation({
    mutationFn: (body: {
      mode: 'dry_run' | 'export_all' | 'not_synced';
      category?: 'all' | 'trader' | 'partner' | 'unknown';
      date_from?: string | null;
      date_to?: string | null;
      skip_duplicates?: boolean;
    }) => apiPost<{ mode: string; summary: Record<string, { sheet_name: string; count: number; upserted?: number; updated?: number; appended?: number }> }>('/admin/google-sheets/export-leads-by-category', body),
  });
}

export function useUpdateCampaignCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ campaignId, category, notes }: { campaignId: string; category: 'trader' | 'partner' | 'unknown'; notes?: string }) =>
      apiPatch(`/admin/campaigns/${campaignId}/category`, { category, notes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] }),
  });
}

export function useBackfillCampaignCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ campaignId, mode }: { campaignId: string; mode: 'dry_run' | 'unknown_only' | 'force_all' }) =>
      apiPost<{ scanned: number; updated: number; skipped: number }>(`/admin/campaigns/${campaignId}/backfill-category`, { mode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useUpdateLeadCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, category, reason }: { leadId: string; category: 'trader' | 'partner' | 'unknown'; reason?: string }) =>
      apiPatch(`/admin/leads/${leadId}/category`, { category, reason }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['lead', variables.leadId] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useBulkUpdateLeadCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadIds, category, reason }: { leadIds: string[]; category: 'trader' | 'partner' | 'unknown'; reason?: string }) =>
      apiPatch('/admin/leads/bulk-category', { lead_ids: leadIds, category, reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useMetaPagesEnriched() {
  return useQuery({
    queryKey: ['admin', 'meta-pages-enriched'],
    queryFn: () => apiGet<MetaPageEnriched[]>('/admin/meta/pages-enriched'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ── Per-page token management ───────────────────────────────────
export interface PageTokenTestResult {
  ok: boolean;
  page_id?: string;
  name?: string;
  category?: string;
  reason?: string;
  meta_code?: number;
  type?: string;
  is_expired?: boolean;
}

export function useTestPageToken() {
  return useMutation({
    mutationFn: (pageId: string) => apiGet<PageTokenTestResult>(`/meta/pages/${pageId}/token-test`),
  });
}

export function useUpdatePageToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pageId, token }: { pageId: string; token: string }) =>
      apiPost(`/meta/pages/${pageId}/update-token`, { pageAccessToken: token, test: true, subscribeWebhook: true, syncForms: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['integration-status'] });
    },
  });
}

// ── Meta Forms Enriched ─────────────────────────────────────────
export interface MetaFormEnriched {
  id: string; form_id: string; form_name: string; page_id: string | null; page_name: string | null;
  campaign_label: string | null; product_tag: string | null; is_active: boolean;
  lead_count: number; today_leads: number; conversions: number; pending_leads: number;
  last_lead_at: string | null; created_at: string;
}

export function useMetaFormsEnriched() {
  return useQuery({
    queryKey: ['admin', 'meta-forms-enriched'],
    queryFn: () => apiGet<MetaFormEnriched[]>('/admin/meta/forms-enriched'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ── Form Leads ──────────────────────────────────────────────────
export function useFormLeads(formId: string | null, filters?: { page?: number; stage?: string; call_status?: string }) {
  const params = new URLSearchParams();
  if (filters?.page) params.set('page', String(filters.page));
  if (filters?.stage) params.set('stage', filters.stage);
  if (filters?.call_status) params.set('call_status', filters.call_status);
  const qs = params.toString();
  return useQuery({
    queryKey: ['admin', 'form-leads', formId, qs],
    queryFn: () => apiGet<{ rows: any[]; total: number; page: number }>(`/admin/meta/form-leads/${formId}${qs ? '?' + qs : ''}`),
    enabled: !!formId,
  });
}

// ── Page Leads ──────────────────────────────────────────────────
export function usePageLeads(pageId: string | null, page?: number) {
  return useQuery({
    queryKey: ['admin', 'page-leads', pageId, page],
    queryFn: () => apiGet<{ rows: any[]; total: number; page: number }>(`/admin/meta/page-leads/${pageId}?page=${page || 1}`),
    enabled: !!pageId,
  });
}

// ── Meta Webhook Logs ───────────────────────────────────────────
export function useMetaWebhookLogs() {
  return useQuery({
    queryKey: ['admin', 'meta-webhook-logs'],
    queryFn: () => apiGet<{ sync_logs: any[]; audit_logs: any[]; activity_logs: any[] }>('/admin/meta/webhook-logs'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ── Google Sheets Enriched ──────────────────────────────────────
export function useSheetsEnriched() {
  return useQuery({
    queryKey: ['admin', 'sheets-enriched'],
    queryFn: () => apiGet<{ config: any; live_status: any; sync_logs: any[]; stats: { total_leads: number; today_leads: number } }>('/admin/sheets/enriched'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ── Meta Token Status ───────────────────────────────────────────
export interface MetaPageTokenStatus {
  page_id: string;
  page_name: string | null;
  status: 'valid' | 'invalid' | 'missing';
  forms_accessible: boolean;
  form_count?: number;
  webhook_subscribed: boolean;
  error?: string;
}

export interface MetaTokenStatus {
  has_page_token: boolean;
  has_user_token: boolean;
  has_app_secret: boolean;
  has_verify_token: boolean;
  connectivity: { connected: boolean; token_source?: string; pages?: number; error?: string };
  error: string | null;
  warning: string | null;
  pageTokens: { valid: number; invalid: number; missing: number; pages: MetaPageTokenStatus[] };
  userToken: { status: 'valid' | 'expired' | 'missing' | 'error'; source: string | null; requiredFor: string[]; error?: string };
  webhook: { status?: 'subscribed' | 'partial' | 'not_subscribed'; subscribed: boolean; subscribed_count?: number; total?: number };
  leadForms: { status?: 'accessible' | 'accessible_empty' | 'partial_error' | 'error'; accessible: boolean; accessible_count?: number; error_count?: number };
  campaignSync: { status: 'available' | 'degraded' | 'error'; required_user_token?: boolean };
  connected?: boolean;
  warnings?: string[];
  ignoredPages?: { total: number; discovered: number; stale: number };
}

export interface MetaSubscriptionStatus {
  page_id: string;
  page_name: string | null;
  status: 'ok' | 'not_subscribed' | 'error';
  subscribed: boolean;
  token_source: 'db_page_token';
  error?: string;
}

export function useMetaTokenStatus() {
  return useQuery({
    queryKey: ['admin', 'meta-token-status'],
    queryFn: () => apiGet<MetaTokenStatus>('/admin/meta/token-status'),
  });
}

export function useSyncMetaPageForms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pageId: string) => apiPost(`/meta/pages/${pageId}/sync-forms`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['integration-status'] });
    },
  });
}

export function useDeactivateMetaPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pageId: string) => apiPost(`/meta/pages/${pageId}/deactivate`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['integration-status'] });
    },
  });
}

export function useSetMetaPageActivation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pageId, isActive }: { pageId: string; isActive: boolean }) =>
      apiPatch(`/admin/meta/pages/${pageId}/activation`, { is_active: isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['integration-status'] });
    },
  });
}

// ── Meta Subscription Status ────────────────────────────────────
export function useMetaSubscriptionStatus() {
  return useQuery({
    queryKey: ['admin', 'meta-subscriptions'],
    queryFn: () => apiGet<MetaSubscriptionStatus[]>('/admin/meta/subscription-status'),
  });
}

// ── Campaigns Enriched ──────────────────────────────────────────
export interface CampaignEnriched {
  id: string; campaign_id: string; campaign_name: string; internal_label: string | null;
  ad_account_id: string | null; is_active: boolean; category: string | null;
  description: string | null; lead_count: number; today_leads: number; conversions: number;
  pending_leads: number; last_lead_at: string | null; connected_form: string | null;
  connected_page: string | null; created_at: string;
  status?: string | null; meta_status?: string | null; effective_status?: string | null; configured_status?: string | null; ui_status?: string | null;
  objective?: string | null; buying_type?: string | null; source?: string | null;
  daily_budget?: number | null; lifetime_budget?: number | null; budget_remaining?: number | null; spend_cap?: number | null;
  impressions?: number | null; reach?: number | null; spend?: number | null; meta_leads?: number | null; cost_per_result?: number | null;
  account_name?: string | null; account_status?: number | null; ad_account_sync_status?: string | null; ad_account_sync_error?: string | null;
  meta_updated_time?: string | null; last_meta_status_checked_at?: string | null; last_synced_at?: string | null; sync_status?: string | null; last_sync_error?: string | null;
  last_metrics_synced_at?: string | null; metrics_error?: string | null;
}

export function useCampaignsEnriched(filters?: { account?: string; status?: string; search?: string }) {
  return useQuery({
    queryKey: ['admin', 'campaigns-enriched', filters?.account || 'all', filters?.status || 'all', filters?.search || ''],
    queryFn: () => apiGet<CampaignEnriched[]>('/admin/meta/campaigns-enriched', {
      account: filters?.account || undefined,
      status: filters?.status && filters.status !== 'all' ? filters.status : undefined,
      search: filters?.search || undefined,
    }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ── Meta Sync Mutations ─────────────────────────────────────────
export interface MetaAdAccount {
  id?: string;
  account_id: string;
  account_name: string | null;
  account_status: number | null;
  currency: string | null;
  business_id: string | null;
  business_name: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  last_sync_error: string | null;
  timezone_name?: string | null;
  amount_spent?: number | null;
  balance?: number | null;
  disable_reason?: number | null;
  campaign_count?: number;
  active_campaign_count?: number;
  paused_campaign_count?: number;
  draft_campaign_count?: number;
  archived_campaign_count?: number;
  deleted_campaign_count?: number;
  sync_status?: string | null;
  updated_at?: string | null;
}

export function useMetaAdAccounts() {
  return useQuery({
    queryKey: ['admin', 'meta-ad-accounts'],
    queryFn: () => apiGet<MetaAdAccount[]>('/meta/ad-accounts'),
    staleTime: 60_000,
  });
}

export function useSyncCampaigns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/meta/sync-campaigns', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['admin', 'meta-ad-accounts'] });
    },
  });
}

export function useSyncMetaAdAccountCampaigns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => apiPost(`/meta/ad-accounts/${accountId}/sync-campaigns`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['admin', 'meta-ad-accounts'] });
    },
  });
}

export function useSyncLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: { form_id?: string; since?: string }) => apiPost('/meta/sync-leads', body || {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin'] }); },
  });
}

export function useUpdateMetaToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      accessToken?: string;
      user_access_token?: string;
      tokenType?: 'user' | 'page';
      refreshPages?: boolean;
      subscribeWebhooks?: boolean;
      syncForms?: boolean;
      syncAdAccounts?: boolean;
      syncCampaigns?: boolean;
      pageAccessToken?: string;
      page_access_token?: string;
      page_id?: string;
    }) => apiPost('/meta/update-token', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin'] }); },
  });
}

export function useSubscribePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pageId: string) => apiPost('/meta/subscriptions', { page_id: pageId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'meta-subscriptions'] }); },
  });
}

// ── User Detail (enhanced) ───────────────────────────────────────
export function useAdminUserDetail(userId: string | null) {
  return useQuery({
    queryKey: ['admin', 'user-detail', userId],
    queryFn: () => apiGet<any>(`/admin/users/${userId}/detail`),
    enabled: !!userId,
  });
}

export function useUpdateUserSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: string; daily_lead_cap?: number; distribution_weight?: number; role?: string; is_available?: boolean; team_name?: string; report_to_id?: string | null }) =>
      apiPost(`/admin/users/${userId}/update-settings`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin'] }); qc.invalidateQueries({ queryKey: ['users'] }); },
  });
}
