'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiDelete } from '@/lib/api';

export interface LeadRequest {
  id: string;
  user_id: string;
  quantity: number;
  category: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'fulfilled';
  note: string | null;
  resolved_by: string | null;
  resolved_by_name: string | null;
  resolve_note: string | null;
  leads_assigned: number;
  created_at: string;
  updated_at: string | null;
  resolved_at: string | null;
  // joined fields for admin/rm view
  full_name?: string;
  email?: string;
  team_name?: string;
  member_type?: string;
}

export interface LeadRequestStats {
  available_leads: number;
  my_leads: number;
  my_pending: number;
  my_pending_request: LeadRequest | null;
  pending_requests: number;
  distribution_enabled: boolean;
  rm_pool_count: number;
  rm_pending_requests: number;
}

// ─── RM Lead Request Types ──────────────────────────────────────────
export interface RmLeadRequest {
  id: string;
  rm_id: string;
  quantity: number;
  category: string | null;
  fulfilled_count: number;
  status: 'pending' | 'partial' | 'fulfilled' | 'cancelled';
  note: string | null;
  created_at: string;
  updated_at: string;
  rm_name?: string;
  team_name?: string;
}

export interface RmPoolStats {
  pool_count: number;
  assigned_count: number;
  pending_requests: number;
  pending_quantity: number;
}

export interface PoolLead {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  category: string;
  source: string;
  campaign_label: string;
  stage: string;
  created_at: string;
  pool_assigned_at: string;
}

export function useLeadRequestStats() {
  return useQuery({
    queryKey: ['lead-request-stats'],
    queryFn: () => apiGet<LeadRequestStats>('/lead-requests/stats'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useMyLeadRequests() {
  return useQuery({
    queryKey: ['lead-requests', 'my'],
    queryFn: () => apiGet<LeadRequest[]>('/lead-requests/my'),
  });
}

export function usePendingLeadRequests() {
  return useQuery({
    queryKey: ['lead-requests', 'pending'],
    queryFn: () => apiGet<LeadRequest[]>('/lead-requests?status=pending'),
  });
}

export function useSubmitLeadRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { quantity: number; category?: string; note?: string }) =>
      apiPost('/lead-requests', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-requests'] });
      qc.invalidateQueries({ queryKey: ['lead-request-stats'] });
    },
  });
}

export function useApproveLeadRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      apiPost(`/lead-requests/${id}/approve`, { note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-requests'] });
      qc.invalidateQueries({ queryKey: ['lead-request-stats'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useRejectLeadRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      apiPost(`/lead-requests/${id}/reject`, { note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-requests'] });
      qc.invalidateQueries({ queryKey: ['lead-request-stats'] });
    },
  });
}

export function useCancelLeadRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/lead-requests/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-requests'] });
      qc.invalidateQueries({ queryKey: ['lead-request-stats'] });
    },
  });
}

/** RM: view all team member request activity (recent requests, all statuses). */
export function useTeamRequestActivity() {
  return useQuery({
    queryKey: ['lead-requests', 'team-activity'],
    queryFn: () => apiGet<LeadRequest[]>('/lead-requests/team-activity'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ─── RM Lead Request Hooks ──────────────────────────────────────────

export function useSubmitRmLeadRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { quantity: number; category?: string; note?: string }) =>
      apiPost<RmLeadRequest>('/rm-lead-requests', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rm-lead-requests'] });
      qc.invalidateQueries({ queryKey: ['rm-pool'] });
      qc.invalidateQueries({ queryKey: ['lead-request-stats'] });
    },
  });
}

export function useMyRmLeadRequests() {
  return useQuery({
    queryKey: ['rm-lead-requests', 'my'],
    queryFn: () => apiGet<RmLeadRequest[]>('/rm-lead-requests/my'),
  });
}

export function useCancelRmLeadRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/rm-lead-requests/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rm-lead-requests'] });
      qc.invalidateQueries({ queryKey: ['rm-pool'] });
      qc.invalidateQueries({ queryKey: ['lead-request-stats'] });
    },
  });
}

export function useAllRmLeadRequests(status?: string) {
  const qs = status ? `?status=${status}` : '';
  return useQuery({
    queryKey: ['rm-lead-requests', 'all', status],
    queryFn: () => apiGet<RmLeadRequest[]>(`/rm-lead-requests${qs}`),
  });
}

// ─── RM Pool Hooks ──────────────────────────────────────────────────

export function useRmPoolStats() {
  return useQuery({
    queryKey: ['rm-pool', 'stats'],
    queryFn: () => apiGet<RmPoolStats>('/rm-pool/stats'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useRmPoolLeads(page = 1) {
  return useQuery({
    queryKey: ['rm-pool', 'leads', page],
    queryFn: () => apiGet<{ rows: PoolLead[]; total: number; page: number }>(`/rm-pool/leads?page=${page}`),
  });
}

export function useAssignFromPool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { lead_id: string; member_id: string }) =>
      apiPost('/rm-pool/assign', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rm-pool'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead-request-stats'] });
    },
  });
}
