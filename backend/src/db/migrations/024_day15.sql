-- 024: Add Day 15 to follow-up tracker
ALTER TABLE lead_followup_tracker ADD COLUMN IF NOT EXISTS day_15 BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE lead_followup_tracker ADD COLUMN IF NOT EXISTS day_15_at TIMESTAMPTZ;
