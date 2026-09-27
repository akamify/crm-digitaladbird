export interface CounselorLeadTab { key: string; label: string; view?: string }

// Tab order is shared with Stage 1; all 22 now use versioned backend views.
export const COUNSELOR_LEAD_TABS: readonly CounselorLeadTab[] = [
  { key: 'received', label: 'Leads Received', view: 'received' },
  { key: 'new', label: 'New Leads', view: 'new' },
  { key: 'old', label: 'Old Leads', view: 'old' },
  { key: 'worked', label: 'Worked', view: 'worked' },
  { key: 'pending', label: 'Pending', view: 'pending' },
  { key: 'cc', label: 'CC — Communication Completed', view: 'cc' },
  { key: 'responded', label: 'Responded', view: 'responded' },
  { key: 'call_issues', label: 'CI — Call Issues', view: 'call_issues' },
  { key: 'common_meeting', label: 'Common Meeting', view: 'common_meeting' },
  { key: 'dim', label: 'DIM — Discussed in Meeting', view: 'dim' },
  { key: 'personal_meeting', label: 'PM — Personal Meeting', view: 'personal_meeting' },
  { key: 'follow_up', label: 'Follow-Up', view: 'follow_up' },
  { key: 'quotation', label: 'Quotation', view: 'quotation' },
  { key: 'hot', label: 'Hot', view: 'hot' },
  { key: 'warm', label: 'Warm', view: 'warm' },
  { key: 'special_category', label: 'SC — Special Category', view: 'special_category' },
  { key: 'call_reminder', label: 'CR — Call Reminder', view: 'call_reminder' },
  { key: 'handover_rm', label: 'RM — Handover to RM', view: 'handover_rm' },
  { key: 'not_attended', label: 'NT — Not Attended', view: 'not_attended' },
  { key: 'converted', label: 'Converted', view: 'converted' },
  { key: 'cold', label: 'Cold', view: 'cold' },
  { key: 'process_incomplete', label: 'PI — Process Incomplete', view: 'process_incomplete' },
];

// Responses is broader than Responded, and TTE is not DIM. Preserve both
// existing views through Actions without changing their backend semantics.
export const LEGACY_COUNSELOR_VIEWS = [
  { key: 'responses', label: 'Responses', view: 'responses' },
  { key: 'tte', label: 'TTE', view: 'tte' },
] as const;

export function counselorLeadTab(key: string | null): CounselorLeadTab {
  return [...COUNSELOR_LEAD_TABS, ...LEGACY_COUNSELOR_VIEWS].find(tab => tab.key === key)
    || COUNSELOR_LEAD_TABS[0];
}
