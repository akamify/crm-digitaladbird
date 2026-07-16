-- 060: Store raw Meta status payload separately from full raw_meta.

ALTER TABLE meta_campaigns
  ADD COLUMN IF NOT EXISTS raw_status_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_successful_sync_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_sync_status_stale
  ON meta_campaigns(ad_account_id, sync_status, last_synced_at DESC);
