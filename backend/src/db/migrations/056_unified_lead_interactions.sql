-- 056: Unified lead remarks/workflow interaction metadata.

ALTER TABLE lead_remarks ADD COLUMN IF NOT EXISTS stage lead_stage;
ALTER TABLE lead_remarks ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE lead_remarks ADD COLUMN IF NOT EXISTS workflow_step INT;
ALTER TABLE lead_remarks ADD COLUMN IF NOT EXISTS is_completed_response BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE lead_remarks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_lead_remarks_call_status ON lead_remarks(call_status);
CREATE INDEX IF NOT EXISTS idx_lead_remarks_stage ON lead_remarks(stage);
CREATE INDEX IF NOT EXISTS idx_lead_remarks_source ON lead_remarks(source);
CREATE INDEX IF NOT EXISTS idx_lead_remarks_completed_response ON lead_remarks(is_completed_response);
CREATE INDEX IF NOT EXISTS idx_lead_workflow_remark_status ON lead_workflow(remark_status);
CREATE INDEX IF NOT EXISTS idx_leads_next_followup_at ON leads(next_followup_at);
CREATE INDEX IF NOT EXISTS idx_leads_call_status ON leads(call_status);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
