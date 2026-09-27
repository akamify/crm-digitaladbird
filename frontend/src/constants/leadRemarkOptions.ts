export type LeadRemarkOption = {
  value: string;
  label: string;
};

export type LeadRemarkGroup = {
  key: 'completed' | 'responses' | 'issues' | 'other' | 'journey' | 'nr';
  label: string;
  tone: 'emerald' | 'sky' | 'amber' | 'slate';
  options: LeadRemarkOption[];
};

export const LEAD_REMARK_GROUPS: LeadRemarkGroup[] = [
  {
    key: 'completed',
    label: 'Completed Responses',
    tone: 'emerald',
    options: [
      { value: 'communication_completed', label: 'Communication Completed' },
      { value: 'respond_hi', label: 'Respond (HI)' },
      { value: 'session_730_attend', label: 'Common Meeting Attended' },
      { value: 'yes_after_730_session', label: 'Yes After Common Meeting' },
    ],
  },
  {
    key: 'responses',
    label: 'Call Responses',
    tone: 'sky',
    options: [
      { value: 'interested', label: 'Interested' },
      { value: 'converted', label: 'Converted' },
    ],
  },
  {
    key: 'issues',
    label: 'Call Issues',
    tone: 'amber',
    options: [
      { value: 'cnr', label: 'CNR (Call Not Received)' },
      { value: 'recall', label: 'Recall' },
      { value: 'so', label: 'SO (Switch Off)' },
      { value: 'cw', label: 'CW (Call Waiting)' },
      { value: 'nn', label: 'NN (No Network)' },
      { value: 'nc', label: 'NC (Not Connected)' },
      { value: 'ni', label: 'NI (No Incoming)' },
      { value: 'in', label: 'IN (Invalid Number)' },
      { value: 'call_cut_busy', label: 'Call Cut / Busy' },
      { value: 'cb', label: 'CB (Call Busy)' },
      { value: 'rnr', label: 'RNR (Ringing No Response)' },
      { value: 'busy', label: 'Busy' },
    ],
  },
  {
    key: 'journey', label: 'Journey Remarks', tone: 'sky', options: [
      {value:'common_meeting',label:'CM - Common Meeting'}, {value:'dim',label:'DIM - Discussed in Meeting'},
      {value:'personal_meeting',label:'PM - Personal Meeting'}, {value:'quotation',label:'Quotation'},
      {value:'hot',label:'Hot'}, {value:'warm',label:'Warm'}, {value:'process_incomplete',label:'PI - Process Incomplete'},
      {value:'special_category',label:'SC - Special Category'}, {value:'call_reminder',label:'CR - Call Reminder'},
      {value:'handover_rm',label:'RM - Handover to RM'}, {value:'not_attended',label:'NT - Not Attended'}, {value:'cold',label:'Cold'},
    ],
  },
  {key:'nr',label:'Not Responding',tone:'amber',options:[
    {value:'nrac',label:'NRAC'}, {value:'nracm',label:'NRACM'}, {value:'nrapm',label:'NRAPM'},
    {value:'nraf',label:'NRAF'}, {value:'nraq',label:'NRAQ'},
  ]},
  {
    key: 'other',
    label: 'Follow-up & Other',
    tone: 'slate',
    options: [
      { value: 'not_interested', label: 'Not Interested' },
      { value: 'callback_requested', label: 'Callback Requested' },
      { value: 'follow_up', label: 'Follow-up' },
      { value: 'custom_remark', label: 'Custom Remark' },
    ],
  },
];

export const COMPLETED_REMARK_STATUS_VALUES = new Set(
  LEAD_REMARK_GROUPS.find(group => group.key === 'completed')!.options.map(option => option.value),
);

export const CALL_ISSUE_STATUS_VALUES = new Set(
  LEAD_REMARK_GROUPS.find(group => group.key === 'issues')!.options.map(option => option.value),
);

export const RETRYABLE_CALL_ISSUE_VALUES = new Set([
  'cnr', 'recall', 'busy', 'cb', 'rnr', 'cw', 'nn', 'so', 'nc', 'call_cut_busy',
]);

export const SEQUENCE_CLOSING_REMARK_VALUES = new Set([
  ...LEAD_REMARK_GROUPS.filter(group=>group.key==='journey'||group.key==='nr').flatMap(group=>group.options.map(option=>option.value)),
  'communication_completed', 'respond_hi', 'session_730_attend', 'yes_after_730_session',
  'interested', 'converted', 'not_interested', 'callback_requested', 'follow_up', 'in', 'ni',
]);
