-- 057: Workflow Step 2 multi-select plus Call Cut / Busy status.
-- This migration is intentionally additive/backward compatible.

ALTER TYPE call_status ADD VALUE IF NOT EXISTS 'call_cut_busy';

ALTER TABLE lead_workflow ADD COLUMN IF NOT EXISTS step_2_statuses JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE lead_workflow
   SET step_2_statuses = jsonb_build_array(lead_level)
 WHERE lead_level IS NOT NULL
   AND (step_2_statuses IS NULL OR step_2_statuses = '[]'::jsonb);

CREATE INDEX IF NOT EXISTS idx_lead_workflow_step2_statuses
  ON lead_workflow USING GIN (step_2_statuses);
