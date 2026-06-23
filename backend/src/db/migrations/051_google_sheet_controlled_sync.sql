CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE user_google_sheet_connections
  ADD COLUMN IF NOT EXISTS auto_sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS last_auto_pull_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS auto_sync_paused_until TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS dropdowns_configured_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS protected_columns_configured_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS google_sheet_pending_sync_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'crm',
  created_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_google_sheet_pending_sync_status
  ON google_sheet_pending_sync_events(status, created_at);

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_google_sheet_pending_sync_one_pending_lead
    ON google_sheet_pending_sync_events(lead_id)
    WHERE status = 'pending';
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'Skipped unique pending lead sync index because duplicate pending events already exist.';
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_user_google_sheet_one_active_spreadsheet
    ON user_google_sheet_connections(spreadsheet_id)
    WHERE disconnected_at IS NULL AND spreadsheet_id IS NOT NULL;
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'Skipped unique active spreadsheet index because duplicate active spreadsheet connections already exist.';
END $$;
