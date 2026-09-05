const { AppError } = require('./errors');
const { workedLeadCondition } = require('./leadWorkMetrics');
const {
  activeSequenceIssueSql,
  hasSuccessfulContactSql,
  unresolvedRetryableCallIssueSql,
} = require('./leadCallIssueMetrics');
const { UNWORKED_SLA_HOURS } = require('../constants/counselorReportOptions');

const LEAD_ALL_TIME_METRICS = new Set([
  'all',
  'worked',
  'pending',
  'personal_meeting',
  'session_9pm',
  'call_issues',
]);

function normalizeLeadAllTimeMetric(value) {
  const metric = String(value || 'all').trim().toLowerCase();
  if (!LEAD_ALL_TIME_METRICS.has(metric)) {
    throw new AppError(400, 'INVALID_ALL_TIME_METRIC', 'Select a valid all-time lead metric');
  }
  return metric;
}

function buildLeadAllTimeMetricConditions(leadAlias = 'l') {
  const lead = String(leadAlias || 'l').trim();
  const activeIssue = activeSequenceIssueSql(lead);
  const hasSuccessfulContact = hasSuccessfulContactSql(lead);
  const callIssues = unresolvedRetryableCallIssueSql(lead);
  const personalMeeting = `EXISTS (
    SELECT 1 FROM customer_notes all_pm
     WHERE all_pm.lead_id = ${lead}.id
       AND all_pm.note_kind = 'personal_meeting'
       AND all_pm.deleted_at IS NULL
  )`;
  const session9pm = `(
    EXISTS (
      SELECT 1 FROM lead_remarks all_session_remark
       WHERE all_session_remark.lead_id = ${lead}.id
         AND (
           all_session_remark.call_status::text = 'session_730_attend'
           OR COALESCE(all_session_remark.call_statuses, '[]'::jsonb) ? 'session_730_attend'
         )
    )
    OR EXISTS (
      SELECT 1 FROM lead_workflow_history all_session_history
       WHERE all_session_history.lead_id = ${lead}.id
         AND (
           all_session_history.new_value = 'session_730_attend'
           OR (COALESCE(all_session_history.metadata, '{}'::jsonb)->'step_1_statuses') ? 'session_730_attend'
         )
    )
  )`;
  const agedUnworked = `(
    ${activeIssue} IS NULL
    AND COALESCE(${lead}.call_status::text, 'not_called') = 'not_called'
    AND NOT ${hasSuccessfulContact}
    AND ${lead}.assigned_at <= NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.needs_action})
  )`;
  const pending = `(
    ${lead}.assigned_to_user_id IS NOT NULL
    AND (
      ${agedUnworked}
      OR ${callIssues}
      OR EXISTS (
        SELECT 1 FROM lead_call_attempts all_due_attempt
         WHERE all_due_attempt.lead_id = ${lead}.id
           AND all_due_attempt.status = 'scheduled'
           AND all_due_attempt.scheduled_at <= NOW()
      )
      OR ${lead}.next_followup_at <= NOW()
      OR EXISTS (
        SELECT 1 FROM customer_notes all_due_meeting
         WHERE all_due_meeting.lead_id = ${lead}.id
           AND all_due_meeting.note_kind = 'personal_meeting'
           AND all_due_meeting.deleted_at IS NULL
           AND all_due_meeting.next_meeting_at <= NOW()
      )
    )
  )`;

  return {
    all: 'TRUE',
    worked: workedLeadCondition(lead),
    pending,
    personal_meeting: personalMeeting,
    session_9pm: session9pm,
    call_issues: callIssues,
  };
}

function leadAllTimeSummarySelectSql(conditions) {
  return Object.entries(conditions)
    .map(([key, condition]) => `COUNT(*) FILTER (WHERE ${condition})::int AS "${key}"`)
    .join(',\n      ');
}

module.exports = {
  LEAD_ALL_TIME_METRICS,
  normalizeLeadAllTimeMetric,
  buildLeadAllTimeMetricConditions,
  leadAllTimeSummarySelectSql,
};
