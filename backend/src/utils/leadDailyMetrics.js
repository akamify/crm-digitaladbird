const { AppError } = require('./errors');
const { unresolvedRetryableCallIssueSql } = require('./leadCallIssueMetrics');
const { RETRYABLE_CONTACT_ISSUES, sqlArray } = require('../constants/counselorReportOptions');

const IST = 'Asia/Kolkata';
const RETRYABLE_SQL = sqlArray(RETRYABLE_CONTACT_ISSUES);
const LEAD_DAILY_METRICS = new Set([
  'received',
  'worked',
  'pending',
  'personal_meeting',
  'session_9pm',
  'call_issues',
]);

function businessDateToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeLeadDailyDate(value, now = new Date()) {
  const candidate = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw new AppError(400, 'INVALID_DATE', 'selected_date must be YYYY-MM-DD');
  }
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) {
    throw new AppError(400, 'INVALID_DATE', 'selected_date must be a valid date');
  }
  if (candidate > businessDateToday(now)) {
    throw new AppError(400, 'INVALID_DATE', 'selected_date cannot be in the future');
  }
  return candidate;
}

function normalizeLeadDailyMetric(value) {
  const metric = String(value || 'received').trim().toLowerCase();
  if (!LEAD_DAILY_METRICS.has(metric)) {
    throw new AppError(400, 'INVALID_DAILY_METRIC', 'Select a valid daily lead metric');
  }
  return metric;
}

function onBusinessDateSql(column, dateParam) {
  return `(${column} >= (${dateParam}::timestamp AT TIME ZONE '${IST}') AND ${column} < (((${dateParam} + 1)::date)::timestamp AT TIME ZONE '${IST}'))`;
}

function buildLeadDailyMetricConditions(dateParam, leadAlias = 'l') {
  const lead = String(leadAlias || 'l').trim();
  const received = onBusinessDateSql(`${lead}.created_at`, dateParam);
  const personalMeetingActivity = `EXISTS (
    SELECT 1 FROM customer_notes daily_pm
     WHERE daily_pm.lead_id = ${lead}.id
       AND daily_pm.note_kind = 'personal_meeting'
       AND daily_pm.deleted_at IS NULL
       AND ${onBusinessDateSql('daily_pm.created_at', dateParam)}
  )`;
  const workedActivity = `(
    EXISTS (SELECT 1 FROM lead_remarks daily_lr WHERE daily_lr.lead_id = ${lead}.id AND ${onBusinessDateSql('daily_lr.created_at', dateParam)})
    OR EXISTS (SELECT 1 FROM lead_workflow_history daily_wh WHERE daily_wh.lead_id = ${lead}.id AND ${onBusinessDateSql('daily_wh.created_at', dateParam)})
    OR EXISTS (SELECT 1 FROM lead_call_logs daily_cl WHERE daily_cl.lead_id = ${lead}.id AND ${onBusinessDateSql('daily_cl.created_at', dateParam)})
    OR EXISTS (SELECT 1 FROM lead_call_attempts daily_ca WHERE daily_ca.lead_id = ${lead}.id AND daily_ca.status = 'completed' AND ${onBusinessDateSql('COALESCE(daily_ca.attempted_at, daily_ca.created_at)', dateParam)})
    OR ${personalMeetingActivity}
  )`;
  const worked = `(${received} AND ${workedActivity})`;
  const pending = `(
    ${lead}.assigned_to_user_id IS NOT NULL
    AND ${received}
    AND (
      NOT ${workedActivity}
      OR EXISTS (
        SELECT 1 FROM lead_remarks daily_followup
         WHERE daily_followup.lead_id = ${lead}.id
           AND daily_followup.next_followup_at IS NOT NULL
           AND ${onBusinessDateSql('daily_followup.next_followup_at', dateParam)}
      )
      OR EXISTS (
        SELECT 1 FROM lead_call_attempts daily_due
         WHERE daily_due.lead_id = ${lead}.id
           AND daily_due.attempt_number > 1
           AND daily_due.status IN ('scheduled', 'missed')
           AND ${onBusinessDateSql('daily_due.scheduled_at', dateParam)}
      )
    )
  )`;
  const session9pmActivity = `(
    EXISTS (
      SELECT 1 FROM lead_remarks daily_session_remark
       WHERE daily_session_remark.lead_id = ${lead}.id
         AND ${onBusinessDateSql('daily_session_remark.created_at', dateParam)}
         AND (
           daily_session_remark.call_status::text = 'session_730_attend'
           OR COALESCE(daily_session_remark.call_statuses, '[]'::jsonb) ? 'session_730_attend'
         )
    )
    OR EXISTS (
      SELECT 1 FROM lead_workflow_history daily_session_history
       WHERE daily_session_history.lead_id = ${lead}.id
         AND ${onBusinessDateSql('daily_session_history.created_at', dateParam)}
         AND (
           daily_session_history.new_value = 'session_730_attend'
           OR (COALESCE(daily_session_history.metadata, '{}'::jsonb)->'step_1_statuses') ? 'session_730_attend'
         )
    )
  )`;
  const personalMeeting = `(${received} AND ${personalMeetingActivity})`;
  const session9pm = `(${received} AND ${session9pmActivity})`;
  const retryableIssueActivity = `(
    EXISTS (
      SELECT 1 FROM lead_remarks daily_issue_remark
       WHERE daily_issue_remark.lead_id = ${lead}.id
         AND ${onBusinessDateSql('daily_issue_remark.created_at', dateParam)}
         AND (
           daily_issue_remark.call_status::text = ANY(${RETRYABLE_SQL})
           OR COALESCE(daily_issue_remark.call_statuses, '[]'::jsonb) ?| ${RETRYABLE_SQL}
         )
    )
    OR EXISTS (
      SELECT 1 FROM lead_workflow_history daily_issue_history
       WHERE daily_issue_history.lead_id = ${lead}.id
         AND ${onBusinessDateSql('daily_issue_history.created_at', dateParam)}
         AND (
           daily_issue_history.new_value = ANY(${RETRYABLE_SQL})
           OR (COALESCE(daily_issue_history.metadata, '{}'::jsonb)->'step_1_statuses') ?| ${RETRYABLE_SQL}
         )
    )
    OR EXISTS (
      SELECT 1 FROM lead_call_attempts daily_issue_attempt
       WHERE daily_issue_attempt.lead_id = ${lead}.id
         AND daily_issue_attempt.status = 'completed'
         AND daily_issue_attempt.outcome::text = ANY(${RETRYABLE_SQL})
         AND ${onBusinessDateSql('COALESCE(daily_issue_attempt.attempted_at, daily_issue_attempt.created_at)', dateParam)}
    )
    OR EXISTS (
      SELECT 1 FROM lead_call_attempt_sequences daily_issue_sequence
       WHERE daily_issue_sequence.lead_id = ${lead}.id
         AND daily_issue_sequence.initial_trigger_reason::text = ANY(${RETRYABLE_SQL})
         AND ${onBusinessDateSql('daily_issue_sequence.created_at', dateParam)}
    )
  )`;
  const callIssues = `(
    ${lead}.assigned_to_user_id IS NOT NULL
    AND ${received}
    AND ${retryableIssueActivity}
    AND ${unresolvedRetryableCallIssueSql(lead)}
  )`;

  return {
    received,
    worked,
    pending,
    personal_meeting: personalMeeting,
    session_9pm: session9pm,
    call_issues: callIssues,
  };
}

function leadDailySummarySelectSql(conditions) {
  return Object.entries(conditions)
    .map(([key, condition]) => `COUNT(*) FILTER (WHERE ${condition})::int AS ${key}`)
    .join(',\n      ');
}

module.exports = {
  LEAD_DAILY_METRICS,
  businessDateToday,
  normalizeLeadDailyDate,
  normalizeLeadDailyMetric,
  buildLeadDailyMetricConditions,
  leadDailySummarySelectSql,
};
