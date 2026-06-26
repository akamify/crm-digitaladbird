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
  ['not interested', 'not_interested'],
  ['wrong number', 'wrong_number'],
  ['language barrier', 'language_barrier'],
  ['follow up', 'follow_up'],
  ['talk response', 'talk_response'],
  ['custom remark', 'custom_remark'],
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

module.exports = {
  leadStatuses,
  callStatuses,
  leadStages,
  followUpStatuses,
  normalizeOptionValue,
  validateLeadStatus,
  validateCallStatus,
  validateLeadStage,
  validateFollowUpStatus,
};
