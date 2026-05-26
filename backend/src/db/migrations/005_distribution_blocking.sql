-- =====================================================================
-- Migration 005: Pending-work blocking & approval system
-- =====================================================================

-- 1. Per-user distribution blocking flag
ALTER TABLE users ADD COLUMN IF NOT EXISTS distribution_blocked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS distribution_blocked_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS distribution_blocked_at TIMESTAMPTZ;

-- 2. Approval requests table  (admin approves to unblock distribution)
CREATE TABLE IF NOT EXISTS distribution_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pending_count   INTEGER NOT NULL DEFAULT 0,
  total_assigned  INTEGER NOT NULL DEFAULT 0,
  worked_count    INTEGER NOT NULL DEFAULT 0,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at     TIMESTAMPTZ,
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_dist_approvals_user   ON distribution_approvals(user_id);
CREATE INDEX IF NOT EXISTS idx_dist_approvals_status ON distribution_approvals(status) WHERE status = 'pending';

-- 3. Distribution settings: pending threshold
INSERT INTO distribution_settings (key, value, label) VALUES
  ('pending_block_threshold', '3', 'Block distribution when member has this many unworked leads')
ON CONFLICT (key) DO NOTHING;

-- 4. Lead category default fix (ensure category has a sensible default)
ALTER TABLE leads ALTER COLUMN category SET DEFAULT 'partner';

-- 5. Index for queue queries
CREATE INDEX IF NOT EXISTS idx_leads_unassigned
  ON leads(created_at ASC) WHERE assigned_to_user_id IS NULL AND deleted_at IS NULL;
