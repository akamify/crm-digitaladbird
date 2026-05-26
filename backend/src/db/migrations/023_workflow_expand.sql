-- =====================================================================
-- 023: Expand workflow — add Day 8-14 to followup tracker,
-- followup_status to conversion table
-- =====================================================================

-- Day 8-14 columns on lead_followup_tracker
ALTER TABLE lead_followup_tracker ADD COLUMN IF NOT EXISTS day_8  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE lead_followup_tracker ADD COLUMN IF NOT EXISTS day_8_at  TIMESTAMPTZ;
ALTER TABLE lead_followup_tracker ADD COLUMN IF NOT EXISTS day_9  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE lead_followup_tracker ADD COLUMN IF NOT EXISTS day_9_at  TIMESTAMPTZ;
ALTER TABLE lead_followup_tracker ADD COLUMN IF NOT EXISTS day_10 BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE lead_followup_tracker ADD COLUMN IF NOT EXISTS day_10_at TIMESTAMPTZ;
ALTER TABLE lead_followup_tracker ADD COLUMN IF NOT EXISTS day_11 BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE lead_followup_tracker ADD COLUMN IF NOT EXISTS day_11_at TIMESTAMPTZ;
ALTER TABLE lead_followup_tracker ADD COLUMN IF NOT EXISTS day_12 BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE lead_followup_tracker ADD COLUMN IF NOT EXISTS day_12_at TIMESTAMPTZ;
ALTER TABLE lead_followup_tracker ADD COLUMN IF NOT EXISTS day_13 BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE lead_followup_tracker ADD COLUMN IF NOT EXISTS day_13_at TIMESTAMPTZ;
ALTER TABLE lead_followup_tracker ADD COLUMN IF NOT EXISTS day_14 BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE lead_followup_tracker ADD COLUMN IF NOT EXISTS day_14_at TIMESTAMPTZ;

-- Follow-up status on conversion table
ALTER TABLE lead_conversion ADD COLUMN IF NOT EXISTS followup_status TEXT;
