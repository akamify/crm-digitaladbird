ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS google_sheet_last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS google_sheet_last_spreadsheet_id TEXT,
  ADD COLUMN IF NOT EXISTS google_sheet_last_sheet_name TEXT,
  ADD COLUMN IF NOT EXISTS google_sheet_last_sync_error TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_google_sheet_last_synced_at
  ON leads(google_sheet_last_synced_at);
