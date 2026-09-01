'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export interface CounselorReportFilters { from?: string; to?: string; source?: string; category?: string; stage?: string; campaign?: string; counselor?: string; rm?: string; team?: string; }
export interface Quality { score: number; label: string; components: Record<string, number | null>; }
export interface ReportRate { value: number; numerator: number; denominator: number; }
export interface CounselorReportRow {
  id: string; full_name: string; rm_name?: string | null; team_name?: string | null;
  total_received: number; reassigned_out: number; current_assigned: number; worked: number; unworked: number;
  current_contacted: number; attributed_contacted: number; contactable_received: number;
  unresolved_call_issues: number; terminal_lead_quality_issues: number; actionable_pending: number;
  upcoming_calls: number; converted: number; personal_meetings: number; overdue_attempts: number;
  completed_attempts: number; on_time_attempts: number; average_delay_minutes: number;
  attempt_due_count: number; attempt_completed_count: number; attempt_missed_count: number; attempt_upcoming_count: number; attempt_compliance_pct: number | null;
  new_unworked: number; needs_action_unworked: number; delayed_unworked: number; critical_unworked: number;
  raw_contact_rate: ReportRate; actionable_contact_rate: ReportRate; work_coverage_rate: ReportRate; followup_discipline_rate: ReportRate; progression_rate: ReportRate; call_issue_rate: ReportRate; quality: Quality;
  call_issues?: { unresolved_total: number; retryable_total: number; terminal_quality_total: number; buckets: Record<string, number>; retryable_buckets?: Record<string, number>; terminal_quality_buckets?: Record<string, number>; };
}
export interface ReportSummary { total_counselors: number; total_received: number; current_assigned: number; worked: number; unworked: number; actionable_pending: number; current_contacted: number; unresolved_call_issues: number; terminal_lead_quality_issues: number; converted: number; personal_meetings: number; overdue_attempts: number; }
export interface TeamRow extends Omit<CounselorReportRow, 'id' | 'full_name' | 'rm_name' | 'team_name'> { rm_id?: string | null; rm_name: string; team_name: string; members: number; aggregation_label: string; }
export interface CounselorReportFilterOptions {
  users: Array<{ id: string; full_name: string; role: string; report_to_id?: string | null; team_name?: string | null }>;
  call_issues: Array<{ key: string; label: string }>;
}
export interface CounselorReportLead {
  id: string; full_name: string; phone?: string | null; source?: string | null; campaign_name?: string | null;
  campaign_label?: string | null; assigned_at?: string | null; reassigned_at?: string | null; reassigned_to_name?: string | null; call_status?: string | null;
  effective_status?: string | null; last_action_at?: string | null; next_followup_at?: string | null; next_attempt_at?: string | null;
  metric_reason?: string | null; aging_state?: string | null;
  attempt_tracking?: 'tracked' | 'none';
  attempts?: Array<{ attempt_number: number; retry_number?: number; attempt_state: 'initial_issue' | 'completed' | 'missed' | 'upcoming' | 'not_required'; scheduled_at?: string | null; attempted_at?: string | null; outcome?: string | null; attributed_to_counselor?: boolean }>;
}
export interface CounselorReportDrilldown { rows: CounselorReportLead[]; total: number; page: number; page_size: number; }

function queryString(filters: CounselorReportFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  return params.toString();
}

function withQuery(path: string, qs: string) { return qs ? `${path}?${qs}` : path; }

export function useCounselorReport(filters: CounselorReportFilters, includeTeams = false) {
  const qs = queryString(filters);
  const options = { staleTime: 15_000, refetchInterval: 60_000, retry: 1 };
  return {
    summary: useQuery({ queryKey: ['counselor-report', 'summary', qs], queryFn: () => apiGet<ReportSummary>(withQuery('/counselor-report/summary', qs)), ...options }),
    counselors: useQuery({ queryKey: ['counselor-report', 'counselors', qs], queryFn: () => apiGet<CounselorReportRow[]>(withQuery('/counselor-report/counselors', qs)), ...options }),
    teams: useQuery({ queryKey: ['counselor-report', 'teams', qs], queryFn: () => apiGet<TeamRow[]>(withQuery('/counselor-report/rm-teams', qs)), enabled: includeTeams, ...options }),
    filterOptions: useQuery({ queryKey: ['counselor-report', 'filters'], queryFn: () => apiGet<CounselorReportFilterOptions>('/counselor-report/filters'), staleTime: 60_000, retry: 1 }),
  };
}

export function useCounselorReportDrilldown(filters: CounselorReportFilters, request?: { counselorId: string; metric?: string; issueType?: string; attemptStatus?: string; attemptNumber?: number; page?: number }) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  if (request?.counselorId) params.set('counselor_id', request.counselorId);
  if (request?.metric) params.set('metric', request.metric);
  if (request?.issueType) params.set('call_issue_type', request.issueType);
  if (request?.attemptStatus) params.set('attempt_status', request.attemptStatus);
  if (request?.attemptNumber) params.set('attempt_number', String(request.attemptNumber));
  if (request?.page) params.set('page', String(request.page));
  params.set('page_size', '25');
  return useQuery({
    queryKey: ['counselor-report', 'leads', params.toString()],
    queryFn: () => apiGet<CounselorReportDrilldown>(`/counselor-report/leads?${params.toString()}`),
    enabled: Boolean(request?.counselorId),
    staleTime: 15_000,
    retry: 1,
  });
}
