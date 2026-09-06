'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { LeadFilters, LeadSavedView } from '@/types';

export function useLeadSavedViews() {
  return useQuery({
    queryKey: ['lead-saved-views'],
    queryFn: () => apiGet<LeadSavedView[]>('/lead-saved-views'),
    staleTime: 60_000,
    retry: 2,
  });
}

export function useCreateLeadSavedView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; filters: LeadFilters }) => apiPost<LeadSavedView>('/lead-saved-views', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-saved-views'] }),
  });
}

export function useUpdateLeadSavedView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; filters?: LeadFilters }) => apiPatch<LeadSavedView>(`/lead-saved-views/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-saved-views'] }),
  });
}

export function useDeleteLeadSavedView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete<{ id: string; name: string }>(`/lead-saved-views/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-saved-views'] }),
  });
}
