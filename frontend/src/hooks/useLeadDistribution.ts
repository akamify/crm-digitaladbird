'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type {
  LeadDistributionCounselorResponse,
  LeadDistributionLeadResponse,
  LeadDistributionRmResponse,
} from '@/types';

export type LeadDistributionQuery = Record<string, string | number | undefined | null>;

function queryString(input: LeadDistributionQuery) {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  return params.toString();
}

export function useRmDistribution(input: LeadDistributionQuery) {
  const qs = queryString(input);
  return useQuery({
    queryKey: ['lead-distribution', 'rms', qs],
    queryFn: () => apiGet<LeadDistributionRmResponse>(`/leads/distribution/rms${qs ? `?${qs}` : ''}`),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useRmCounselorDistribution(rmId: string, input: LeadDistributionQuery) {
  const qs = queryString(input);
  return useQuery({
    queryKey: ['lead-distribution', 'rm', rmId, 'counselors', qs],
    queryFn: () => apiGet<LeadDistributionCounselorResponse>(`/leads/distribution/rms/${rmId}/counselors${qs ? `?${qs}` : ''}`),
    enabled: Boolean(rmId),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useCounselorDistributionLeads(
  rmId: string,
  counselorId: string,
  input: LeadDistributionQuery,
) {
  const qs = queryString(input);
  return useQuery({
    queryKey: ['lead-distribution', 'rm', rmId, 'counselor', counselorId, 'leads', qs],
    queryFn: () => apiGet<LeadDistributionLeadResponse>(
      `/leads/distribution/rms/${rmId}/counselors/${counselorId}/leads${qs ? `?${qs}` : ''}`,
    ),
    enabled: Boolean(rmId && counselorId),
    placeholderData: keepPreviousData,
    staleTime: 20_000,
    retry: 1,
  });
}
