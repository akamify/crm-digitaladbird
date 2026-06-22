CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS status TEXT NULL;

ALTER TABLE user_google_sheet_connections
  ADD COLUMN IF NOT EXISTS retry_after_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS sync_started_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS tabs_valid BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS headers_valid BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS setup_checked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS missing_tabs JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS invalid_headers JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS user_google_sheet_row_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES user_google_sheet_connections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sheet_name TEXT NOT NULL,
  row_number INTEGER NULL,
  last_pushed_hash TEXT NULL,
  last_pulled_hash TEXT NULL,
  last_crm_updated_at TIMESTAMPTZ NULL,
  last_sheet_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  sync_status TEXT NOT NULL DEFAULT 'synced',
  last_synced_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(connection_id, lead_id, sheet_name)
);

CREATE INDEX IF NOT EXISTS idx_user_google_sheet_row_state_connection
  ON user_google_sheet_row_sync_state(connection_id, sheet_name, row_number);
CREATE INDEX IF NOT EXISTS idx_user_google_sheet_row_state_lead
  ON user_google_sheet_row_sync_state(lead_id, updated_at DESC);
