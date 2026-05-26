'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import type { User, Role } from '@/types';

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => apiGet<User[]>('/users'),
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
    mutationFn: (id: string) => apiDelete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}
