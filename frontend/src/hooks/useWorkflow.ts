'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch } from '@/lib/api';

export interface WorkflowState {
  id: string;
  lead_id: string;
  user_id: string;
  remark_status: string | null;
  remark_saved_at: string | null;
  lead_level: string | null;
  lead_level_saved_at: string | null;
  followup_completed: boolean;
  followup_completed_at: string | null;
  conversion_completed: boolean;
  conversion_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FollowupTracker {
  id: string;
  lead_id: string;
  attendance_730: boolean;
  attendance_730_at: string | null;
  yes_confirmation: boolean;
  yes_confirmation_at: string | null;
  day_1: boolean; day_1_at: string | null;
  day_2: boolean; day_2_at: string | null;
  day_3: boolean; day_3_at: string | null;
  day_4: boolean; day_4_at: string | null;
  day_5: boolean; day_5_at: string | null;
  day_6: boolean; day_6_at: string | null;
  day_7: boolean; day_7_at: string | null;
  day_8: boolean; day_8_at: string | null;
  day_9: boolean; day_9_at: string | null;
  day_10: boolean; day_10_at: string | null;
  day_11: boolean; day_11_at: string | null;
  day_12: boolean; day_12_at: string | null;
  day_13: boolean; day_13_at: string | null;
  day_14: boolean; day_14_at: string | null;
  day_15: boolean; day_15_at: string | null;
}

export interface ConversionData {
  id: string;
  lead_id: string;
  followup_status: string | null;
  address: string | null;
  total_payment: string | null;
  part_payment: string | null;
  customer_type: 'partner' | 'trader';
  services: string | null;
  submitted_at: string;
}

export interface WorkflowResponse {
  workflow: WorkflowState | null;
  followup_tracker: FollowupTracker | null;
  conversion: ConversionData | null;
  current_step: number;
  remark_options: string[];
  lead_level_options: string[];
}

export interface WorkflowHistoryEntry {
  id: string;
  lead_id: string;
  user_id: string;
  user_name: string;
  step: number;
  action: string;
  old_value: string | null;
  new_value: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export interface WorkflowSummaryRow {
  lead_id: string;
  full_name: string;
  phone: string;
  category: string;
  assigned_to_user_id: string;
  assigned_to_name: string;
  team_name: string;
  remark_status: string | null;
  lead_level: string | null;
  followup_completed: boolean;
  conversion_completed: boolean;
  current_step: number;
}

export interface WorkflowStats {
  total_assigned: number;
  step1_pending: number;
  step2_pending: number;
  step3_pending: number;
  step4_pending: number;
  completed: number;
  today_actions: number;
}

// ─── Lead Workflow Hooks ────────────────────────────────────────────

export function useLeadWorkflow(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ['workflow', leadId],
    queryFn: () => apiGet<WorkflowResponse>(`/leads/${leadId}/workflow`),
    enabled: !!leadId,
    staleTime: 15_000,
  });
}

export function useSaveRemark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, remark_status }: { leadId: string; remark_status: string }) =>
      apiPost<WorkflowState>(`/leads/${leadId}/workflow/remark`, { remark_status }),
    onSuccess: (_d, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['workflow', leadId] });
      qc.invalidateQueries({ queryKey: ['lead', leadId] });
    },
  });
}

export function useSaveLeadLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, lead_level }: { leadId: string; lead_level: string }) =>
      apiPost<WorkflowState>(`/leads/${leadId}/workflow/level`, { lead_level }),
    onSuccess: (_d, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['workflow', leadId] });
      qc.invalidateQueries({ queryKey: ['lead', leadId] });
    },
  });
}

export function useUpdateFollowup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, ...fields }: { leadId: string; [key: string]: any }) =>
      apiPatch<{ followup_tracker: FollowupTracker; all_complete: boolean }>(
        `/leads/${leadId}/workflow/followup`, fields
      ),
    onSuccess: (_d, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['workflow', leadId] });
    },
  });
}

export function useSaveConversion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, ...data }: {
      leadId: string;
      followup_status?: string;
      address?: string;
      total_payment?: number;
      part_payment?: number;
      customer_type: 'partner' | 'trader';
      services?: string;
    }) => apiPost<ConversionData>(`/leads/${leadId}/workflow/conversion`, data),
    onSuccess: (_d, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['workflow', leadId] });
      qc.invalidateQueries({ queryKey: ['lead', leadId] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useWorkflowHistory(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ['workflow-history', leadId],
    queryFn: () => apiGet<WorkflowHistoryEntry[]>(`/leads/${leadId}/workflow/history`),
    enabled: !!leadId,
    staleTime: 30_000,
  });
}

// ─── Step 4 Payment / Receipt / UTR attachments ────────────────────
export interface ConversionAttachment {
  id: string;
  kind: 'payment_screenshot' | 'receipt' | 'utr' | 'other';
  file_name: string;
  file_path: string;
  url: string;                 // server-relative, e.g. /uploads/payments/<id>/<file>
  mime_type: string | null;
  size_bytes: number | null;
  note: string | null;
  uploaded_at: string;
  uploaded_by_name: string | null;
}

export function useConversionAttachments(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ['conversion-attachments', leadId],
    queryFn: () => apiGet<ConversionAttachment[]>(`/leads/${leadId}/workflow/conversion/attachments`),
    enabled: !!leadId,
    staleTime: 15_000,
  });
}

export function useUploadConversionAttachments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, files, kind = 'payment_screenshot', note }: { leadId: string; files: File[]; kind?: ConversionAttachment['kind']; note?: string }) => {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      fd.append('kind', kind);
      if (note) fd.append('note', note);
      const { api } = await import('@/lib/api');
      const { data } = await api.post(`/leads/${leadId}/workflow/conversion/attachments`, fd);
      return data.data as ConversionAttachment[];
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['conversion-attachments', vars.leadId] });
      qc.invalidateQueries({ queryKey: ['workflow', vars.leadId] });
      qc.invalidateQueries({ queryKey: ['workflow-history', vars.leadId] });
    },
  });
}

export function useDeleteConversionAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, attId }: { leadId: string; attId: string }) => {
      const { api } = await import('@/lib/api');
      const { data } = await api.delete(`/leads/${leadId}/workflow/conversion/attachments/${attId}`);
      return data.data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['conversion-attachments', vars.leadId] });
    },
  });
}

// ─── Admin/RM Monitoring Hooks ──────────────────────────────────────

export function useWorkflowStats() {
  return useQuery({
    queryKey: ['workflow-stats'],
    queryFn: () => apiGet<WorkflowStats>('/workflow/stats'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useWorkflowSummary(params: { page?: number; step?: number; user_id?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.step) qs.set('step', String(params.step));
  if (params.user_id) qs.set('user_id', params.user_id);
  const q = qs.toString();

  return useQuery({
    queryKey: ['workflow-summary', q],
    queryFn: () => apiGet<{ rows: WorkflowSummaryRow[]; total: number; page: number }>(
      `/workflow/summary${q ? `?${q}` : ''}`
    ),
    staleTime: 15_000,
  });
}

export function useAdminEditWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, ...body }: { leadId: string; [key: string]: any }) =>
      apiPatch<WorkflowState>(`/leads/${leadId}/workflow/admin-edit`, body),
    onSuccess: (_d, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['workflow', leadId] });
      qc.invalidateQueries({ queryKey: ['workflow-summary'] });
      qc.invalidateQueries({ queryKey: ['workflow-stats'] });
    },
  });
}
