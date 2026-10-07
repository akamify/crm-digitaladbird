// Shared evidence fields for distribution rows and workflow drill-downs.
const fields = `      latest_attempt.attempt_number,
      latest_attempt.status::text AS attempt_status,
      latest_attempt.scheduled_at AS attempt_scheduled_at,
      latest_attempt.attempted_at,
      latest_attempt.outcome::text AS attempt_outcome,
      latest_attempt.trigger_reason::text AS attempt_reason,
      next_attempt.scheduled_at AS next_attempt_at,
      conversion_evidence.converted_at,
      conversion_evidence.conversion_source,
      GREATEST(c.updated_at, COALESCE(latest_remark.created_at, c.updated_at), COALESCE(last_call.created_at, c.updated_at)) AS last_activity_at`;
const joins = `    LEFT JOIN LATERAL (
      SELECT ca.attempt_number, ca.status, ca.scheduled_at, ca.attempted_at, ca.outcome, ca.trigger_reason
        FROM lead_call_attempts ca
       WHERE ca.lead_id = c.id
       ORDER BY COALESCE(ca.attempted_at, ca.scheduled_at, ca.created_at) DESC, ca.attempt_number DESC
       LIMIT 1
    ) latest_attempt ON TRUE
    LEFT JOIN LATERAL (
      SELECT ca.scheduled_at
        FROM lead_call_attempts ca
        JOIN lead_call_attempt_sequences seq ON seq.id = ca.sequence_id AND seq.status = 'active'
       WHERE ca.lead_id = c.id AND ca.status = 'scheduled'
       ORDER BY ca.scheduled_at ASC LIMIT 1
    ) next_attempt ON TRUE
    LEFT JOIN LATERAL (
      SELECT cl.created_at FROM lead_call_logs cl WHERE cl.lead_id = c.id ORDER BY cl.created_at DESC LIMIT 1
    ) last_call ON TRUE
    LEFT JOIN LATERAL (
      SELECT evidence.converted_at, evidence.conversion_source
      FROM (
        SELECT lr.created_at AS converted_at, 'remark'::text AS conversion_source
          FROM lead_remarks lr
         WHERE lr.lead_id = c.id
           AND (lr.call_status::text = 'converted' OR COALESCE(lr.call_statuses, '[]'::jsonb) ? 'converted')
        UNION ALL
        SELECT wh.created_at, 'workflow'::text
          FROM lead_workflow_history wh
         WHERE wh.lead_id = c.id
           AND (wh.new_value = 'converted' OR (COALESCE(wh.metadata, '{}'::jsonb)->'step_1_statuses') ? 'converted')
        UNION ALL
        SELECT le.occurred_at, 'lifecycle'::text
          FROM lead_lifecycle_events le
         WHERE le.lead_id = c.id
           AND le.event_type = 'lifecycle_closed'
           AND COALESCE(le.metadata->>'terminal_state', '') = 'converted'
        UNION ALL
        SELECT NULL::timestamptz, 'lead_state'::text
         WHERE c.call_status::text = 'converted' OR c.stage::text = 'won'
      ) evidence
      ORDER BY evidence.converted_at DESC NULLS LAST
      LIMIT 1
    ) conversion_evidence ON TRUE
`;


function attemptsSql(leadFilter) { return `
      SELECT ca.id, ca.lead_id, ca.attempt_number, ca.status::text AS status,
        ca.trigger_reason::text AS trigger_reason, ca.outcome::text AS outcome,
        ca.scheduled_at, ca.attempted_at, ca.is_final_attempt,
        CASE
          WHEN ca.attempt_number = 1 THEN 'initial_issue'
          WHEN ca.status = 'completed' THEN 'completed'
          WHEN ca.status = 'missed' OR (ca.status = 'scheduled' AND ca.scheduled_at <= NOW()) THEN 'missed'
          WHEN ca.status = 'scheduled' THEN 'upcoming'
          ELSE 'not_required'
        END AS attempt_state,
        CASE WHEN ca.status IN ('scheduled', 'missed') AND ca.scheduled_at <= NOW()
          THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - ca.scheduled_at)) / 60))::int END AS overdue_by_minutes
      FROM lead_call_attempts ca
      JOIN lead_call_attempt_sequences seq ON seq.id = ca.sequence_id AND seq.status = 'active'
      WHERE ${leadFilter}
      ORDER BY ca.lead_id, ca.attempt_number ASC`; }
module.exports={fields,joins,attemptsSql};
