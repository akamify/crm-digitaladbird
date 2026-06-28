-- 047: Lead sessions / webinar attendance
-- Additive only. Stores sessions attended by a lead from the Lead Profile page.

CREATE TABLE IF NOT EXISTS lead_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  session_name TEXT NOT NULL,
  session_date DATE NOT NULL,
  session_time TIME NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  notes TEXT NULL,
  created_by_user_id UUID NULL REFERENCES users(id),
  updated_by_user_id UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_sessions_lead_id
  ON lead_sessions(lead_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lead_sessions_schedule
  ON lead_sessions(session_date DESC, session_time DESC)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_lead_sessions_updated_at ON lead_sessions;
CREATE TRIGGER trg_lead_sessions_updated_at BEFORE UPDATE ON lead_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
