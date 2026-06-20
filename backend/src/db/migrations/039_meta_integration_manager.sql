-- 039: Meta integration manager hardening
-- Separates User Token, Page Token, webhook, forms, and campaign health.
-- Additive only; existing leads/forms/pages are preserved.

ALTER TABLE meta_pages
  ADD COLUMN IF NOT EXISTS webhook_subscribed BOOLEAN,
  ADD COLUMN IF NOT EXISTS webhook_last_checked TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS forms_last_checked TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS forms_status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stale_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS token_source VARCHAR(40) DEFAULT 'db_page_token';

ALTER TABLE meta_forms
  ADD COLUMN IF NOT EXISTS status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS leads_count INTEGER,
  ADD COLUMN IF NOT EXISTS created_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_error TEXT;

ALTER TABLE meta_ad_accounts
  ADD COLUMN IF NOT EXISTS account_status INTEGER,
  ADD COLUMN IF NOT EXISTS currency VARCHAR(20),
  ADD COLUMN IF NOT EXISTS business_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS business_name VARCHAR(190),
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE meta_campaigns
  ADD COLUMN IF NOT EXISTS meta_status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS effective_status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS configured_status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS objective VARCHAR(80),
  ADD COLUMN IF NOT EXISTS buying_type VARCHAR(80),
  ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stop_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meta_created_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meta_updated_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS daily_budget BIGINT,
  ADD COLUMN IF NOT EXISTS lifetime_budget BIGINT,
  ADD COLUMN IF NOT EXISTS source VARCHAR(40) NOT NULL DEFAULT 'meta_api',
  ADD COLUMN IF NOT EXISTS last_meta_status_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_error TEXT;

CREATE INDEX IF NOT EXISTS idx_meta_pages_active_stale
  ON meta_pages(is_active, stale_at);

CREATE INDEX IF NOT EXISTS idx_meta_pages_webhook
  ON meta_pages(is_active, webhook_subscribed);

CREATE INDEX IF NOT EXISTS idx_meta_forms_page_status
  ON meta_forms(page_id, status);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_effective_status
  ON meta_campaigns(effective_status);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_source
  ON meta_campaigns(source);
