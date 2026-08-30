CREATE TABLE IF NOT EXISTS lead_call_attempt_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  status VARCHAR(32) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled', 'cold_closed')),
  opened_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  initial_trigger_reason VARCHAR(64) NOT NULL,
  closed_reason VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_call_attempt_sequences_one_active
  ON lead_call_attempt_sequences(lead_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_lead_call_attempt_sequences_lead_updated
  ON lead_call_attempt_sequences(lead_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS lead_call_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES lead_call_attempt_sequences(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  trigger_reason VARCHAR(64) NOT NULL,
  outcome VARCHAR(64),
  status VARCHAR(24) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'missed', 'cancelled')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  attempted_at TIMESTAMPTZ,
  responsible_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  delay_minutes INTEGER,
  is_final_attempt BOOLEAN NOT NULL DEFAULT FALSE,
  remark_id UUID REFERENCES lead_remarks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_call_attempts_sequence_attempt_unique UNIQUE (sequence_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_lead_call_attempts_lead_status_scheduled
  ON lead_call_attempts(lead_id, status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_lead_call_attempts_responsible_status_scheduled
  ON lead_call_attempts(responsible_user_id, status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_lead_call_attempts_sequence_attempt
  ON lead_call_attempts(sequence_id, attempt_number);
