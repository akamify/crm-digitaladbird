'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Role } from '@/types';

export type SupportTicketStatus = 'open' | 'solved' | 'not_solved';

export interface SupportTicketHistory {
  id: string;
  action: string;
  status?: SupportTicketStatus | null;
  adminNote?: string | null;
  admin_note?: string | null;
  actorName?: string | null;
  createdAt: string;
  created_at: string;
}

export interface SupportTicket {
  id: string;
  ticketNo: string;
  ticket_no: string;
  name: string;
  email: string;
  phone: string;
  cpId?: string | null;
  cp_id?: string | null;
  role: Role;
  subject: string;
  body: string;
  status: SupportTicketStatus;
  lastAdminNote?: string | null;
  last_admin_note?: string | null;
  solvedAt?: string | null;
  solved_at?: string | null;
  notSolvedAt?: string | null;
  not_solved_at?: string | null;
  resolvedByName?: string | null;
  createdAt: string;
  created_at: string;
  updatedAt: string;
  updated_at: string;
  history?: SupportTicketHistory[];
}

export interface SupportTicketFilters {
  status?: string;
  role?: string;
  search?: string;
  sort?: string;
  page?: number;
  page_size?: number;
}

export interface SupportTicketPage {
  rows: SupportTicket[];
  pagination: { page: number; page_size: number; total: number };
}

async function getPaged(url: string, params: SupportTicketFilters): Promise<SupportTicketPage> {
  const { data } = await api.get(url, { params });
  return {
    rows: data.data || [],
    pagination: data.pagination || { page: params.page || 1, page_size: params.page_size || 20, total: 0 },
  };
}

export function useMySupportTickets(filters: SupportTicketFilters) {
  return useQuery({
    queryKey: ['support-tickets', 'mine', filters],
    queryFn: () => getPaged('/support/tickets', filters),
    placeholderData: previous => previous,
  });
}

export function useAdminSupportTickets(filters: SupportTicketFilters) {
  return useQuery({
    queryKey: ['support-tickets', 'admin', filters],
    queryFn: () => getPaged('/admin/support-tickets', filters),
    placeholderData: previous => previous,
  });
}

export function useSupportTicket(ticketId?: string | null, admin = false) {
  return useQuery({
    queryKey: ['support-ticket', admin ? 'admin' : 'mine', ticketId],
    queryFn: async () => {
      const { data } = await api.get(admin ? `/admin/support-tickets/${ticketId}` : `/support/tickets/${ticketId}`);
      return data.data as SupportTicket;
    },
    enabled: Boolean(ticketId),
  });
}

export function useCreateSupportTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { phone: string; subject: string; description: string }) => {
      const { data } = await api.post('/support/tickets', body);
      return data.data as SupportTicket;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support-tickets', 'mine'] });
    },
  });
}

export function useUpdateSupportTicketStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ticketId, status, adminNote }: { ticketId: string; status: 'solved' | 'not_solved'; adminNote: string }) => {
      const { data } = await api.patch(`/admin/support-tickets/${ticketId}/status`, { status, admin_note: adminNote });
      return data.data as SupportTicket;
    },
    onSuccess: (ticket) => {
      qc.invalidateQueries({ queryKey: ['support-tickets', 'admin'] });
      qc.invalidateQueries({ queryKey: ['support-ticket', 'admin', ticket.id] });
    },
  });
}
