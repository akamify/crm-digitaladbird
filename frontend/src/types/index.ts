/**
 * Shared domain types — mirror the backend response shape so the entire
 * frontend speaks one language. Keep in sync with backend controllers.
 */

export type Role = 'super_admin' | 'admin' | 'rm' | 'member' | 'partner';
export type MemberType = 'fresher' | 'veteran';
export type LeadCategory = 'partner' | 'trader';

export type LeadStage =
  | 'new' | 'contacted' | 'qualified' | 'follow_up' | 'won' | 'lost';

export type CallStatus =
  | 'not_called' | 'cnr' | 'cw' | 'nc' | 'ccb' | 'ni' | 'so' | 'nn'
  | 'talk_response' | 'custom_remark'
  | 'interested' | 'not_interested' | 'follow_up' | 'converted'
  | 'rnr' | 'busy' | 'switched_off' | 'invalid_number'
  | 'callback_requested' | 'wrong_number' | 'language_barrier';

export interface User {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: Role;
  member_type?: MemberType | null;
  report_to_id?: string | null;
  team_name?: string | null;
  daily_lead_cap?: number | null;
  distribution_weight?: number | null;
  is_available?: boolean;
  status?: 'active' | 'blocked' | 'inactive';
  is_active?: boolean;
  created_at?: string;
}

export interface Lead {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  source: string | null;
  meta_form_id: string | null;
  campaign_label: string | null;
  product_tag: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  meta_ad_id: string | null;
  meta_page_id: string | null;
  meta_created_time: string | null;
  meta_lead_id: string | null;
  stage: LeadStage;
  call_status: CallStatus;
  last_call_at: string | null;
  next_followup_at: string | null;
  call_attempts: number;
  category: LeadCategory;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  locked_by_user_id: string | null;
  locked_until: string | null;
  created_at: string;
  assigned_at: string | null;
  updated_at: string;
}

export interface LeadRemark {
  id: string;
  remark: string;
  call_status: CallStatus | null;
  next_followup_at: string | null;
  created_at: string;
  author_name?: string;
  by_name?: string;
}

export interface LeadAssignment {
  assigned_at: string;
  unassigned_at: string | null;
  reason: string | null;
  user_name: string | null;
}

export interface LeadDetail extends Lead {
  remarks: LeadRemark[];
  history: LeadAssignment[];
}

export interface LeadFilters {
  q?: string;
  category?: LeadCategory | '';
  stage?: LeadStage | '';
  call_status?: CallStatus | '';
  source?: string;
  form_id?: string;
  campaign_id?: string;
  campaign?: string;
  adset?: string;
  from?: string;
  to?: string;
  pending?: 'true' | 'false' | '';
  followup?: 'today' | 'overdue' | 'upcoming' | '';
  assigned_to?: string;
  page?: number;
  page_size?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface PageResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SummaryKpi {
  total_leads: string;
  pending: string;
  converted: string;
  followups: string;
  lost: string;
  today_leads: string;
  today_assigned: string;
}

export interface DailyPoint {
  day: string;
  leads: string;
  conversions: string;
  pending: string;
}

export interface UserPerformance {
  id: string;
  full_name: string;
  role: Role;
  team_name: string | null;
  leads: string;
  pending: string;
  conversions: string;
  rnr: string;
  not_interested: string;
  conv_rate: string | null;
}

export interface FunnelStage { stage: LeadStage; count: string; }
export interface SourceStat  { source: string | null; count: string; conversions: string; }

export interface DistributionRule {
  id: string;
  name: string;
  strategy: 'round_robin' | 'weighted' | 'manual' | 'priority_queue';
  is_active: boolean;
  meta_form_id: string | null;
  eligible_user_ids: string[] | null;
  created_at: string;
}

export interface MetaPage {
  id: string;
  page_id: string;
  page_name: string;
  is_active: boolean;
  created_at: string;
}

export interface MetaForm {
  id: string;
  form_id: string;
  form_name: string;
  page_id: string | null;
  product_tag: string | null;
  campaign_label: string | null;
  is_active: boolean;
}
