'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';

export interface ClientAccount {
  id: string;
  user_id: string;
  full_name: string;
  name?: string;
  email: string;
  phone: string | null;
  role: 'client';
  status: string;
  active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  last_login_at?: string | null;
  pages_count: number;
  ad_accounts_count: number;
  campaigns_count: number;
  leads_count: number;
  open_support_tickets: number;
  email_warning?: string | null;
}

export interface ClientPage {
  rows: ClientAccount[];
  pagination: { page: number; page_size: number; total: number };
}

export interface ClientDetail {
  client: ClientAccount;
  meta: {
    pages: Array<Record<string, unknown>>;
    ad_accounts: Array<Record<string, unknown>>;
    campaigns: Array<Record<string, unknown>>;
  };
  leads_summary: { recent: Array<Record<string, unknown>> };
  support_history: Array<Record<string, unknown>>;
}

export interface ClientInput {
  name?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  user_id?: string;
  active?: boolean;
  status?: string;
}

export function useClients(filters: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: ['admin', 'clients', filters],
    queryFn: async () => {
      const response = await api.get('/admin/clients', { params: filters });
      const data = response.data.data || [];
      return {
        rows: data,
        pagination: response.data.pagination || { page: 1, page_size: 20, total: data.length },
      } as ClientPage;
    },
    placeholderData: previous => previous,
  });
}

export function useClientDetail(clientId?: string | null) {
  return useQuery({
    queryKey: ['admin', 'client', clientId],
    queryFn: () => apiGet<ClientDetail>(`/admin/clients/${clientId}`),
    enabled: Boolean(clientId),
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ClientInput) => apiPost<ClientAccount>('/admin/clients', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'clients'] }),
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, ...body }: ClientInput & { clientId: string }) => apiPatch<ClientAccount>(`/admin/clients/${clientId}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['admin', 'clients'] });
      qc.invalidateQueries({ queryKey: ['admin', 'client', variables.clientId] });
    },
  });
}

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => apiDelete(`/admin/clients/${clientId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'clients'] }),
  });
}

export function useClientStatusAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, active }: { clientId: string; active: boolean }) =>
      apiPost(`/admin/clients/${clientId}/${active ? 'activate' : 'deactivate'}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'clients'] }),
  });
}

export function useResetClientPassword() {
  return useMutation({
    mutationFn: (clientId: string) => apiPost(`/admin/clients/${clientId}/reset-password`, {}),
  });
}

export function useClientDashboard() {
  return useQuery({
    queryKey: ['client', 'dashboard'],
    queryFn: () => apiGet<Record<string, number | string>>('/client/dashboard'),
    refetchInterval: 60_000,
  });
}

export function useClientMeta() {
  return useQuery({
    queryKey: ['client', 'meta'],
    queryFn: () => apiGet<ClientDetail['meta']>('/client/meta'),
    refetchInterval: 120_000,
  });
}
