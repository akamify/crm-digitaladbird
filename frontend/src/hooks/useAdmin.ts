'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, api } from '@/lib/api';

// --- Live Stats ---
export interface AdminLiveStats {
  total_rms: number; total_members: number; active_users: number; blocked_users: number;
  available_members: number; total_leads: number; unassigned_leads: number; pending_leads: number;
  converted_leads: number; today_leads: number; today_assigned: number; today_conversions: number;
  today_followups: number; overdue_followups: number; pending_lead_requests: number;
  pending_approvals: number; today_remarks: number; today_active_users: number;
  today_broadcasts: number; unread_notifications: number;
}

export function useAdminLiveStats() {
  return useQuery({
    queryKey: ['admin', 'live-stats'],
    queryFn: () => apiGet<AdminLiveStats>('/admin/live-stats'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// --- Activity Logs ---
export interface ActivityLog {
  id: string; user_id: string; user_name: string; user_role: string;
  entity: string; entity_id: string; action: string;
  metadata: Record<string, unknown>; ip_address: string; created_at: string;
  /** Set when the action mutated a known value — admin can see "remark: cnr → so" at-a-glance */
  old_value?: string | null;
  new_value?: string | null;
  /** Raw User-Agent header — frontend can show "Chrome on Windows" via small parser if desired */
  user_agent?: string | null;
  /** Links a row to an auth_sessions entry; lets login/logout pairs be matched */
  session_id?: string | null;
  /** Session enrichment (joined from auth_sessions when session_id is set) */
  login_at?: string | null;
  logout_at?: string | null;
  last_activity_at?: string | null;
  last_activity_ip?: string | null;
  session_duration_secs?: number | null;
}

export function useActivityLogs(params: { page?: number; page_size?: number; entity?: string; action?: string; user_id?: string }) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, String(v)); });
  return useQuery({
    queryKey: ['admin', 'activity-logs', qs.toString()],
    queryFn: () => apiGet<{ rows: ActivityLog[]; total: number; page: number; pageSize: number }>(`/admin/activity-logs?${qs}`),
  });
}

// --- Notifications ---
export interface AdminNotification {
  id: string; type: string; title: string; body: string;
  metadata: Record<string, unknown>; is_read: boolean; created_at: string;
}

export function useAdminNotifications() {
  return useQuery({
    queryKey: ['admin', 'notifications'],
    queryFn: () => apiGet<{ rows: AdminNotification[]; unread_count: number }>('/admin/notifications'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost(`/admin/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'notifications'] }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/admin/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'notifications'] }),
  });
}

// --- Broadcast ---
export interface BroadcastMessage {
  id: string; sender_id: string; sender_name: string; title: string; body: string;
  priority: string; target_role: string; target_user_ids: string[] | null;
  expires_at: string | null; created_at: string;
}

export function useBroadcastMessages(limit = 20) {
  return useQuery({
    queryKey: ['admin', 'broadcast', limit],
    queryFn: () => apiGet<BroadcastMessage[]>(`/admin/broadcast?limit=${limit}`),
  });
}

export function useSendBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; body: string; priority?: string; target_role?: string }) =>
      apiPost('/admin/broadcast', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'broadcast'] }),
  });
}

// --- Reset Password ---
export function useResetPassword() {
  return useMutation({
    mutationFn: ({ userId, new_password }: { userId: string; new_password: string }) =>
      apiPost(`/admin/reset-password/${userId}`, { new_password }),
  });
}

// --- Block / Unblock User ---
export function useBlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason?: string }) =>
      apiPost(`/users/${userId}/block`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['admin'] }); },
  });
}

export function useUnblockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => apiPost(`/users/${userId}/unblock`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['admin'] }); },
  });
}

// --- Force Assign ---
export function useForceAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { lead_ids: string[]; user_id: string; reason?: string }) =>
      apiPost('/admin/leads/bulk-assign', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); qc.invalidateQueries({ queryKey: ['admin'] }); },
  });
}

export function useBulkReassignLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { lead_ids: string[]; user_id: string; reason?: string }) =>
      apiPost('/admin/leads/bulk-reassign', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); qc.invalidateQueries({ queryKey: ['admin'] }); },
  });
}

// --- Unassigned Leads ---
export interface UnassignedLead {
  id: string; full_name: string; phone: string; category: string;
  source: string; stage: string; created_at: string;
}

export function useUnassignedLeads(category?: string) {
  return useQuery({
    queryKey: ['admin', 'unassigned-leads', category],
    queryFn: () => apiGet<{ rows: UnassignedLead[]; total: number }>(`/admin/unassigned-leads${category ? `?category=${category}` : ''}`),
  });
}

// --- Active Members (for dropdowns) ---
export interface ActiveMember {
  id: string; full_name: string; role: 'member'; team_name: string | null;
  member_type: string | null; is_available: boolean; rm_name: string | null;
  lead_count: number; pending_count: number;
}

export function useActiveMembers() {
  return useQuery({
    queryKey: ['admin', 'active-members'],
    queryFn: () => apiGet<ActiveMember[]>('/admin/active-members'),
  });
}

// --- Reassign Member to different RM ---
export function useReassignMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { member_id: string; new_rm_id?: string | null; new_team_name?: string | null }) =>
      apiPost('/admin/reassign-member', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['admin'] }); },
  });
}

// --- Bulk Lead Actions ---
export function useBulkLeadAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { action: string; lead_ids: string[]; params?: Record<string, string> }) =>
      apiPost('/admin/bulk-leads', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); qc.invalidateQueries({ queryKey: ['admin'] }); },
  });
}

// --- Export (these return files, use axios directly) ---
export function exportLeadsCsv(filters?: Record<string, string>) {
  const qs = new URLSearchParams(filters || {}).toString();
  return api.get(`/admin/export/leads${qs ? `?${qs}` : ''}`, { responseType: 'blob' })
    .then(res => downloadBlob(res.data, `leads_export_${new Date().toISOString().slice(0, 10)}.csv`));
}

export function exportReportsCsv() {
  return api.get('/admin/export/reports', { responseType: 'blob' })
    .then(res => downloadBlob(res.data, `team_report_${new Date().toISOString().slice(0, 10)}.csv`));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
