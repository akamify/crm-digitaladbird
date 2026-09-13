'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { DISTRIBUTION_FILTER_KEYS } from '@/lib/leadAnalytics';
import type { LeadAnalyticsScope, LeadFilters } from '@/types';

export type JourneyStage = 'new' | 'response' | 'common_meeting' | 'tte' | 'personal_meeting' | 'quotation';
export type WorkspaceView = 'received' | 'new' | 'worked' | 'pending' | 'unworked' | 'reassigned' | 'call_issues' | 'follow_up' | 'responses' | 'common_meeting' | 'tte' | 'personal_meeting' | 'quotation' | 'converted' | 'cold';

export interface LifecycleAction {
  id: string;
  action_type: string;
  reason: string;
  parent_stage: JourneyStage | null;
  stage_followup_attempt: number | null;
  stage_followup_max: number | null;
  status: string;
  due_at: string;
  scheduled_at: string;
  completed_at: string | null;
  delay_minutes: number | null;
}

export interface LifecycleEvent {
  id: string;
  event_type: string;
  stage_before: string | null;
  stage_after: string | null;
  call_result: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
  user_name: string | null;
}

export interface ActiveCallRetry {
  id: string;
  initial_trigger_reason: string;
  originating_action_id: string | null;
  next_attempt?: { scheduled_at?: string | null } | null;
}

export interface LeadLifecycleResponse {
  enabled: boolean;
  settings: Record<string, string | number>;
  state: {
    lead_id: string;
    journey_stage: JourneyStage;
    terminal_state: 'converted' | 'cold' | null;
    cold_reason: string | null;
    last_call_result: string | null;
    version: number;
    current_action: LifecycleAction | null;
    active_call_retry: ActiveCallRetry | null;
    pending_occurrences: number;
    total_delay_minutes: number;
  longest_delay_minutes: number;
  };
  events: LifecycleEvent[];
  actions: LifecycleAction[];
}

export interface WorkspaceSummary {
  received: number;
  new: number;
  worked: number;
  pending: number;
  unworked: number;
  reassigned: number;
  call_issues: number;
  follow_up: number;
  responses: number;
  common_meeting: number;
  tte: number;
  personal_meeting: number;
  quotation: number;
  converted: number;
  cold: number;
}

export interface WorkspaceLead {
  id: string;
  full_name: string | null;
  phone: string | null;
  source: string | null;
  category: string | null;
  campaign_name: string | null;
  campaign_label: string | null;
  labels: Array<{ id: string; name: string; color: string }>;
  assigned_to_name: string | null;
  journey_stage: JourneyStage;
  terminal_state: string | null;
  last_call_result: string | null;
  current_action_type: string | null;
  current_action_reason: string | null;
  current_action_due_at: string | null;
  next_followup_at: string | null;
  next_retry_at: string | null;
  latest_interaction_at: string | null;
  has_call_issue: boolean;
  is_pending: boolean;
  pending_occurrences: number;
  total_delay_minutes: number;
  longest_delay_minutes: number;
}

function workspaceParams(scope: LeadAnalyticsScope, filters: LeadFilters = {}) {
  const params = new URLSearchParams({ lead_view: scope.view });
  if (scope.view === 'daily' && scope.from && scope.to) {
    params.set('from', scope.from);
    params.set('to', scope.to);
  }
  DISTRIBUTION_FILTER_KEYS.forEach(key => {
    const value = filters[key as keyof LeadFilters];
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  return params;
}

export function useWorkflowSettings() {
  return useQuery({
    queryKey: ['workflow-settings'],
    queryFn: () => apiGet<{ enabled: boolean; globally_enabled: boolean; pilot_user_ids: string[]; settings: Record<string, string | number> }>('/workflow-settings'),
    staleTime: 60_000,
    retry: false,
  });
}

export function useCounselorWorkspaceSummary(scope: LeadAnalyticsScope, filters: LeadFilters = {}, enabled = true) {
  const params = workspaceParams(scope, filters);
  return useQuery({
    queryKey: ['counselor-workspace', 'summary', params.toString()],
    queryFn: () => apiGet<{ enabled: boolean; period: LeadAnalyticsScope; summary: WorkspaceSummary }>(`/counselor-workspace/summary?${params}`),
    enabled,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

export function useCounselorWorkspaceLeads(input: { view: WorkspaceView; scope: LeadAnalyticsScope; filters?: LeadFilters; page: number; enabled?: boolean }) {
  const params = workspaceParams(input.scope, input.filters);
  params.set('view', input.view);
  params.set('page', String(input.page));
  params.set('page_size', '25');
  return useQuery({
    queryKey: ['counselor-workspace', 'leads', params.toString()],
    queryFn: () => apiGet<{ enabled: boolean; summary: WorkspaceSummary; rows: WorkspaceLead[]; total: number; page: number; page_size: number }>(`/counselor-workspace/leads?${params}`),
    enabled: input.enabled !== false,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useLeadLifecycle(leadId: string, enabled = true) {
  return useQuery({
    queryKey: ['lead-lifecycle', leadId],
    queryFn: () => apiGet<LeadLifecycleResponse>(`/leads/${leadId}/lifecycle`),
    enabled: Boolean(leadId) && enabled,
    staleTime: 10_000,
  });
}

function useLifecycleMutation<TInput extends { leadId: string }>(request: (input: TInput) => Promise<LeadLifecycleResponse>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (_data, input) => {
      client.invalidateQueries({ queryKey: ['lead-lifecycle', input.leadId] });
      client.invalidateQueries({ queryKey: ['counselor-workspace'] });
      client.invalidateQueries({ queryKey: ['lead', input.leadId] });
      client.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useRecordLifecycleEvent() {
  return useLifecycleMutation<{
    leadId: string; event_type: string; call_result?: string; reason?: string; expected_version: number;
    idempotency_key: string; next_action?: { action_type: string; due_at: string; reason: string };
  }>(({ leadId, ...body }) => apiPost(`/leads/${leadId}/lifecycle/events`, body));
}

export function useCompleteLifecycleAction() {
  return useLifecycleMutation<{
    leadId: string; actionId: string; outcome: string; event_type?: string; call_result?: string; expected_version: number; idempotency_key: string;
    next_action?: { action_type: string; due_at: string; reason: string };
  }>(({ leadId, actionId, ...body }) => apiPost(`/leads/${leadId}/actions/${actionId}/complete`, body));
}

export function useCloseLifecycle() {
  return useLifecycleMutation<{
    leadId: string; terminal_state: 'converted' | 'cold'; cold_reason?: string; cold_reason_note?: string;
    expected_version: number; idempotency_key: string;
  }>(({ leadId, ...body }) => apiPost(`/leads/${leadId}/lifecycle/close`, body));
}

export function useReopenLifecycle() {
  return useLifecycleMutation<{
    leadId: string; journey_stage: JourneyStage; reason?: string; expected_version: number; idempotency_key: string;
    next_action: { action_type: string; due_at: string; reason: string };
  }>(({ leadId, ...body }) => apiPost(`/leads/${leadId}/lifecycle/reopen`, body));
}

export function useUpdateWorkflowSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPatch('/workflow-settings', body),
    onSuccess: () => client.invalidateQueries({ queryKey: ['workflow-settings'] }),
  });
}
