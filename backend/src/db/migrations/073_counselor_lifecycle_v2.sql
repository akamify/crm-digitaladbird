-- 073: Additive Counselor Lifecycle V2 foundation.
-- Existing workflow/status columns remain intact for backward compatibility.

CREATE TABLE IF NOT EXISTS workflow_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  label TEXT NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO workflow_settings(key, value, label) VALUES
  ('lifecycle_v2_enabled', 'false'::jsonb, 'Enable Counselor Lifecycle V2'),
  ('lifecycle_v2_pilot_user_ids', '[]'::jsonb, 'Lifecycle V2 pilot counselor IDs'),
  ('first_contact_sla_minutes', '15'::jsonb, 'New lead first-contact SLA in minutes'),
  ('responded_sla_minutes', '15'::jsonb, 'Responded lead next-action SLA in minutes'),
  ('call_window_start', '"09:00"'::jsonb, 'Earliest counselor calling time'),
  ('call_window_end', '"20:00"'::jsonb, 'Latest counselor calling time'),
  ('working_days', '[1,2,3,4,5,6]'::jsonb, 'Calling days using ISO weekday numbers'),
  ('common_meeting_start', '"21:00"'::jsonb, 'Default Common Meeting start time'),
  ('common_meeting_end', '"21:30"'::jsonb, 'Default Common Meeting end time'),
  ('common_meeting_outcome_deadline', '"11:00"'::jsonb, 'Next-day Common Meeting outcome deadline'),
  ('stage_followup_max_attempts', '4'::jsonb, 'Maximum stage follow-up attempts')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS lead_lifecycle_state (
  lead_id UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  journey_stage VARCHAR(32) NOT NULL DEFAULT 'new'
    CHECK (journey_stage IN ('new', 'response', 'common_meeting', 'tte', 'personal_meeting', 'quotation')),
  terminal_state VARCHAR(16)
    CHECK (terminal_state IS NULL OR terminal_state IN ('converted', 'cold')),
  cold_reason VARCHAR(64),
  cold_reason_note TEXT,
  last_call_result VARCHAR(64),
  current_primary_action_id UUID,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  CHECK (
    (terminal_state IS NULL AND closed_at IS NULL)
    OR (terminal_state IS NOT NULL AND closed_at IS NOT NULL)
  ),
  CHECK (terminal_state <> 'cold' OR cold_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS lead_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  action_type VARCHAR(48) NOT NULL CHECK (action_type IN (
    'first_contact', 'responded_next_action', 'common_meeting', 'common_meeting_outcome',
    'recontact', 'tte', 'tte_outcome', 'personal_meeting', 'personal_meeting_outcome',
    'quotation', 'callback', 'follow_up', 'manager_escalation', 'lifecycle_review', 'other'
  )),
  reason VARCHAR(96) NOT NULL,
  parent_stage VARCHAR(32),
  parent_action_id UUID REFERENCES lead_actions(id) ON DELETE SET NULL,
  responsible_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  stage_followup_attempt INTEGER CHECK (stage_followup_attempt IS NULL OR stage_followup_attempt > 0),
  stage_followup_max INTEGER CHECK (stage_followup_max IS NULL OR stage_followup_max > 0),
  status VARCHAR(24) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'in_progress', 'paused', 'overdue', 'completed', 'cancelled', 'escalated')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  outcome VARCHAR(64),
  delay_minutes INTEGER CHECK (delay_minutes IS NULL OR delay_minutes >= 0),
  pending_cycle_number INTEGER CHECK (pending_cycle_number IS NULL OR pending_cycle_number > 0),
  idempotency_key VARCHAR(128),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE lead_lifecycle_state
  DROP CONSTRAINT IF EXISTS lead_lifecycle_state_current_primary_action_fk;
ALTER TABLE lead_lifecycle_state
  ADD CONSTRAINT lead_lifecycle_state_current_primary_action_fk
  FOREIGN KEY (current_primary_action_id) REFERENCES lead_actions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_actions_one_active_primary
  ON lead_actions(lead_id)
  WHERE is_primary = TRUE AND status IN ('scheduled', 'in_progress', 'paused', 'overdue');
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_actions_idempotency
  ON lead_actions(lead_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_actions_owner_due
  ON lead_actions(responsible_user_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_lead_actions_lead_created
  ON lead_actions(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lifecycle_state_stage_terminal
  ON lead_lifecycle_state(terminal_state, journey_stage, lead_id);

CREATE TABLE IF NOT EXISTS lead_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(64) NOT NULL,
  stage_before VARCHAR(32),
  stage_after VARCHAR(32),
  call_result VARCHAR(64),
  action_id UUID REFERENCES lead_actions(id) ON DELETE SET NULL,
  related_entity_type VARCHAR(40),
  related_entity_id UUID,
  reason VARCHAR(96),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_lifecycle_events_idempotency
  ON lead_lifecycle_events(lead_id, (metadata->>'idempotency_key'))
  WHERE COALESCE(metadata->>'idempotency_key', '') <> '';
CREATE INDEX IF NOT EXISTS idx_lead_lifecycle_events_lead_time
  ON lead_lifecycle_events(lead_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_lead_lifecycle_events_user_time
  ON lead_lifecycle_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_lifecycle_events_worked
  ON lead_lifecycle_events(lead_id, event_type, occurred_at DESC);

ALTER TABLE lead_call_attempt_sequences
  ADD COLUMN IF NOT EXISTS originating_action_id UUID REFERENCES lead_actions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_lead_call_attempt_sequences_originating_action
  ON lead_call_attempt_sequences(originating_action_id)
  WHERE originating_action_id IS NOT NULL;

-- Conservative current-state projection. It does not create counselor tasks.
INSERT INTO lead_lifecycle_state(lead_id, journey_stage, terminal_state, cold_reason, closed_at)
SELECT
  l.id,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM customer_notes pm
       WHERE pm.lead_id = l.id AND pm.note_kind = 'personal_meeting' AND pm.deleted_at IS NULL
    ) THEN 'personal_meeting'
    WHEN EXISTS (
      SELECT 1 FROM lead_workflow wf
       WHERE wf.lead_id = l.id
         AND (wf.remark_status::text IN ('session_730_attend', 'yes_after_730_session')
           OR COALESCE(wf.step_1_statuses, '[]'::jsonb) ?| ARRAY['session_730_attend', 'yes_after_730_session'])
    ) THEN 'common_meeting'
    WHEN COALESCE(l.call_status::text, 'not_called') <> 'not_called' OR l.last_call_at IS NOT NULL THEN 'response'
    ELSE 'new'
  END,
  CASE
    WHEN l.stage::text = 'won' OR l.call_status::text = 'converted' THEN 'converted'
    WHEN l.stage::text IN ('lost', 'dropped') OR l.call_status::text = 'not_interested' THEN 'cold'
    ELSE NULL
  END,
  CASE
    WHEN l.stage::text IN ('lost', 'dropped') OR l.call_status::text = 'not_interested' THEN 'legacy_import'
    ELSE NULL
  END,
  CASE
    WHEN l.stage::text IN ('won', 'lost', 'dropped') OR l.call_status::text IN ('converted', 'not_interested') THEN COALESCE(l.updated_at, NOW())
    ELSE NULL
  END
FROM leads l
WHERE l.deleted_at IS NULL
ON CONFLICT (lead_id) DO NOTHING;
