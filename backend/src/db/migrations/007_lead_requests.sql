-- Lead Request System
-- Members can request leads; RMs/Admins approve; leads are assigned from queue.

CREATE TABLE IF NOT EXISTS lead_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  quantity      INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1 AND quantity <= 50),
  category      VARCHAR(20),          -- 'partner', 'trader', or NULL (any)
  status        VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'fulfilled')),
  note          TEXT,                  -- optional note from requester
  resolved_by   UUID REFERENCES users(id),
  resolved_at   TIMESTAMPTZ,
  resolve_note  TEXT,                  -- note from approver
  leads_assigned INTEGER DEFAULT 0,    -- how many leads were actually assigned
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_requests_user   ON lead_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_lead_requests_status ON lead_requests(status, created_at);
