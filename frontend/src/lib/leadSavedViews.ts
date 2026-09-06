import type { LeadFilters } from '@/types';

const BASE_SAVED_FILTER_KEYS: Array<keyof LeadFilters> = [
  'category',
  'stage',
  'call_status',
  'source',
  'campaign',
  'created_preset',
  'pending',
  'unworked',
  'no_remark',
  'followup',
  'followup_strict',
  'workflow_status',
  'latest_activity',
  'reassignment',
  'assignment',
  'assigned_today',
  'label_id',
  'remark_status',
  'note_type',
  'note_category',
  'priority',
  'customer_interest',
  'has_rm_update',
  'updated_by_rm',
  'session_attendance',
  'call_issues',
  'from',
  'to',
];

const ANALYTICS_FILTER_KEYS: Array<keyof LeadFilters> = [
  'selected_date',
  'daily_metric',
  'lead_view',
  'all_time_metric',
];

export function pickSavedLeadFilters(filters: LeadFilters, includeAnalytics: boolean): LeadFilters {
  const result: LeadFilters = {};
  const keys = includeAnalytics ? [...BASE_SAVED_FILTER_KEYS, ...ANALYTICS_FILTER_KEYS] : BASE_SAVED_FILTER_KEYS;
  for (const key of keys) {
    const value = filters[key];
    if (value !== undefined && value !== null && value !== '') {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

export function leadViewSharePath(filters: LeadFilters, includeAnalytics: boolean): string {
  const params = new URLSearchParams();
  Object.entries(pickSavedLeadFilters(filters, includeAnalytics)).forEach(([key, value]) => {
    params.set(key, String(value));
  });
  return `/leads${params.size ? `?${params.toString()}` : ''}`;
}
