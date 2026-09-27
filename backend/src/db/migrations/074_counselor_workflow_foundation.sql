-- Prospective counselor workflow. No backfill, legacy status rewrite or timers.
CREATE TABLE IF NOT EXISTS counselor_workflow_state (
  lead_id UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  primary_status VARCHAR(64),
  journey_active BOOLEAN NOT NULL DEFAULT FALSE,
  queue VARCHAR(16) CHECK (queue IN ('new', 'old', 'pending')),
  policy_version VARCHAR(64) NOT NULL DEFAULT 'foundation_v1',
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0),
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assignment_id UUID,
  assignment_at TIMESTAMPTZ,
  enrolled_at TIMESTAMPTZ NOT NULL,
  workflow_started_at TIMESTAMPTZ NOT NULL,
  move_to_old_at TIMESTAMPTZ,
  move_to_pending_at TIMESTAMPTZ,
  followup_override BOOLEAN NOT NULL DEFAULT FALSE,
  awaiting_primary BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (NOT journey_active OR primary_status IS NOT NULL),
  CHECK (queue IS DISTINCT FROM 'old' OR (journey_active AND primary_status IS NOT NULL)),
  CHECK (queue IS DISTINCT FROM 'pending' OR NOT journey_active),
  CHECK (queue IS DISTINCT FROM 'new' OR (primary_status IS NULL AND NOT journey_active)),
  CHECK (NOT awaiting_primary OR (queue IS NULL AND NOT journey_active AND move_to_old_at IS NULL AND move_to_pending_at IS NULL)),
  CHECK (move_to_old_at IS NULL OR (primary_status IS NOT NULL AND journey_active)),
  CHECK (move_to_old_at IS NULL OR move_to_pending_at IS NULL OR move_to_pending_at >= move_to_old_at)
);

CREATE TABLE IF NOT EXISTS counselor_workflow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  event_type VARCHAR(48) NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source VARCHAR(64) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  primary_status VARCHAR(64),
  statuses JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(statuses) = 'array'),
  previous_state JSONB,
  new_state JSONB NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0),
  origin_id VARCHAR(128),
  idempotency_key VARCHAR(200) NOT NULL,
  request_hash VARCHAR(64),
  work_source VARCHAR(8) CHECK (work_source IN ('new', 'old')),
  is_work BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (lead_id, idempotency_key),
  CHECK (work_source IS NULL OR is_work)
);

CREATE INDEX IF NOT EXISTS idx_counselor_workflow_old_deadline
  ON counselor_workflow_state(move_to_old_at, lead_id)
  WHERE move_to_old_at IS NOT NULL AND NOT followup_override AND NOT awaiting_primary;
CREATE INDEX IF NOT EXISTS idx_counselor_workflow_pending_deadline
  ON counselor_workflow_state(move_to_pending_at, lead_id)
  WHERE move_to_pending_at IS NOT NULL AND NOT followup_override AND NOT awaiting_primary;
CREATE INDEX IF NOT EXISTS idx_counselor_workflow_owner_queue
  ON counselor_workflow_state(assigned_to_user_id, queue, lead_id);
CREATE INDEX IF NOT EXISTS idx_counselor_workflow_history
  ON counselor_workflow_events(lead_id, recorded_at, id);
CREATE INDEX IF NOT EXISTS idx_counselor_workflow_work_source
  ON counselor_workflow_events(actor_id, occurred_at, work_source, lead_id) WHERE is_work;

-- Events are append-only through the service. Foreign-key cascades retain the
-- CRM's existing explicit lead/user deletion behavior; no history is rewritten
-- when a workflow changes or is superseded.
