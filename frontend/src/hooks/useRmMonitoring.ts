'use client';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export interface TeamMemberOverview {
  id: string;
  full_name: string;
  email: string;
  role: string;
  member_type: string | null;
  team_name: string | null;
  is_available: boolean;
  status: string;
  leads_received_total: number;
  leads_received_today: number;
  leads_pending: number;
  leads_worked: number;
  leads_converted: number;
  leads_remaining: number;
  conv_rate: number;
  requests_total: number;
  requests_today: number;
  requests_pending: number;
  last_remark_at: string | null;
  remarks_today: number;
  is_active_today: boolean;
}

export interface RmLiveCounters {
  requests_today: number;
  requests_pending: number;
  leads_distributed_today: number;
  leads_total: number;
  team_size: number;
  active_today: number;
  pending_work_users: number;
  members_waiting: number;
  conversions_today: number;
  top_active_member: { id: string; full_name: string; activity: number } | null;
  top_conversion_member: { id: string; full_name: string; conversions: number } | null;
}

export interface MemberRequest {
  request_source: 'member' | 'partner';
  id: string;
  user_id: string;
  quantity: number;
  category: string | null;
  status: string;
  leads_assigned: number;
  note: string | null;
  created_at: string;
  updated_at: string | null;
  full_name: string;
  email: string;
  member_type: string | null;
  team_name: string | null;
  role: string;
  member_leads_total: number;
  member_leads_today: number;
  member_leads_pending: number;
  member_leads_worked: number;
  member_leads_converted: number;
}

export function useRmLiveCounters() {
  return useQuery({
    queryKey: ['rm-monitoring', 'live-counters'],
    queryFn: () => apiGet<RmLiveCounters>('/rm-monitoring/live-counters'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useTeamOverview() {
  return useQuery({
    queryKey: ['rm-monitoring', 'team-overview'],
    queryFn: () => apiGet<TeamMemberOverview[]>('/rm-monitoring/team-overview'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useMemberRequests(category?: string) {
  const qs = category ? `?category=${category}` : '';
  return useQuery({
    queryKey: ['rm-monitoring', 'member-requests', category],
    queryFn: () => apiGet<MemberRequest[]>(`/rm-monitoring/member-requests${qs}`),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
