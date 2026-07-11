'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost } from '@/lib/api';

export interface LeadLabel {
  id: string;
  name: string;
  color: string;
  visibility: 'global' | 'custom';
  created_by_user_id: string;
  created_by_name?: string;
  created_by_role?: string;
  lead_count?: number;
  assigned_at?: string;
}

export function useLeadLabels(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ['lead-labels', leadId],
    queryFn: () => apiGet<LeadLabel[]>(`/leads/${leadId}/labels`),
    enabled: !!leadId,
  });
}

export function useLabels() {
  return useQuery({ queryKey: ['labels'], queryFn: () => apiGet<LeadLabel[]>('/lead-labels') });
}

export function useCreateLeadLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; color: string; visibility?: 'global' | 'custom' }) => apiPost<LeadLabel>('/lead-labels', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['labels'] }),
  });
}

export function useAssignLeadLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, labelId }: { leadId: string; labelId: string }) => apiPost<LeadLabel>(`/leads/${leadId}/labels`, { label_id: labelId }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['lead-labels', variables.leadId] });
      queryClient.invalidateQueries({ queryKey: ['labels'] });
    },
  });
}

export function useRemoveLeadLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, labelId }: { leadId: string; labelId: string }) => apiDelete(`/leads/${leadId}/labels/${labelId}`),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['lead-labels', variables.leadId] });
      queryClient.invalidateQueries({ queryKey: ['labels'] });
    },
  });
}
