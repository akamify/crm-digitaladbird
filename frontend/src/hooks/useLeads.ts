'use client';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import type {
  Lead, LeadDetail, LeadFilters, PageResult, CallStatus, LeadSession,
} from '@/types';

function toQueryString(f: LeadFilters): string {
  const params = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  });
  return params.toString();
}

export function useLeadList(filters: LeadFilters) {
  const qs = toQueryString(filters);
  return useQuery({
    queryKey: ['leads', qs],
    queryFn: () => apiGet<PageResult<Lead>>(`/leads?${qs}`),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: 2,
  });
}

export function useLead(id: string | null | undefined) {
  return useQuery({
    queryKey: ['lead', id],
    queryFn: () => apiGet<LeadDetail>(`/leads/${id}`),
    enabled: !!id,
    staleTime: 10_000,
    retry: 2,
  });
}

export function useLockLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, minutes }: { id: string; minutes?: number }) =>
      apiPost(`/leads/${id}/lock`, { minutes }),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['lead', id] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useUnlockLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => apiPost(`/leads/${id}/unlock`, {}),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['lead', id] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export interface AddRemarkInput {
  id: string;
  remark: string;
  call_status?: CallStatus;
  next_followup_at?: string | null;
  stage?: string;
  release_lock?: boolean;
}

export function useAddRemark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: AddRemarkInput) =>
      apiPost(`/leads/${id}/remarks`, body),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['lead', id] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['workflow', id] });
      qc.invalidateQueries({ queryKey: ['workflow-history', id] });
      qc.invalidateQueries({ queryKey: ['workflow-stats'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

export interface LeadSessionInput {
  session_name: string;
  session_date: string;
  session_time: string;
  timezone?: string;
  notes?: string | null;
}

export function useLeadSessions(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ['lead', leadId, 'sessions'],
    queryFn: () => apiGet<LeadSession[]>(`/leads/${leadId}/sessions`),
    enabled: !!leadId,
    staleTime: 15_000,
    retry: 2,
  });
}

export function useCreateLeadSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, body }: { leadId: string; body: LeadSessionInput }) =>
      apiPost<LeadSession>(`/leads/${leadId}/sessions`, body),
    onSuccess: (_data, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['lead', leadId, 'sessions'] });
    },
  });
}

export function useUpdateLeadSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, sessionId, body }: { leadId: string; sessionId: string; body: Partial<LeadSessionInput> }) =>
      apiPatch<LeadSession>(`/leads/${leadId}/sessions/${sessionId}`, body),
    onSuccess: (_data, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['lead', leadId, 'sessions'] });
    },
  });
}

export function useDeleteLeadSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, sessionId }: { leadId: string; sessionId: string }) =>
      apiDelete(`/leads/${leadId}/sessions/${sessionId}`),
    onSuccess: (_data, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['lead', leadId, 'sessions'] });
    },
  });
}

export interface BulkAddRemarkInput {
  leadIds: string[];
  remark: string;
  call_status?: CallStatus;
  next_followup_at?: string | null;
  stage?: string;
}

export function useBulkAddRemark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadIds, ...body }: BulkAddRemarkInput) =>
      apiPost<{ requested: number; updated: number; skipped: number; skippedReasons: Record<string, string> }>('/leads/bulk/remarks', {
        lead_ids: leadIds,
        ...body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

export interface MetaCampaign {
  campaign_id: string;
  campaign_name: string;
  internal_label: string | null;
  ad_account_id: string | null;
  is_active: boolean;
  category: string | null;
}

/**
 * Fetches distinct campaign names (merged from meta_campaigns + leads tables).
 * Accessible to all authenticated users. Refreshes every 3 minutes.
 */
export function useCampaignNames() {
  return useQuery({
    queryKey: ['campaign-names'],
    queryFn: () => apiGet<string[]>('/campaigns/names'),
    staleTime: 180_000,
    refetchInterval: 180_000,
  });
}

/** Full campaign objects for advanced use. */
export function useMetaCampaigns() {
  return useQuery({
    queryKey: ['meta-campaigns-full'],
    queryFn: () => apiGet<MetaCampaign[]>('/meta/campaigns'),
    staleTime: 180_000,
    refetchInterval: 180_000,
  });
}

export function useAdsetNames() {
  return useQuery({
    queryKey: ['adset-names'],
    queryFn: () => apiGet<string[]>('/campaigns/adsets'),
    staleTime: 60_000,
  });
}

export function useCampaignReport() {
  return useQuery({
    queryKey: ['reports', 'campaign-summary'],
    queryFn: () => apiGet<{ campaign: string; total_leads: string; today_leads: string; conversions: string; conv_rate: string }[]>('/reports/campaign-summary'),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 2,
  });
}

export function useReassignLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userId, reason }: { id: string; userId: string; reason?: string }) =>
      apiPost(`/leads/${id}/reassign`, { user_id: userId, reason }),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['lead', id] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
