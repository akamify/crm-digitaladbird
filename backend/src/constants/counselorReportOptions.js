const RETRYABLE_CONTACT_ISSUES = ['cnr', 'recall', 'busy', 'cb', 'rnr', 'cw', 'nn', 'so', 'nc', 'call_cut_busy'];
const TERMINAL_LEAD_QUALITY_ISSUES = ['in', 'invalid_number', 'wrong_number', 'ni', 'language_barrier'];
const CONTACTED_STATUSES = ['communication_completed', 'respond_hi', 'session_730_attend', 'yes_after_730_session', 'interested', 'converted', 'call_received'];
const PROGRESSION_STATUSES = ['interested', 'converted', 'session_730_attend', 'yes_after_730_session'];

const UNWORKED_SLA_HOURS = {
  needs_action: Number(process.env.COUNSELOR_REPORT_NEEDS_ACTION_HOURS || 4),
  delayed: Number(process.env.COUNSELOR_REPORT_DELAYED_HOURS || 24),
  critical: Number(process.env.COUNSELOR_REPORT_CRITICAL_HOURS || 48),
};

const QUALITY_WEIGHTS = {
  work_coverage: 30,
  actionable_contact: 25,
  followup_discipline: 25,
  pending_control: 10,
  progression: 10,
};

const CALL_ISSUE_LABELS = {
  cnr: 'CNR', recall: 'Recall', busy: 'Busy', cb: 'Call Busy', rnr: 'Ringing No Response',
  cw: 'Call Waiting', nn: 'No Network', so: 'Switch Off', nc: 'Not Connected',
  call_cut_busy: 'Call Cut / Busy', in: 'Invalid Number', invalid_number: 'Invalid Number',
  wrong_number: 'Wrong Number', ni: 'No Incoming', language_barrier: 'Language Barrier',
};

function sqlArray(values) {
  return `ARRAY[${values.map(value => `'${value}'`).join(', ')}]::text[]`;
}

function classifyContactState({ status, hasSuccessfulWorkflow = false, hasReceivedAttempt = false } = {}) {
  const explicitStatus = String(status || 'not_called').toLowerCase();
  const effective = explicitStatus === 'converted' ? 'converted' : (hasSuccessfulWorkflow || hasReceivedAttempt ? 'communication_completed' : explicitStatus);
  if (effective === 'converted') return { state: 'converted', issueType: null, contactable: true };
  if (CONTACTED_STATUSES.includes(effective)) return { state: 'contacted', issueType: null, contactable: true };
  if (TERMINAL_LEAD_QUALITY_ISSUES.includes(effective)) return { state: 'terminal_lead_quality_issue', issueType: effective, contactable: false };
  if (RETRYABLE_CONTACT_ISSUES.includes(effective)) return { state: 'retryable_contact_issue', issueType: effective, contactable: true };
  return { state: effective === 'not_called' ? 'unworked' : 'other', issueType: null, contactable: true };
}

function qualityLabel(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 60) return 'Needs Attention';
  return 'Poor';
}

function calculateQuality(metrics) {
  const percent = (numerator, denominator) => denominator > 0 ? Math.min(100, Math.max(0, (Number(numerator) / Number(denominator)) * 100)) : null;
  const components = {
    work_coverage: percent(metrics.worked, metrics.execution_eligible),
    actionable_contact: percent(metrics.attributed_contacted, metrics.contactable_received),
    followup_discipline: percent(metrics.on_time_attempts, metrics.completed_attempts),
    pending_control: percent(Math.max(0, Number(metrics.execution_eligible || 0) - Number(metrics.actionable_pending || 0)), metrics.execution_eligible),
    progression: percent(metrics.progressed, metrics.attributed_contacted),
  };
  const available = Object.entries(QUALITY_WEIGHTS).filter(([key]) => components[key] !== null);
  const weightTotal = available.reduce((total, [key]) => total + QUALITY_WEIGHTS[key], 0);
  const score = weightTotal
    ? Math.round(available.reduce((total, [key, weight]) => total + components[key] * weight, 0) / weightTotal)
    : 0;
  return { score, label: qualityLabel(score), components };
}

module.exports = {
  RETRYABLE_CONTACT_ISSUES,
  TERMINAL_LEAD_QUALITY_ISSUES,
  CONTACTED_STATUSES,
  PROGRESSION_STATUSES,
  UNWORKED_SLA_HOURS,
  QUALITY_WEIGHTS,
  CALL_ISSUE_LABELS,
  sqlArray,
  classifyContactState,
  calculateQuality,
};
