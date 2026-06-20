-- 040: Lead assignment notifications + campaign persistence support.
-- Additive only; no historical lead data is removed.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS campaign_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS adset_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS ad_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS form_name VARCHAR(190),
  ADD COLUMN IF NOT EXISTS page_id VARCHAR(64);

UPDATE leads
   SET campaign_id = COALESCE(campaign_id, meta_campaign_id),
       adset_id = COALESCE(adset_id, meta_adset_id),
       ad_id = COALESCE(ad_id, meta_ad_id),
       page_id = COALESCE(page_id, meta_page_id)
 WHERE source = 'meta';

ALTER TABLE meta_forms
  ADD COLUMN IF NOT EXISTS campaign_name VARCHAR(300),
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stale_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_campaign_id ON leads(campaign_id) WHERE campaign_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_form_name ON leads(form_name) WHERE form_name IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_meta_forms_stale ON meta_forms(is_active, stale_at);
