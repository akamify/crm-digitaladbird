'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '@/lib/api';

export interface UserProfileUser {
  id: string;
  emp_code?: string | null;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  cp_id?: string | null;
  role: string;
  member_type?: string | null;
  status: string;
  report_to_id?: string | null;
  team_name?: string | null;
  daily_lead_cap?: number | null;
  distribution_weight?: number | null;
  is_available?: boolean | null;
  distribution_blocked?: boolean | null;
  distribution_blocked_reason?: string | null;
  last_login_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  rm_id?: string | null;
  rm_name?: string | null;
  rm_email?: string | null;
}

export interface UserProfileCounts {
  total_assigned_leads?: number;
  pending_leads?: number;
  worked_leads?: number;
  converted_leads?: number;
  lost_not_interested_leads?: number;
  followups_due?: number;
  assigned_today?: number;
  assigned_this_week?: number;
  assigned_this_month?: number;
  requests_pending?: number;
  requests_approved?: number;
  requests_fulfilled?: number;
  reassigned_in_count?: number;
  reassigned_out_count?: number;
  [key: string]: string | number | null | undefined;
}

export interface ProfileSecurity {
  summary?: {
    total_sessions?: number;
    active_sessions?: number;
    last_session_created_at?: string | null;
    last_activity_at?: string | null;
  };
  sessions?: Array<{
    id: string;
    user_agent?: string | null;
    ip_address?: string | null;
    created_at?: string | null;
    expires_at?: string | null;
    revoked_at?: string | null;
    last_activity_at?: string | null;
  }>;
}

export interface EmailHistoryRow {
  id: string;
  email_to: string;
  email_type: string;
  provider: string;
  status: string;
  error_message?: string | null;
  created_at: string;
  sent_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface UserProfileResponse {
  user: UserProfileUser;
  role?: string;
  profileType?: 'admin' | 'rm' | 'member' | 'deleted';
  permissions?: Record<string, boolean>;
  tabs?: string[];
  actions?: string[];
  counts: UserProfileCounts;
  metrics?: UserProfileCounts;
  reportees: UserProfileUser[];
  security?: ProfileSecurity;
  emailHistory?: EmailHistoryRow[];
}

export interface UserPerformanceResponse {
  range: { start: string; end: string };
  summary: {
    assigned: number;
    worked: number;
    pending: number;
    converted: number;
    conversion_rate: string | number;
    overdue_leads: number;
    average_response_time: string | number | null;
    follow_up_completion_rate: string | number | null;
  };
  dailyTrend: Array<{
    date: string;
    assigned_count: number;
    worked_count: number;
    converted_count: number;
    followups_done: number;
  }>;
  callStatusBreakdown: Array<{ status: string; count: number }>;
  sourceBreakdown: Array<{ source?: string | null; meta_form_id?: string | null; form_name?: string | null; count: number }>;
  ranking: null | {
    rank_position?: number | null;
    score?: number | string | null;
    leads_total?: number | null;
    leads_converted?: number | null;
    calls_made?: number | null;
    conv_rate?: number | string | null;
  };
  workload: {
    currently_pending: number;
    overdue_leads: number;
    inactive_assigned_leads: number;
  };
}

export interface ProfileLead {
  id: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  category?: 'trader' | 'partner' | 'unknown';
  category_source?: string | null;
  meta_form_id?: string | null;
  form_name?: string | null;
  campaign_name?: string | null;
  campaign_label?: string | null;
  assigned_at?: string | null;
  call_status?: string | null;
  stage?: string | null;
  is_pending?: boolean | null;
  next_followup_at?: string | null;
  created_at?: string | null;
  last_activity_at?: string | null;
}

export interface ProfileRequest {
  id: string;
  request_type: string;
  requested_quantity: number;
  approved_quantity: number | null;
  fulfilled_quantity: number;
  remaining_quantity: number;
  status: string;
  requested_at: string;
  approved_by?: string | null;
  approved_at?: string | null;
  note?: string | null;
  admin_notes?: string | null;
}

export interface AssignmentHistoryRow {
  id: string;
  lead_id: string;
  lead_name?: string | null;
  campaign_name?: string | null;
  source?: string | null;
  category?: 'trader' | 'partner' | 'unknown';
  category_source?: string | null;
  meta_form_id?: string | null;
  form_name?: string | null;
  assignment_type?: string | null;
  previous_user?: string | null;
  assigned_to?: string | null;
  assigned_by?: string | null;
  reason?: string | null;
  created_at: string;
}

export interface ActivityRow {
  source: string;
  entity: string;
  entity_id: string;
  action: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export function useAdminUserProfile(userId: string) {
  return useQuery({
    queryKey: ['admin', 'user-profile', userId],
    queryFn: () => apiGet<UserProfileResponse>(`/admin/users/${userId}/profile`),
    enabled: Boolean(userId),
  });
}

export function useAdminUserPerformance(userId: string, range: string, enabled = true) {
  return useQuery({
    queryKey: ['admin', 'user-profile', userId, 'performance', range],
    queryFn: () => apiGet<UserPerformanceResponse>(`/admin/users/${userId}/performance`, { range }),
    enabled: Boolean(userId) && enabled,
    staleTime: 30_000,
  });
}

export function useAdminUserLeads(userId: string, params: Record<string, unknown>) {
  return useQuery({
    queryKey: ['admin', 'user-profile', userId, 'leads', params],
    queryFn: () => apiGet<{ rows: ProfileLead[]; total: number; page: number; pageSize: number }>(`/admin/users/${userId}/leads`, params),
    enabled: Boolean(userId),
  });
}

export function useAdminUserRequests(userId: string) {
  return useQuery({
    queryKey: ['admin', 'user-profile', userId, 'requests'],
    queryFn: () => apiGet<ProfileRequest[]>(`/admin/users/${userId}/requests`),
    enabled: Boolean(userId),
  });
}

export function useAdminUserAssignmentHistory(userId: string, params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: ['admin', 'user-profile', userId, 'assignment-history', params],
    queryFn: () => apiGet<AssignmentHistoryRow[]>(`/admin/users/${userId}/assignment-history`, params),
    enabled: Boolean(userId),
  });
}

export function useAdminUserActivity(userId: string) {
  return useQuery({
    queryKey: ['admin', 'user-profile', userId, 'activity'],
    queryFn: () => apiGet<ActivityRow[]>(`/admin/users/${userId}/activity`),
    enabled: Boolean(userId),
  });
}

export function useUpdateAdminUserProfile(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<UserProfileUser>) => apiPatch<UserProfileResponse>(`/admin/users/${userId}/profile`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'user-profile', userId] });
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });
}

export function useForceLogoutUser(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ revoked_sessions: number }>(`/admin/users/${userId}/force-logout`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'user-profile', userId] });
    },
  });
}
