const CUSTOMER_NOTE_KINDS = ['general', 'meeting_schedule', 'personal_meeting'];
const PERSONAL_MEETING_MODES = ['zoom', 'google_meet', 'phone_call', 'in_person', 'other'];
const PERSONAL_MEETING_PRICING_TYPES = ['individual_services', 'package'];
const PERSONAL_MEETING_OUTCOMES = [
  'interested',
  'proposal_required',
  'follow_up_required',
  'decision_pending',
  'converted',
  'not_interested',
  'next_personal_meeting_required',
];

const PERSONAL_MEETING_OBJECTIONS = [
  'budget',
  'needs_partner_approval',
  'already_with_agency',
  'result_guarantee',
  'timing_issue',
  'price_too_high',
  'needs_proposal_first',
  'other',
];

const PERSONAL_MEETING_DEFAULT_SERVICES = [
  { key: 'meta_ads', name: 'Meta Ads' },
  { key: 'google_ads', name: 'Google Ads' },
  { key: 'website_development', name: 'Website Development' },
  { key: 'seo', name: 'SEO' },
  { key: 'whatsapp_business_api', name: 'WhatsApp Business API' },
  { key: 'gmb', name: 'GMB / Google Business Profile' },
  { key: 'video_shooting', name: 'Video Shooting' },
  { key: 'video_editing', name: 'Video Editing' },
];

const PERSONAL_MEETING_DEFAULT_PACKAGE_SERVICE_KEYS = [
  'meta_ads',
  'google_ads',
  'website_development',
  'gmb',
  'video_editing',
];

function normalizeOption(value) {
  return String(value || '').trim().toLowerCase();
}

function isCustomerNoteKind(value) {
  return CUSTOMER_NOTE_KINDS.includes(normalizeOption(value));
}

function isPersonalMeetingMode(value) {
  return PERSONAL_MEETING_MODES.includes(normalizeOption(value));
}

function isPersonalMeetingPricingType(value) {
  return PERSONAL_MEETING_PRICING_TYPES.includes(normalizeOption(value));
}

function isPersonalMeetingOutcome(value) {
  return PERSONAL_MEETING_OUTCOMES.includes(normalizeOption(value));
}

function isPersonalMeetingObjection(value) {
  return PERSONAL_MEETING_OBJECTIONS.includes(normalizeOption(value));
}

module.exports = {
  CUSTOMER_NOTE_KINDS,
  PERSONAL_MEETING_MODES,
  PERSONAL_MEETING_PRICING_TYPES,
  PERSONAL_MEETING_OUTCOMES,
  PERSONAL_MEETING_OBJECTIONS,
  PERSONAL_MEETING_DEFAULT_SERVICES,
  PERSONAL_MEETING_DEFAULT_PACKAGE_SERVICE_KEYS,
  isCustomerNoteKind,
  isPersonalMeetingMode,
  isPersonalMeetingPricingType,
  isPersonalMeetingOutcome,
  isPersonalMeetingObjection,
};
