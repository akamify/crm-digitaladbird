'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch } from '@/lib/api';
import type { Role } from '@/types';

export interface MyProfile {
  id: string;
  full_name: string;
  name: string;
  email: string;
  phone: string | null;
  cp_id: string | null;
  role: Role;
  member_type?: string | null;
  status: string;
  account_status: string;
  is_available?: boolean | null;
  availability_status?: 'available' | 'unavailable';
  lead_assignment_status?: string | null;
  report_to_id?: string | null;
  team_name?: string | null;
  reporting_manager?: { id: string; name: string; email?: string | null; phone?: string | null } | null;
  avatar_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_login_at?: string | null;
}

export interface MyProfileStats {
  total_assigned_leads?: number;
  today_assigned_leads?: number;
  contacted_leads?: number;
  pending_not_called_leads?: number;
  converted_leads?: number;
  followups_today?: number;
  followups_due?: number;
  total_team_members?: number;
  available_team_members?: number;
  total_team_assigned_leads?: number;
  today_team_assigned_leads?: number;
  team_converted_leads?: number;
  pending_lead_requests?: number;
  open_support_tickets?: number;
}

export interface MyProfileResponse {
  profile: MyProfile;
  stats: MyProfileStats;
}

export function useMyProfile() {
  return useQuery({
    queryKey: ['my-profile'],
    queryFn: () => apiGet<MyProfileResponse>('/users/me/profile'),
  });
}

export function useUpdateMyProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { full_name?: string; phone?: string }) => apiPatch<MyProfileResponse>('/users/me/profile', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-profile'] });
    },
  });
}
