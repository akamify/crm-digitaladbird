-- =====================================================================
-- 022: Member Lead Workflow System
-- Adds step-based workflow: Remark → Lead Level → Follow Tracker → Conversion
-- All persistent, database-driven, tied to lead_id + user_id
-- =====================================================================

-- Step 1 & 2: Lead workflow progress (remark selection + lead level)
CREATE TABLE IF NOT EXISTS lead_workflow (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Step 1: Remark selection
  remark_status   VARCHAR(50),
  remark_saved_at TIMESTAMPTZ,

  -- Step 2: Lead level
  lead_level      VARCHAR(50),
  lead_level_saved_at TIMESTAMPTZ,

  -- Step 3 completion flag
  followup_completed BOOLEAN NOT NULL DEFAULT FALSE,
  followup_completed_at TIMESTAMPTZ,

  -- Step 4 completion flag
  conversion_completed BOOLEAN NOT NULL DEFAULT FALSE,
  conversion_completed_at TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(lead_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_workflow_user ON lead_workflow(user_id);
CREATE INDEX IF NOT EXISTS idx_lead_workflow_lead ON lead_workflow(lead_id);

-- Step 3: Follow-up day tracker (checkbox states)
CREATE TABLE IF NOT EXISTS lead_followup_tracker (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Attendance
  attendance_730  BOOLEAN NOT NULL DEFAULT FALSE,
  attendance_730_at TIMESTAMPTZ,
  yes_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  yes_confirmation_at TIMESTAMPTZ,

  -- Daily follow-ups (Day 1-7)
  day_1           BOOLEAN NOT NULL DEFAULT FALSE,
  day_1_at        TIMESTAMPTZ,
  day_2           BOOLEAN NOT NULL DEFAULT FALSE,
  day_2_at        TIMESTAMPTZ,
  day_3           BOOLEAN NOT NULL DEFAULT FALSE,
  day_3_at        TIMESTAMPTZ,
  day_4           BOOLEAN NOT NULL DEFAULT FALSE,
  day_4_at        TIMESTAMPTZ,
  day_5           BOOLEAN NOT NULL DEFAULT FALSE,
  day_5_at        TIMESTAMPTZ,
  day_6           BOOLEAN NOT NULL DEFAULT FALSE,
  day_6_at        TIMESTAMPTZ,
  day_7           BOOLEAN NOT NULL DEFAULT FALSE,
  day_7_at        TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(lead_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_followup_tracker_user ON lead_followup_tracker(user_id);

-- Step 4: Conversion data
CREATE TABLE IF NOT EXISTS lead_conversion (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  address         TEXT,
  total_payment   DECIMAL(12,2),
  part_payment    DECIMAL(12,2),
  customer_type   VARCHAR(20) CHECK (customer_type IN ('partner', 'trader')),
  services        TEXT,

  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(lead_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_conversion_user ON lead_conversion(user_id);

-- Workflow history log for audit trail
CREATE TABLE IF NOT EXISTS lead_workflow_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step            SMALLINT NOT NULL CHECK (step BETWEEN 1 AND 4),
  action          VARCHAR(50) NOT NULL,
  old_value       TEXT,
  new_value       TEXT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_wf_history_lead ON lead_workflow_history(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_wf_history_user ON lead_workflow_history(user_id, created_at DESC);
