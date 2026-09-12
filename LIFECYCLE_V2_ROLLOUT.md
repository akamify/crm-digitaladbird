# Counselor Lifecycle V2 rollout

Lifecycle V2 is additive and migration `073_counselor_lifecycle_v2.sql` leaves the global feature flag disabled. Do not enable it globally in the same release as the migration.

## Phase 1: schema and disabled code

1. Back up PostgreSQL and deploy the backend/frontend code.
2. Run `npm run migrate` from `backend` before restarting the application processes.
3. Confirm `/health` and `/health/db` are healthy.
4. Confirm `workflow_settings.lifecycle_v2_enabled` is `false` and `lifecycle_v2_pilot_user_ids` is empty.
5. Confirm the legacy Lead Workflow and Call Retry flows still save normally.

## Phase 2: dry-run checks

Run read-only checks before selecting pilot users:

```sql
SELECT terminal_state, journey_stage, COUNT(*)
FROM lead_lifecycle_state
GROUP BY terminal_state, journey_stage
ORDER BY terminal_state NULLS FIRST, journey_stage;

SELECT COUNT(*) AS missing_state
FROM leads l
LEFT JOIN lead_lifecycle_state s ON s.lead_id = l.id
WHERE l.deleted_at IS NULL AND s.lead_id IS NULL;

SELECT COUNT(*) AS multiple_active_primary_actions
FROM (
  SELECT lead_id
  FROM lead_actions
  WHERE is_primary = TRUE AND status IN ('scheduled', 'in_progress', 'paused', 'overdue')
  GROUP BY lead_id
  HAVING COUNT(*) > 1
) duplicate_actions;
```

Do not invent missing historical actions. The deadline worker creates the first actionable item only for enabled pilot counselors or after global enablement.

## Phase 3: pilot

Use the authenticated Super Admin `PATCH /api/workflow-settings` endpoint to set only `lifecycle_v2_pilot_user_ids`. Start with one counselor and keep `lifecycle_v2_enabled` false.

Verify for the pilot:

- Counselor Workspace counts open the same lead set as each count.
- CNR from a Personal Meeting follow-up pauses that stage action and links the Retry Plan to it.
- Completing or closing the retry resumes the original stage action.
- Converted/Cold cancels future actions and retries without deleting history.
- Reassignment moves active actions to the current counselor and manager escalations to the RM.
- Common Meeting uses the configured meeting time and next-working-day outcome deadline in `Asia/Kolkata`.

## Phase 4: expand

Expand pilot IDs gradually. Enable `lifecycle_v2_enabled` globally only after authenticated staging smoke tests, production query-plan review, metric parity, and pilot sign-off. Keep the collapsed legacy Call Issues and Retry Plan available until direct Lifecycle V2 retry parity is confirmed.

Rollback is configuration-only: set the global flag to false and clear pilot IDs. Do not roll back migration `073`; the additive tables preserve audit history and legacy workflow remains authoritative while V2 is disabled.


