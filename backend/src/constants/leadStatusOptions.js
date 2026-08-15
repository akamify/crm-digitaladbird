const leadStatuses = [
  'new',
  'assigned',
  'contacted',
  'follow_up',
  'converted',
  'not_interested',
  'closed',
  'completed',
];

const callStatuses = [
  'not_called',
  'communication_completed',
  'respond_hi',
  'recall',
  'rnr',
  'cnr',
  'cw',
  'nc',
  'busy',
  'call_cut_busy',
  'switched_off',
  'so',
  'invalid_number',
  'in',
  'callback_requested',
  'ccb',
  'nn',
  'ni',
  'interested',
  'talk_response',
  'not_interested',
  'wrong_number',
  'language_barrier',
  'converted',
  'follow_up',
  'session_730_attend',
  'yes_after_730_session',
  'session_after_730',
  'custom_remark',
];

const leadStages = [
  'new',
  'contacted',
  'qualified',
  'proposal',
  'negotiation',
  'won',
  'lost',
  'dropped',
];

const followUpStatuses = ['pending', 'completed', 'missed', 'rescheduled'];
const leadRemarkNoteTypes = ['general', 'counselor_update', 'rm_update'];
const leadRemarkCategories = ['meeting', 'requirement', 'budget', 'problem', 'followup', 'status', 'proposal', 'other'];
const leadRemarkPriorities = ['low', 'medium', 'high', 'urgent'];
const leadRemarkCustomerInterests = ['cold', 'warm', 'hot', 'not_interested'];

const aliases = new Map([
  ['not called', 'not_called'],
  ['ringing no response', 'rnr'],
  ['call not received', 'cnr'],
  ['switched off', 'switched_off'],
  ['switch off', 'switched_off'],
  ['invalid number', 'invalid_number'],
  ['callback requested', 'callback_requested'],
  ['call back', 'callback_requested'],
  ['call back later', 'callback_requested'],
  ['cb', 'busy'],
  ['call busy', 'busy'],
  ['call cut busy', 'call_cut_busy'],
  ['call cut / busy', 'call_cut_busy'],
  ['call_cut/busy', 'call_cut_busy'],
  ['cut busy', 'call_cut_busy'],
  ['in', 'invalid_number'],
  ['not interested', 'not_interested'],
  ['wrong number', 'wrong_number'],
  ['language barrier', 'language_barrier'],
  ['follow up', 'follow_up'],
  ['talk response', 'talk_response'],
  ['custom remark', 'custom_remark'],
  ['yes after 7:30 session', 'yes_after_730_session'],
  ['yes after 9:00 session', 'yes_after_730_session'],
  ['session after 7:30', 'yes_after_730_session'],
  ['session after 9:00', 'yes_after_730_session'],
  ['session_after_730', 'yes_after_730_session'],
]);

function normalizeOptionValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.toLowerCase().replace(/[-\s]+/g, '_');
  return aliases.get(raw.toLowerCase()) || aliases.get(normalized.replace(/_/g, ' ')) || normalized;
}

function normalizeFromAllowed(value, allowed) {
  const normalized = normalizeOptionValue(value);
  if (!normalized) return '';
  return allowed.includes(normalized) ? normalized : null;
}

function validateLeadStatus(value) {
  return normalizeFromAllowed(value, leadStatuses);
}

function validateCallStatus(value) {
  return normalizeFromAllowed(value, callStatuses);
}

function validateLeadStage(value) {
  const normalized = normalizeOptionValue(value);
  const stageAliases = {
    'demo/meeting': 'proposal',
    demo_meeting: 'proposal',
    closed: 'won',
    completed: 'won',
  };
  const mapped = stageAliases[String(value || '').trim().toLowerCase()] || stageAliases[normalized] || normalized;
  if (!mapped) return '';
  return leadStages.includes(mapped) ? mapped : null;
}

function validateFollowUpStatus(value) {
  return normalizeFromAllowed(value, followUpStatuses);
}

function validateLeadRemarkNoteType(value) {
  return normalizeFromAllowed(value, leadRemarkNoteTypes);
}

function validateLeadRemarkCategory(value) {
  return normalizeFromAllowed(value, leadRemarkCategories);
}

function validateLeadRemarkPriority(value) {
  return normalizeFromAllowed(value, leadRemarkPriorities);
}

function validateLeadRemarkCustomerInterest(value) {
  return normalizeFromAllowed(value, leadRemarkCustomerInterests);
}

module.exports = {
  leadStatuses,
  callStatuses,
  leadStages,
  followUpStatuses,
  leadRemarkNoteTypes,
  leadRemarkCategories,
  leadRemarkPriorities,
  leadRemarkCustomerInterests,
  normalizeOptionValue,
  validateLeadStatus,
  validateCallStatus,
  validateLeadStage,
  validateFollowUpStatus,
  validateLeadRemarkNoteType,
  validateLeadRemarkCategory,
  validateLeadRemarkPriority,
  validateLeadRemarkCustomerInterest,
};
