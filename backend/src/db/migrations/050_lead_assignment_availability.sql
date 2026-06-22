-- Lead-assignment-specific availability controls.
-- These do not replace login/user lifecycle status.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS lead_assignment_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS lead_assignment_status TEXT NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS lead_assignment_disabled_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS lead_assignment_updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_assignment_updated_at TIMESTAMPTZ NULL;

UPDATE users
   SET lead_assignment_enabled = FALSE,
       lead_assignment_status = 'blocked',
       lead_assignment_disabled_reason = COALESCE(lead_assignment_disabled_reason, distribution_blocked_reason)
 WHERE COALESCE(distribution_blocked, FALSE) = TRUE;

UPDATE users
   SET lead_assignment_enabled = FALSE,
       lead_assignment_status = 'unavailable'
 WHERE COALESCE(is_available, TRUE) = FALSE
   AND COALESCE(distribution_blocked, FALSE) = FALSE
   AND lead_assignment_status = 'available';

UPDATE users
   SET lead_assignment_enabled = FALSE,
       lead_assignment_status = 'disabled'
 WHERE status <> 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_lead_assignment_status_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_lead_assignment_status_check
      CHECK (lead_assignment_status IN ('available', 'unavailable', 'blocked', 'disabled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_lead_assignment_eligible
  ON users(role, report_to_id, created_at, id)
  WHERE deleted_at IS NULL
    AND status = 'active'
    AND lead_assignment_enabled = TRUE
    AND lead_assignment_status = 'available';
