'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { LeadAnalyticsScope, LeadFilters } from '@/types';

export const COUNSELOR_FILTER_KEYS = ['q','source','category','stage','call_status','remark_status','campaign','followup','assigned_to'] as const;
export function useCounselorWorkflowConfig(enabled:boolean) {
  const {user}=useAuth();
  return useQuery({queryKey:['counselor-workflow','config',user?.id],enabled:enabled&&Boolean(user),
    queryFn:()=>apiGet<{enabled:boolean}>('/counselor-workflow/v1/config'),staleTime:15000,refetchInterval:30000});
}
export interface WorkflowState {
  primary_status: string | null; queue: 'new'|'old'|'pending'|null; journey_active: boolean;
  generation: number; move_to_old_at: string|null; move_to_pending_at: string|null; followup_override: boolean;
}
export interface WorkflowEvent {
  id: string; event_type: string; occurred_at: string; primary_status: string|null;
  new_state: WorkflowState; statuses?: string[]; source: string;
}
export interface CounselorLead extends WorkflowState {
  id: string; lead_id: string; full_name: string|null; phone: string|null; email: string|null;
  source: string|null; category: string|null; campaign_name: string|null; campaign_label: string|null;
  next_followup_at: string|null; assigned_at: string|null; read_only: boolean;
  worked_n: boolean; worked_o: boolean; history: WorkflowEvent[]; history_total: number;
}
export interface CounselorWorkspaceResponse {
  remarks_enabled?: boolean;
  enabled: boolean; summary: Record<string,number>; worked: {n:number;o:number}; status_options: string[];
  rows: CounselorLead[]; total: number; page: number; page_size: number;
}
export interface CounselorDetail {
  enabled: boolean; managed: boolean; read_only: boolean; state: WorkflowState|null;
  events: WorkflowEvent[]; has_more: boolean; status_options: string[];
}
export function useCounselorWorkflowLeads(input: {view:string;scope:LeadAnalyticsScope;filters:LeadFilters;page:number}) {
  const {user}=useAuth();
  const params = new URLSearchParams({view:input.view,lead_view:input.scope.view,page:String(input.page)});
  if (input.scope.from) params.set('from',input.scope.from);
  if (input.scope.to) params.set('to',input.scope.to);
  for (const key of COUNSELOR_FILTER_KEYS) if (input.filters[key]) params.set(key,String(input.filters[key]));
  return useQuery({queryKey:['counselor-workflow','list',user?.id,params.toString()],enabled:Boolean(user),
    queryFn:() => apiGet<CounselorWorkspaceResponse>(`/counselor-workflow/v1/leads?${params}`),
    placeholderData:(previous,query)=>query?.queryKey[2]===user?.id?previous:undefined,staleTime:15000,refetchInterval:60000});
}
export function useCounselorWorkflowDetail(id:string,page=1,enabled=true) {
  const {user}=useAuth();
  return useQuery({queryKey:['counselor-workflow','detail',user?.id,id,page],
    queryFn:() => apiGet<CounselorDetail>(`/counselor-workflow/v1/leads/${id}?page=${page}`),
    enabled:Boolean(user)&&Boolean(id)&&enabled,staleTime:10000,refetchInterval:30000});
}
export function useCounselorRemark() {
  const client = useQueryClient();
  return useMutation({mutationFn:({leadId,...body}:{leadId:string;statuses:string[];primary_status:string;remark:string;
    idempotency_key:string;expected_generation:number;next_followup_at?:string|null}) => apiPost(`/counselor-workflow/v1/leads/${leadId}/remarks`,body),
    onSuccess:(_data,input) => {
      client.invalidateQueries({queryKey:['counselor-workflow']});
      client.invalidateQueries({queryKey:['lead',input.leadId]});
      client.invalidateQueries({queryKey:['leads']});
    }});
}
