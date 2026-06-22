CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS user_google_sheet_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_email TEXT NULL,
  google_account_id TEXT NULL,
  spreadsheet_id TEXT NULL,
  spreadsheet_name TEXT NULL,
  default_sheet_name TEXT DEFAULT 'Leads',
  trader_sheet_name TEXT DEFAULT 'Traders',
  partner_sheet_name TEXT DEFAULT 'Partners',
  unknown_sheet_name TEXT DEFAULT 'Unknown Leads',
  access_token_encrypted TEXT NULL,
  refresh_token_encrypted TEXT NULL,
  token_expiry TIMESTAMPTZ NULL,
  scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
  sync_enabled BOOLEAN DEFAULT TRUE,
  last_sync_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  disconnected_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_google_sheet_connections_user_id
  ON user_google_sheet_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_user_google_sheet_connections_disconnected_at
  ON user_google_sheet_connections(disconnected_at);
CREATE INDEX IF NOT EXISTS idx_user_google_sheet_connections_spreadsheet_id
  ON user_google_sheet_connections(spreadsheet_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_google_sheet_connections_one_active
  ON user_google_sheet_connections(user_id)
  WHERE disconnected_at IS NULL;

CREATE TABLE IF NOT EXISTS user_google_sheet_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NULL REFERENCES user_google_sheet_connections(id) ON DELETE SET NULL,
  user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  sync_type TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'started',
  records_attempted INT DEFAULT 0,
  records_synced INT DEFAULT 0,
  records_failed INT DEFAULT 0,
  details JSONB DEFAULT '{}'::jsonb,
  error_message TEXT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_user_google_sheet_sync_logs_user_id
  ON user_google_sheet_sync_logs(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_google_sheet_sync_logs_connection_id
  ON user_google_sheet_sync_logs(connection_id, started_at DESC);
