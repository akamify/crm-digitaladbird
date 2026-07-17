-- 062: Idempotent schema guards for manual lead and client creation.
-- This file intentionally repeats critical additive changes from earlier
-- feature migrations so production databases that missed one still become
-- compatible with the current create paths.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'client';
ALTER TYPE call_status ADD VALUE IF NOT EXISTS 'call_cut_busy';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS lead_assignment_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS lead_assignment_status TEXT NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS lead_assignment_disabled_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS lead_assignment_updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_assignment_updated_at TIMESTAMPTZ NULL;

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

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS manual_added_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_added_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS client_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE lead_assignments
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignment_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS previous_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS request_id UUID,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE lead_assignments
   SET assigned_to_user_id = COALESCE(assigned_to_user_id, user_id),
       assigned_by_user_id = COALESCE(assigned_by_user_id, assigned_by),
       assignment_type = COALESCE(assignment_type, reason, 'manual'),
       created_at = COALESCE(created_at, assigned_at, NOW())
 WHERE assigned_to_user_id IS NULL
    OR assigned_by_user_id IS NULL
    OR assignment_type IS NULL;

ALTER TABLE lead_remarks
  ADD COLUMN IF NOT EXISTS stage lead_stage,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS workflow_step INT,
  ADD COLUMN IF NOT EXISTS is_completed_response BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS call_statuses JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE lead_remarks
   SET call_statuses = jsonb_build_array(call_status::text)
 WHERE call_status IS NOT NULL
   AND (call_statuses IS NULL OR call_statuses = '[]'::jsonb);

ALTER TABLE lead_workflow
  ADD COLUMN IF NOT EXISTS step_1_statuses JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE lead_workflow
   SET step_1_statuses = jsonb_build_array(remark_status::text)
 WHERE remark_status IS NOT NULL
   AND (step_1_statuses IS NULL OR step_1_statuses = '[]'::jsonb);

ALTER TABLE meta_pages
  ADD COLUMN IF NOT EXISTS client_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE meta_forms
  ADD COLUMN IF NOT EXISTS client_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE meta_ad_accounts
  ADD COLUMN IF NOT EXISTS client_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE meta_campaigns
  ADD COLUMN IF NOT EXISTS client_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_lead_assignment_eligible
  ON users(role, report_to_id, created_at, id)
  WHERE deleted_at IS NULL
    AND status = 'active'
    AND lead_assignment_enabled = TRUE
    AND lead_assignment_status = 'available';

CREATE INDEX IF NOT EXISTS idx_leads_manual_added_by
  ON leads(manual_added_by_user_id, manual_added_at DESC)
  WHERE manual_added_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_created_by_user
  ON leads(created_by_user_id, created_at DESC)
  WHERE created_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_client_id
  ON leads(client_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lead_assignments_lead_created
  ON lead_assignments(lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_remarks_source
  ON lead_remarks(source);

CREATE INDEX IF NOT EXISTS idx_lead_remarks_call_statuses
  ON lead_remarks USING GIN (call_statuses);

CREATE INDEX IF NOT EXISTS idx_lead_workflow_step1_statuses
  ON lead_workflow USING GIN (step_1_statuses);

CREATE INDEX IF NOT EXISTS idx_meta_pages_client_id
  ON meta_pages(client_id);

CREATE INDEX IF NOT EXISTS idx_meta_forms_client_id
  ON meta_forms(client_id);

CREATE INDEX IF NOT EXISTS idx_meta_ad_accounts_client_id
  ON meta_ad_accounts(client_id);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_client_id
  ON meta_campaigns(client_id);
