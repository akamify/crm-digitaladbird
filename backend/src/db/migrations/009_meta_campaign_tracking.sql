-- 009: Meta campaign tracking — add campaign/adset/ad IDs to leads, campaign mapping table

-- Add Meta ad-level attribution columns to leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_campaign_id  VARCHAR(64);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_adset_id     VARCHAR(64);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_ad_id        VARCHAR(64);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_created_time TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(meta_campaign_id) WHERE meta_campaign_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_adset    ON leads(meta_adset_id)    WHERE meta_adset_id IS NOT NULL AND deleted_at IS NULL;

-- Campaign mapping table: maps Meta campaign_id to internal labels (C1, C2, C3 etc.)
CREATE TABLE IF NOT EXISTS meta_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     VARCHAR(64) UNIQUE NOT NULL,   -- Meta's campaign_id
  campaign_name   VARCHAR(300),                  -- Name from Meta API
  internal_label  VARCHAR(60) NOT NULL,          -- C1, C2, C3, etc.
  ad_account_id   VARCHAR(64),                   -- which ad account
  category        VARCHAR(20) DEFAULT 'partner'
                  CHECK (category IN ('partner', 'trader')),
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_label ON meta_campaigns(internal_label);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_account ON meta_campaigns(ad_account_id);

-- Ad account registry
CREATE TABLE IF NOT EXISTS meta_ad_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      VARCHAR(64) UNIQUE NOT NULL,   -- e.g. act_4427126714020065
  account_name    VARCHAR(200),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Meta lead sync log — tracks sync runs to avoid re-processing
CREATE TABLE IF NOT EXISTS meta_sync_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type       VARCHAR(30) NOT NULL,           -- 'form_leads', 'campaign_leads', 'full'
  source_id       VARCHAR(64),                    -- form_id or campaign_id synced
  leads_fetched   INTEGER NOT NULL DEFAULT 0,
  leads_created   INTEGER NOT NULL DEFAULT 0,
  leads_duplicate INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_log_type ON meta_sync_log(sync_type, started_at DESC);

-- Updated_at trigger for meta_campaigns
DROP TRIGGER IF EXISTS trg_meta_campaigns_updated_at ON meta_campaigns;
CREATE TRIGGER trg_meta_campaigns_updated_at BEFORE UPDATE ON meta_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
