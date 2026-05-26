'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';

// ── Campaign Management ──────────────────────────────────────────
export interface AdminCampaign {
  id: string; campaign_id: string; campaign_name: string; internal_label: string | null;
  ad_account_id: string | null; is_active: boolean; category: string | null; created_at: string;
  total_leads: number; today_leads: number; conversions: number; pending_leads: number;
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
}

export function useMetaPagesEnriched() {
  return useQuery({
    queryKey: ['admin', 'meta-pages-enriched'],
    queryFn: () => apiGet<MetaPageEnriched[]>('/admin/meta/pages-enriched'),
    staleTime: 30_000,
    refetchInterval: 60_000,
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
export function useMetaTokenStatus() {
  return useQuery({
    queryKey: ['admin', 'meta-token-status'],
    queryFn: () => apiGet<any>('/admin/meta/token-status'),
  });
}

// ── Meta Subscription Status ────────────────────────────────────
export function useMetaSubscriptionStatus() {
  return useQuery({
    queryKey: ['admin', 'meta-subscriptions'],
    queryFn: () => apiGet<any[]>('/admin/meta/subscription-status'),
  });
}

// ── Campaigns Enriched ──────────────────────────────────────────
export interface CampaignEnriched {
  id: string; campaign_id: string; campaign_name: string; internal_label: string | null;
  ad_account_id: string | null; is_active: boolean; category: string | null;
  description: string | null; lead_count: number; today_leads: number; conversions: number;
  pending_leads: number; last_lead_at: string | null; connected_form: string | null;
  connected_page: string | null; created_at: string;
}

export function useCampaignsEnriched() {
  return useQuery({
    queryKey: ['admin', 'campaigns-enriched'],
    queryFn: () => apiGet<CampaignEnriched[]>('/admin/meta/campaigns-enriched'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ── Meta Sync Mutations ─────────────────────────────────────────
export function useSyncCampaigns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/meta/sync-campaigns', {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin'] }); },
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
    mutationFn: (body: { user_access_token?: string; page_access_token?: string }) => apiPost('/meta/update-token', body),
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
