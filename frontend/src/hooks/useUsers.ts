'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import type { User, Role } from '@/types';

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => apiGet<User[]>('/users'),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
}

export function useUserHierarchy() {
  return useQuery({
    queryKey: ['users', 'hierarchy'],
    queryFn: () => apiGet<User[]>('/users/hierarchy'),
  });
}

export interface CreateUserInput {
  full_name: string;
  email: string;
  phone: string;
  role: Role;
  report_to_id?: string | null;
  team_name?: string | null;
  daily_lead_cap?: number | null;
  distribution_weight?: number | null;
  sendWelcomeEmail?: boolean;
}

export interface BulkUserImportRow {
  row_number: number;
  full_name?: string;
  email?: string;
  phone?: string;
  role?: string;
  reporting_rm?: string;
  report_to_id?: string;
  team_name?: string;
}

export interface BulkUserImportResult {
  role: 'rm' | 'member';
  requested: number;
  created: number;
  failed: number;
  results: Array<{
    row_number: number;
    status: 'created' | 'failed';
    user?: User;
    emailWarning?: string | null;
    code?: string;
    reason?: string;
    input?: { full_name: string | null; email: string | null };
  }>;
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserInput) => apiPost<User>('/users', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<CreateUserInput> & { is_available?: boolean; is_active?: boolean }) =>
      apiPatch<User>(`/users/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => apiPost(`/users/${id}/delete`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useBulkImportUsers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { role: 'rm' | 'member'; rows: BulkUserImportRow[]; sendWelcomeEmail?: boolean }) =>
      apiPost<BulkUserImportResult>('/users/bulk-import', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateLeadAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, status, reason }: { userId: string; status: 'available' | 'unavailable' | 'blocked' | 'disabled'; reason?: string }) =>
      apiPatch<{ user: User }>(`/users/${userId}/lead-availability`, {
        lead_assignment_status: status,
        is_available: status === 'available',
        reason,
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['admin', 'user-profile', variables.userId] });
      qc.invalidateQueries({ queryKey: ['admin', 'assignment-overview'] });
    },
  });
}

export function useBulkUpdateLeadAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userIds, isAvailable }: { userIds: string[]; isAvailable: boolean }) =>
      apiPatch<{ updatedUsers: User[]; updatedMembersByRmCascade: Record<string, User[]>; targetRole: 'rm' | 'member'; isAvailable: boolean }>('/users/lead-availability/bulk', {
        user_ids: userIds,
        is_available: isAvailable,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['admin', 'assignment-overview'] });
    },
  });
}

export function useDeletedUsers() {
  return useQuery({
    queryKey: ['users', 'deleted'],
    queryFn: () => apiGet<User[]>('/users/deleted'),
  });
}

export function useSendPasswordResetLink() {
  return useMutation({
    mutationFn: (userId: string) => apiPost<{ message: string }>(`/admin/users/${userId}/send-password-reset`),
  });
}

export function useSendOnboardingEmail() {
  return useMutation({
    mutationFn: (userId: string) => apiPost<{ message: string }>(`/admin/users/${userId}/send-onboarding-email`),
  });
}
