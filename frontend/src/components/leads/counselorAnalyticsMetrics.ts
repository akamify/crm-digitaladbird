import type { WorkspaceSummary, WorkspaceView } from '@/hooks/useLifecycle';

export const LEADS_METRICS: Array<{key: keyof WorkspaceSummary; label: string; hint: string}> = [
  {key:'received',label:'Assigned Leads',hint:'Leads assigned during the selected period.'},
  {key:'new',label:'New Leads',hint:'Untouched leads in the New queue.'},
  {key:'old',label:'Old Leads',hint:'Leads aged into Old; the remark tab can overlap.'},
  {key:'worked',label:'Worked Leads',hint:'Recorded N/O work plus previous work carried forward without guessed attribution.'},
  {key:'pending',label:'Pending',hint:'Leads whose workflow has moved to Pending.'},
  {key:'cc',label:'CC',hint:'Communication Completed'},
];
export const LEADS_VIEWS: Array<[WorkspaceView, string]> = [
  ['cc','Communication Completed'],['responded','Responded (HI)'],['call_issues','Call Issues'],['common_meeting','Common Meeting'],['dim','Discussed in Meeting'],['personal_meeting','Personal Meeting'],
  ['follow_up','Follow-up'],['quotation','Quotation'],['hot','Hot'],['warm','Warm'],
  ['special_category','Special Category'],['call_reminder','Call Reminder'],['handover_rm','Handover to Relationship Manager'],['not_attended','Not Attended'],
  ['converted','Converted'],['cold','Cold'],['process_incomplete','Process Incomplete'],['responses','Responses'],['tte','TTE'],
];
export const QUEUE_TONES: Record<string,string> = {
  received:'bg-indigo-50 text-indigo-900 hover:bg-indigo-100',
  new:'bg-yellow-50 text-yellow-900 hover:bg-yellow-100',
  old:'bg-orange-50 text-orange-900 hover:bg-orange-100',
  worked:'bg-emerald-50 text-emerald-900 hover:bg-emerald-100',
  pending:'bg-rose-100 text-rose-900 hover:bg-rose-200',
  cc:'bg-sky-50 text-sky-900 hover:bg-sky-100',
};
