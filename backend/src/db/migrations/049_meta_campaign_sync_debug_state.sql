-- 049: Meta campaign sync debug/freshness state
-- Additive fields to distinguish fresh API counts from stale last-known data.

ALTER TABLE meta_ad_accounts
  ADD COLUMN IF NOT EXISTS discovery_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS graph_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS last_sync_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_successful_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_count_api_available BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS total_returned_by_api INTEGER,
  ADD COLUMN IF NOT EXISTS missing_from_latest_sync_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_campaign_sync_run_id UUID;

ALTER TABLE meta_campaigns
  ADD COLUMN IF NOT EXISTS last_seen_sync_run_id UUID,
  ADD COLUMN IF NOT EXISTS missing_from_latest_sync BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_missing_latest
  ON meta_campaigns(ad_account_id, missing_from_latest_sync);
