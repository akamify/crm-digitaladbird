import type { LeadDailyMetric, LeadFilters } from '@/types';

export function withReportCounselor(filters: LeadFilters, counselorId: string): LeadFilters {
  // One owner selector controls both summary and rows; remove conflicting assignee filters.
  return {...filters, counselor_id: counselorId, assigned_to: '', assignment: '', page: 1};
}
export const MANAGER_METRICS: Array<{key:LeadDailyMetric;label:string;shortLabel:string}> = [
  ['received','Assigned Leads'],['new','New Leads'],['old','Old Leads'],['worked','Worked Leads'],['pending','Pending'],
  ['cc','Communication Completed'],['responded','Responded'],['call_issues','Call Issues'],['common_meeting','Common Meeting'],
  ['dim','Discussed in Meeting'],['personal_meeting','Personal Meeting'],['follow_up','Follow-up'],['quotation','Quotation'],
  ['hot','Hot'],['warm','Warm'],['special_category','Special Category'],['call_reminder','Call Reminder'],
  ['handover_rm','Handover to RM'],['not_attended','Not Attended'],['converted','Converted'],['cold','Cold'],
  ['process_incomplete','Process Incomplete'],['responses','Responses'],['tte','TTE'],
].map(([key,label])=>({key:key as LeadDailyMetric,label,shortLabel:label}));
export function managerMetric(value:string|null|undefined):LeadDailyMetric {
  if(value==='session_9pm') return 'common_meeting';
  return MANAGER_METRICS.find(item=>item.key===value)?.key || 'received';
}
export function managerLeadHref(params:URLSearchParams,metric:string,rmId?:string,counselorId?:string) {
  const next=new URLSearchParams(params);
  next.set('lead_view',next.get('lead_view') || next.get('view') || 'all_time');
  ['view','metric','sort','order','search','page','daily_metric','all_time_metric','call_issue_type','work_source'].forEach(key=>next.delete(key));
  next.set('workflow_view',managerMetric(metric));
  if(rmId)next.set('rm_id',rmId);
  if(counselorId)next.set('counselor_id',counselorId);
  return `/leads?${next.toString()}`;
}

export function distributionReportHref(params: URLSearchParams, metric: string, rmId: string, counselorId?: string) {
  const target = new URL(managerLeadHref(params, metric, rmId, counselorId), 'https://local.invalid');
  if (counselorId) {
    target.searchParams.set('view', target.searchParams.get('lead_view') || 'all_time');
    target.searchParams.set('metric', managerMetric(metric));
    target.searchParams.delete('lead_view');
    target.searchParams.delete('workflow_view');
  }
  const path = counselorId ? `counselor/${encodeURIComponent(counselorId)}` : 'leads';
  return `/leads/distribution/rm/${encodeURIComponent(rmId)}/${path}?${target.searchParams.toString()}`;
}
