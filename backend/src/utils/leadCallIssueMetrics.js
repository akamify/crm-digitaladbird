const { RETRYABLE_CONTACT_ISSUES, CONTACTED_STATUSES, sqlArray } = require('../constants/counselorReportOptions');

const RETRYABLE_SQL = sqlArray(RETRYABLE_CONTACT_ISSUES);
const CONTACTED_SQL = sqlArray(CONTACTED_STATUSES);

function activeSequenceIssueSql(leadAlias = 'l') {
  return `(SELECT COALESCE(
      (SELECT ca.outcome::text
         FROM lead_call_attempts ca
        WHERE ca.sequence_id = seq.id
          AND ca.status = 'completed'
          AND ca.attempt_number > 1
          AND ca.outcome::text = ANY(${RETRYABLE_SQL})
        ORDER BY ca.attempt_number DESC, ca.attempted_at DESC NULLS LAST, ca.created_at DESC
        LIMIT 1),
      seq.initial_trigger_reason::text
    )
      FROM lead_call_attempt_sequences seq
     WHERE seq.lead_id = ${leadAlias}.id
       AND seq.status = 'active'
     ORDER BY seq.updated_at DESC, seq.created_at DESC
     LIMIT 1)`;
}

function unresolvedRetryableCallIssueSql(leadAlias = 'l') {
  const activeIssue = activeSequenceIssueSql(leadAlias);
  const hasSuccessfulContact = `(
    EXISTS (
      SELECT 1 FROM lead_workflow issue_wf
       WHERE issue_wf.lead_id = ${leadAlias}.id
         AND COALESCE(issue_wf.remark_status::text, '') = ANY(${CONTACTED_SQL})
    )
    OR EXISTS (
      SELECT 1 FROM lead_call_attempts issue_received
       WHERE issue_received.lead_id = ${leadAlias}.id
         AND issue_received.status = 'completed'
         AND issue_received.outcome = 'call_received'
    )
  )`;
  return `(
    ${activeIssue} = ANY(${RETRYABLE_SQL})
    OR (
      ${activeIssue} IS NULL
      AND ${leadAlias}.call_status::text = ANY(${RETRYABLE_SQL})
      AND NOT ${hasSuccessfulContact}
    )
  )`;
}

module.exports = {
  activeSequenceIssueSql,
  unresolvedRetryableCallIssueSql,
};
