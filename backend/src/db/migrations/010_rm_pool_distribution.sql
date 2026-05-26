-- 010: RM Pool & Request-Based Distribution
--
-- New workflow:
--   1. Meta leads arrive → stored in global queue (unassigned)
--   2. RMs request leads from global queue → leads move to RM pool
--   3. Members request leads from their RM → leads move from RM pool to member
--   4. During active hours (8 AM - 7 PM IST), a continuous engine auto-fills
--      RM requests from the global queue and member requests from RM pools.
--   5. During storage mode (7 PM - 8 AM), leads are only stored, never assigned.

-- RM lead requests (RMs requesting from global queue)
CREATE TABLE IF NOT EXISTS rm_lead_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rm_id           UUID NOT NULL REFERENCES users(id),
  quantity        INTEGER NOT NULL CHECK (quantity >= 1 AND quantity <= 500),
  category        VARCHAR(20) CHECK (category IS NULL OR category IN ('partner', 'trader')),
  fulfilled_count INTEGER NOT NULL DEFAULT 0,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'partial', 'fulfilled', 'cancelled')),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rm_requests_status ON rm_lead_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_rm_requests_rm     ON rm_lead_requests(rm_id, status);

-- RM Pool: leads assigned to an RM but not yet to a member
-- We track this by setting assigned_to_user_id = RM's id and adding a pool marker.
-- Rather than a separate table, we add a column to leads to distinguish
-- "in RM pool" vs "assigned to member".
ALTER TABLE leads ADD COLUMN IF NOT EXISTS pool_rm_id UUID REFERENCES users(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS pool_assigned_at TIMESTAMPTZ;

-- pool_rm_id = RM who "owns" this lead in their pool
-- assigned_to_user_id = final member (NULL while in RM pool)
-- When a lead is in RM pool: pool_rm_id = RM, assigned_to_user_id = NULL
-- When assigned to member:   pool_rm_id = RM, assigned_to_user_id = member

CREATE INDEX IF NOT EXISTS idx_leads_pool_rm ON leads(pool_rm_id)
  WHERE pool_rm_id IS NOT NULL AND assigned_to_user_id IS NULL AND deleted_at IS NULL;

-- Update distribution end hour to 19 (7 PM IST)
UPDATE distribution_settings SET value = '19' WHERE key = 'distribution_end_hour';

-- Updated_at trigger for rm_lead_requests
DROP TRIGGER IF EXISTS trg_rm_lead_requests_updated_at ON rm_lead_requests;
CREATE TRIGGER trg_rm_lead_requests_updated_at BEFORE UPDATE ON rm_lead_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
