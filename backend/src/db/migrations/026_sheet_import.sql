-- Sheet → CRM import: track auto-import flag + last-run stats on each config,
-- plus a separate log table so admins can see every import attempt.

ALTER TABLE integration_configs
  ADD COLUMN IF NOT EXISTS auto_import_enabled BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_import_minutes INTEGER     NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS last_import_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_import_stats   JSONB;

CREATE TABLE IF NOT EXISTS sheet_import_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id       UUID REFERENCES integration_configs(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  triggered_by    VARCHAR(20)  NOT NULL DEFAULT 'manual', -- manual | auto
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  total_rows      INTEGER NOT NULL DEFAULT 0,
  imported        INTEGER NOT NULL DEFAULT 0,
  duplicates      INTEGER NOT NULL DEFAULT 0,
  failed          INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  failed_samples  JSONB
);

CREATE INDEX IF NOT EXISTS idx_sheet_import_logs_config_started
  ON sheet_import_logs(config_id, started_at DESC);
