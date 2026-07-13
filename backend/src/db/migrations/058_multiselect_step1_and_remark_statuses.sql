-- 058: Store multi-select statuses for remarks and workflow Step 1.

ALTER TABLE lead_remarks
  ADD COLUMN IF NOT EXISTS call_statuses JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE lead_workflow
  ADD COLUMN IF NOT EXISTS step_1_statuses JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE lead_remarks
   SET call_statuses = jsonb_build_array(call_status::text)
 WHERE call_status IS NOT NULL
   AND (call_statuses IS NULL OR call_statuses = '[]'::jsonb);

UPDATE lead_workflow
   SET step_1_statuses = jsonb_build_array(remark_status::text)
 WHERE remark_status IS NOT NULL
   AND (step_1_statuses IS NULL OR step_1_statuses = '[]'::jsonb);

CREATE INDEX IF NOT EXISTS idx_lead_remarks_call_statuses
  ON lead_remarks USING GIN (call_statuses);

CREATE INDEX IF NOT EXISTS idx_lead_workflow_step1_statuses
  ON lead_workflow USING GIN (step_1_statuses);
