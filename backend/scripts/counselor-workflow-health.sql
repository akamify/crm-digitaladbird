-- Operator-only, read-only checks. Run after migration 074, never via a public API.
-- Includes paused/nonpilot history: apply the approved pilot scope when setting alerts.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT policy_version,queue,COUNT(*) AS states,
       COUNT(*) FILTER (WHERE followup_override) AS custom_overrides,
       COUNT(*) FILTER (WHERE awaiting_primary) AS awaiting_primary
FROM counselor_workflow_state GROUP BY policy_version,queue;

SELECT COUNT(*) AS actionable_backlog,
       MAX(EXTRACT(EPOCH FROM NOW()-COALESCE(s.move_to_old_at,s.move_to_pending_at))) AS max_lag_seconds
FROM counselor_workflow_state s JOIN leads l ON l.id=s.lead_id JOIN users u ON u.id=l.assigned_to_user_id
WHERE NOT s.followup_override AND NOT s.awaiting_primary AND l.next_followup_at IS NULL AND l.deleted_at IS NULL
  AND u.role IN ('member','partner') AND s.assigned_to_user_id=l.assigned_to_user_id
  AND s.assignment_at IS NOT DISTINCT FROM l.assigned_at
  AND COALESCE(s.move_to_old_at,s.move_to_pending_at)<=NOW();

SELECT event_type,COUNT(*) AS events,
       AVG(EXTRACT(EPOCH FROM recorded_at-occurred_at)) FILTER (WHERE source='deadline') AS average_deadline_lag_seconds
FROM counselor_workflow_events WHERE recorded_at>=NOW()-INTERVAL '15 minutes'
GROUP BY event_type;

SELECT actor_id,COUNT(*) AS work_events,
       COUNT(DISTINCT lead_id) FILTER (WHERE work_source='new') AS n,
       COUNT(DISTINCT lead_id) FILTER (WHERE work_source='old') AS o
FROM counselor_workflow_events
WHERE is_work AND occurred_at >= ((NOW() AT TIME ZONE 'Asia/Kolkata')::date::timestamp AT TIME ZONE 'Asia/Kolkata')
GROUP BY actor_id;
COMMIT;
