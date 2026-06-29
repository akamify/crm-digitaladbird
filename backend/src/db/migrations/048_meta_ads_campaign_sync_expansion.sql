-- 048: Meta ad account and campaign sync expansion
-- Additive only. Keeps existing Meta lead/campaign behavior while storing
-- live account/campaign status, counts, and safe raw payload snapshots.

ALTER TABLE meta_ad_accounts
  ADD COLUMN IF NOT EXISTS timezone_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS amount_spent BIGINT,
  ADD COLUMN IF NOT EXISTS balance BIGINT,
  ADD COLUMN IF NOT EXISTS created_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disable_reason INTEGER,
  ADD COLUMN IF NOT EXISTS campaign_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_campaign_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paused_campaign_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS draft_campaign_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS archived_campaign_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deleted_campaign_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sync_status VARCHAR(40) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS raw_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE meta_campaigns
  ADD COLUMN IF NOT EXISTS status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS ui_status VARCHAR(80),
  ADD COLUMN IF NOT EXISTS budget_remaining BIGINT,
  ADD COLUMN IF NOT EXISTS spend_cap BIGINT,
  ADD COLUMN IF NOT EXISTS special_ad_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS raw_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_status VARCHAR(40) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS impressions BIGINT,
  ADD COLUMN IF NOT EXISTS reach BIGINT,
  ADD COLUMN IF NOT EXISTS spend NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS leads INTEGER,
  ADD COLUMN IF NOT EXISTS cost_per_result NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS last_metrics_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metrics_error TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_ad_accounts_account_id_unique
  ON meta_ad_accounts(account_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_campaigns_campaign_id_unique
  ON meta_campaigns(campaign_id);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_account_status
  ON meta_campaigns(ad_account_id, effective_status);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_ui_status
  ON meta_campaigns(ui_status);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_meta_updated_time
  ON meta_campaigns(meta_updated_time DESC NULLS LAST);
