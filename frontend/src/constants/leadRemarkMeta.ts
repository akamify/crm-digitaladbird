import type {
  LeadRemarkCategory,
  LeadRemarkCustomerInterest,
  LeadRemarkNoteType,
  LeadRemarkPriority,
} from '@/types';

export const LEAD_REMARK_NOTE_TYPE_OPTIONS: Array<{ value: LeadRemarkNoteType; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'counselor_update', label: 'Counselor Update' },
  { value: 'rm_update', label: 'RM Update' },
];

export const LEAD_REMARK_CATEGORY_OPTIONS: Array<{ value: LeadRemarkCategory; label: string }> = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'requirement', label: 'Requirement' },
  { value: 'budget', label: 'Budget' },
  { value: 'problem', label: 'Problem' },
  { value: 'followup', label: 'Follow-up' },
  { value: 'status', label: 'Status' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'other', label: 'Other' },
];

export const LEAD_REMARK_PRIORITY_OPTIONS: Array<{ value: LeadRemarkPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export const LEAD_REMARK_CUSTOMER_INTEREST_OPTIONS: Array<{ value: LeadRemarkCustomerInterest; label: string }> = [
  { value: 'cold', label: 'Cold' },
  { value: 'warm', label: 'Warm' },
  { value: 'hot', label: 'Hot' },
  { value: 'not_interested', label: 'Not Interested' },
];

export function getLeadRemarkNoteTypeLabel(value?: string | null) {
  return LEAD_REMARK_NOTE_TYPE_OPTIONS.find(option => option.value === value)?.label || 'General';
}

export function getLeadRemarkCategoryLabel(value?: string | null) {
  return LEAD_REMARK_CATEGORY_OPTIONS.find(option => option.value === value)?.label || null;
}

export function getLeadRemarkPriorityLabel(value?: string | null) {
  return LEAD_REMARK_PRIORITY_OPTIONS.find(option => option.value === value)?.label || null;
}

export function getLeadRemarkCustomerInterestLabel(value?: string | null) {
  return LEAD_REMARK_CUSTOMER_INTEREST_OPTIONS.find(option => option.value === value)?.label || null;
}
