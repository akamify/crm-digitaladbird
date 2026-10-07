'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { sameReportScope } from '@/lib/reportQueryScope';
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
  params.sort();
  return params.toString();
}

export function useRmDistribution(input: LeadDistributionQuery) {
  const {user}=useAuth();
  const qs = queryString({...input,workflow:'true'});
  const queryKey = ['lead-distribution', user?.id, 'rms', qs];
  return useQuery({
    queryKey,
    queryFn: ({signal}) => apiGet<LeadDistributionRmResponse>(`/leads/distribution/rms${qs ? `?${qs}` : ''}`, undefined, {signal}),
    placeholderData: (previous, query) => sameReportScope(query?.queryKey, queryKey, ['page', 'page_size', 'sort', 'order']) ? previous : undefined,
    staleTime: 60_000,
    retry: false,
  });
}

export function useRmCounselorDistribution(rmId: string, input: LeadDistributionQuery) {
  const {user}=useAuth();
  const qs = queryString({...input,workflow:'true'});
  const queryKey = ['lead-distribution', user?.id, 'rm', rmId, 'counselors', qs];
  return useQuery({
    queryKey,
    queryFn: ({signal}) => apiGet<LeadDistributionCounselorResponse>(`/leads/distribution/rms/${rmId}/counselors${qs ? `?${qs}` : ''}`, undefined, {signal}),
    enabled: Boolean(rmId),
    placeholderData: (previous, query) => sameReportScope(query?.queryKey, queryKey, ['page', 'page_size', 'sort', 'order']) ? previous : undefined,
    staleTime: 60_000,
    retry: false,
  });
}

export function useCounselorDistributionLeads(
  rmId: string,
  counselorId: string,
  input: LeadDistributionQuery,
) {
  const {user}=useAuth();
  const qs = queryString({...input,...(user && ['super_admin','admin','rm'].includes(user.role) ? {workflow:'true'} : {})});
  const queryKey = ['lead-distribution', user?.id, 'rm', rmId, 'counselor', counselorId, 'leads', qs];
  return useQuery({
    queryKey,
    queryFn: ({signal}) => apiGet<LeadDistributionLeadResponse>(
      `/leads/distribution/rms/${rmId}/counselors/${counselorId}/leads${qs ? `?${qs}` : ''}`, undefined, {signal},
    ),
    enabled: Boolean(rmId && counselorId),
    placeholderData: (previous, query) => sameReportScope(query?.queryKey, queryKey) ? previous : undefined,
    staleTime: 60_000,
    retry: false,
  });
}
