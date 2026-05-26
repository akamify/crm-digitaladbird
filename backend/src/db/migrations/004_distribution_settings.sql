-- =====================================================================
-- Migration 004: Distribution timing & admin settings table
-- =====================================================================

CREATE TABLE IF NOT EXISTS distribution_settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT         NOT NULL,
  label      VARCHAR(200),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed default values
INSERT INTO distribution_settings (key, value, label) VALUES
  ('auto_distribution_enabled', 'true',  'Enable automatic lead distribution'),
  ('distribution_start_hour',   '8',     'Distribution start time (IST hour, 0-23)'),
  ('distribution_end_hour',     '22',    'Distribution end time   (IST hour, 0-23)'),
  ('distribution_timezone',     'Asia/Kolkata', 'Timezone for distribution window')
ON CONFLICT (key) DO NOTHING;
