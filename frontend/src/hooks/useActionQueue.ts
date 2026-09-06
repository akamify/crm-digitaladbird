'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export type ActionQueueType = 'all' | 'overdue_retry' | 'unworked' | 'followup' | 'meeting';
export type ActionQueuePriority = 'urgent' | 'high' | 'medium' | 'normal';

export interface ActionQueueTask {
  task_id: string;
  task_type: Exclude<ActionQueueType, 'all'>;
  title: string;
  reason: string;
  due_at: string | null;
  priority: ActionQueuePriority;
  priority_rank: number;
  age_minutes: number;
  lead_id: string | null;
  lead_name: string | null;
  phone: string | null;
  source: string | null;
  campaign_name: string | null;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  attempt_id: string | null;
  attempt_number: number | null;
  meeting_id: string | null;
  meeting_mode: string | null;
}

export interface ActionQueueResponse {
  scope: 'all' | 'team' | 'self';
  summary: Record<ActionQueueType, number>;
  rows: ActionQueueTask[];
  total: number;
  page: number;
  page_size: number;
}

export function useActionQueue(input: { type: ActionQueueType; page: number; page_size?: number; q?: string }) {
  const params = new URLSearchParams({
    type: input.type,
    page: String(input.page),
    page_size: String(input.page_size || 25),
  });
  if (input.q?.trim()) params.set('q', input.q.trim());
  const queryString = params.toString();

  return useQuery({
    queryKey: ['action-queue', queryString],
    queryFn: () => apiGet<ActionQueueResponse>(`/action-queue?${queryString}`),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchOnMount: 'always',
    refetchInterval: 60_000,
    retry: 1,
  });
}
