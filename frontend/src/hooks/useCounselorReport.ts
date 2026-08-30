'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export interface CounselorReportFilters { from?: string; to?: string; source?: string; category?: string; stage?: string; campaign?: string; }
export interface Quality { score: number; label: string; components: Record<string, number | null>; }
export interface ReportRate { value: number; numerator: number; denominator: number; }
export interface CounselorReportRow {
  id: string; full_name: string; rm_name?: string | null; team_name?: string | null;
  total_received: number; current_assigned: number; worked: number; unworked: number;
  current_contacted: number; attributed_contacted: number; contactable_received: number;
  unresolved_call_issues: number; terminal_lead_quality_issues: number; actionable_pending: number;
  upcoming_calls: number; converted: number; personal_meetings: number; overdue_attempts: number;
  completed_attempts: number; on_time_attempts: number; average_delay_minutes: number;
  new_unworked: number; needs_action_unworked: number; delayed_unworked: number; critical_unworked: number;
  raw_contact_rate: ReportRate; actionable_contact_rate: ReportRate; work_coverage_rate: ReportRate; followup_discipline_rate: ReportRate; progression_rate: ReportRate; call_issue_rate: ReportRate; quality: Quality;
  call_issues?: { unresolved_total: number; retryable_total: number; terminal_quality_total: number; buckets: Record<string, number>; };
}
export interface ReportSummary { total_counselors: number; total_received: number; current_assigned: number; worked: number; unworked: number; actionable_pending: number; current_contacted: number; unresolved_call_issues: number; terminal_lead_quality_issues: number; converted: number; personal_meetings: number; overdue_attempts: number; }
export interface TeamRow extends Omit<CounselorReportRow, 'id' | 'full_name' | 'rm_name' | 'team_name'> { rm_id?: string | null; rm_name: string; team_name: string; members: number; aggregation_label: string; }

function queryString(filters: CounselorReportFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  return params.toString();
}

export function useCounselorReport(filters: CounselorReportFilters) {
  const qs = queryString(filters);
  const options = { staleTime: 15_000, refetchInterval: 60_000, retry: 1 };
  return {
    summary: useQuery({ queryKey: ['counselor-report', 'summary', qs], queryFn: () => apiGet<ReportSummary>(`/counselor-report/summary?${qs}`), ...options }),
    counselors: useQuery({ queryKey: ['counselor-report', 'counselors', qs], queryFn: () => apiGet<CounselorReportRow[]>(`/counselor-report/counselors?${qs}`), ...options }),
    teams: useQuery({ queryKey: ['counselor-report', 'teams', qs], queryFn: () => apiGet<TeamRow[]>(`/counselor-report/rm-teams?${qs}`), ...options }),
  };
}
