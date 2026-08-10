'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { CustomerNote, CustomerNoteFilters, PageResult, UpcomingMeetingSummary, User } from '@/types';

function toQueryString(filters: CustomerNoteFilters): string {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  return params.toString();
}

function invalidateNotes(qc: ReturnType<typeof useQueryClient>, noteId?: string | null) {
  qc.invalidateQueries({ queryKey: ['customer-notes'] });
  if (noteId) qc.invalidateQueries({ queryKey: ['customer-note', noteId] });
  qc.invalidateQueries({ queryKey: ['leads'] });
  qc.invalidateQueries({ queryKey: ['customer-notes', 'upcoming-meetings'] });
}

export interface CustomerNoteInput {
  lead_id?: string | null;
  customer_phone?: string | null;
  customer_name?: string | null;
  customer_second_name?: string | null;
  business_name?: string | null;
  about_client?: string | null;
  client_services_want?: string | null;
  client_budget?: string | null;
  meeting_name?: string | null;
  meeting_at?: string | null;
  meeting_notification_emails?: string[] | string | null;
  counselor_user_id?: string | null;
  rm_user_id?: string | null;
  initial_entry_text?: string | null;
}

export function useCustomerNotes(filters: CustomerNoteFilters) {
  const qs = toQueryString(filters);
  return useQuery({
    queryKey: ['customer-notes', qs],
    queryFn: () => apiGet<PageResult<CustomerNote>>(`/notes?${qs}`),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useCustomerNote(noteId: string | null | undefined) {
  return useQuery({
    queryKey: ['customer-note', noteId],
    queryFn: () => apiGet<CustomerNote>(`/notes/${noteId}`),
    enabled: !!noteId,
    staleTime: 10_000,
  });
}

export function useCreateCustomerNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomerNoteInput) => apiPost<CustomerNote>('/notes', body),
    onSuccess: (data) => invalidateNotes(qc, data?.id || null),
  });
}

export function useUpdateCustomerNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: CustomerNoteInput & { id: string }) => apiPatch<CustomerNote>(`/notes/${id}`, body),
    onSuccess: (data, variables) => invalidateNotes(qc, data?.id || variables.id),
  });
}

export function useDeleteCustomerNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => apiDelete(`/notes/${noteId}`),
    onSuccess: (_data, noteId) => invalidateNotes(qc, noteId),
  });
}

export function useAddCustomerNoteEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, entry_text }: { noteId: string; entry_text: string }) =>
      apiPost<CustomerNote>(`/notes/${noteId}/entries`, { entry_text }),
    onSuccess: (data, variables) => invalidateNotes(qc, data?.id || variables.noteId),
  });
}

export function useUpdateCustomerNoteEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, entryId, entry_text }: { noteId: string; entryId: string; entry_text: string }) =>
      apiPatch<CustomerNote>(`/notes/${noteId}/entries/${entryId}`, { entry_text }),
    onSuccess: (data, variables) => invalidateNotes(qc, data?.id || variables.noteId),
  });
}

export function useDeleteCustomerNoteEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, entryId }: { noteId: string; entryId: string }) =>
      apiDelete(`/notes/${noteId}/entries/${entryId}`),
    onSuccess: (_data, variables) => invalidateNotes(qc, variables.noteId),
  });
}

export function useApproveCustomerNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => apiPost<CustomerNote>(`/notes/${noteId}/approve`, {}),
    onSuccess: (data, noteId) => invalidateNotes(qc, data?.id || noteId),
  });
}

export function useRejectCustomerNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, rejection_note }: { noteId: string; rejection_note?: string }) =>
      apiPost<CustomerNote>(`/notes/${noteId}/reject`, { rejection_note }),
    onSuccess: (data, variables) => invalidateNotes(qc, data?.id || variables.noteId),
  });
}

export interface LeadLookupItem {
  id: string;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  category?: string | null;
  assigned_to_name?: string | null;
}

export function useCustomerNoteLeadLookup(search: string) {
  return useQuery({
    queryKey: ['customer-notes', 'lead-lookup', search],
    queryFn: () => apiGet<LeadLookupItem[]>(`/notes/lookups/leads?q=${encodeURIComponent(search)}`),
    enabled: search.trim().length >= 2,
    staleTime: 15_000,
  });
}

export function useCustomerNoteUserLookup(role?: 'rm' | 'member' | 'partner' | '', search?: string, rmUserId?: string | null) {
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  if (search?.trim()) params.set('q', search.trim());
  if (rmUserId) params.set('rm_user_id', rmUserId);
  const qs = params.toString();
  return useQuery({
    queryKey: ['customer-notes', 'user-lookup', role || 'all', search || '', rmUserId || ''],
    queryFn: () => apiGet<User[]>(`/notes/lookups/users${qs ? `?${qs}` : ''}`),
    staleTime: 30_000,
  });
}

export function useUpcomingCustomerMeetings(limit = 12) {
  return useQuery({
    queryKey: ['customer-notes', 'upcoming-meetings', limit],
    queryFn: () => apiGet<UpcomingMeetingSummary[]>(`/notes/upcoming-meetings?limit=${limit}`),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
}
