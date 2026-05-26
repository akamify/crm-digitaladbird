'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiDelete } from '@/lib/api';

export interface PartnerRequest {
  id: string;
  partner_id: string;
  quantity: number;
  category: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'assigned' | 'completed';
  assigned_rm_id: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolve_note: string | null;
  leads_assigned: number;
  created_at: string;
  updated_at: string;
  partner_name?: string;
  partner_email?: string;
  partner_phone?: string;
  partner_cp_id?: string;
  partner_type?: string;
  team_name?: string;
  rm_name?: string;
  resolved_by_name?: string;
  timeline?: TimelineEntry[];
}

export interface TimelineEntry {
  id: string;
  action: string;
  detail: string;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface PartnerRequestStats {
  total_requests: number;
  pending: number;
  approved_today: number;
  assigned_total: number;
  total_leads_assigned: number;
  active_partners_week: number;
}

export function usePartnerRequests(status?: string, page = 1) {
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  qs.set('page', String(page));
  qs.set('page_size', '25');
  return useQuery({
    queryKey: ['partner-requests', status, page],
    queryFn: () => apiGet<{ rows: PartnerRequest[]; total: number; page: number; pageSize: number }>(
      `/partner-requests?${qs.toString()}`
    ),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function usePartnerRequestDetail(id: string | null) {
  return useQuery({
    queryKey: ['partner-requests', id],
    queryFn: () => apiGet<PartnerRequest & { timeline: TimelineEntry[] }>(`/partner-requests/${id}`),
    enabled: !!id,
  });
}

export function usePartnerRequestStats() {
  return useQuery({
    queryKey: ['partner-request-stats'],
    queryFn: () => apiGet<PartnerRequestStats>('/partner-requests/stats/summary'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useSubmitPartnerRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { quantity: number; category?: string; note?: string }) =>
      apiPost('/partner-requests', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner-requests'] });
      qc.invalidateQueries({ queryKey: ['partner-request-stats'] });
    },
  });
}

export function useApprovePartnerRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      apiPost(`/partner-requests/${id}/approve`, { note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner-requests'] });
      qc.invalidateQueries({ queryKey: ['partner-request-stats'] });
    },
  });
}

export function useRejectPartnerRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      apiPost(`/partner-requests/${id}/reject`, { note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner-requests'] });
      qc.invalidateQueries({ queryKey: ['partner-request-stats'] });
    },
  });
}

export function useAutoAssignPartnerRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost(`/partner-requests/${id}/assign`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner-requests'] });
      qc.invalidateQueries({ queryKey: ['partner-request-stats'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useCancelPartnerRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/partner-requests/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner-requests'] });
      qc.invalidateQueries({ queryKey: ['partner-request-stats'] });
    },
  });
}
