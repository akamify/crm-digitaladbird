'use client';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type {
  SummaryKpi, DailyPoint, UserPerformance, FunnelStage, SourceStat,
} from '@/types';

export function useSummary(params: { from?: string; to?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to)   qs.set('to', params.to);
  const s = qs.toString();
  return useQuery({
    queryKey: ['reports', 'summary', s],
    queryFn: () => apiGet<SummaryKpi>(`/reports/summary${s ? `?${s}` : ''}`),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 2,
  });
}

export function useDaily(days = 14) {
  return useQuery({
    queryKey: ['reports', 'daily', days],
    queryFn: () => apiGet<DailyPoint[]>(`/reports/daily?days=${days}`),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 2,
  });
}

export function useByUser() {
  return useQuery({
    queryKey: ['reports', 'by-user'],
    queryFn: () => apiGet<UserPerformance[]>('/reports/by-user'),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 2,
  });
}

export function useFunnel() {
  return useQuery({
    queryKey: ['reports', 'funnel'],
    queryFn: () => apiGet<FunnelStage[]>('/reports/funnel'),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 2,
  });
}

export function useSources() {
  return useQuery({
    queryKey: ['reports', 'sources'],
    queryFn: () => apiGet<SourceStat[]>('/reports/sources'),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 2,
  });
}

export interface CategoryStat {
  category: 'trader' | 'partner' | 'unknown';
  total: number;
  conversions: number;
  pending: number;
  followups_due: number;
}

export function useCategories() {
  return useQuery({
    queryKey: ['reports', 'categories'],
    queryFn: () => apiGet<CategoryStat[]>('/reports/categories'),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 2,
  });
}
