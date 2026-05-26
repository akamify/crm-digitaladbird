-- Add human-readable campaign/adset/ad names to leads table
-- These are fetched from Meta Graph API during lead ingestion
ALTER TABLE leads ADD COLUMN IF NOT EXISTS campaign_name VARCHAR(300);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS adset_name   VARCHAR(300);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ad_name      VARCHAR(300);

-- Backfill from raw_payload where available
UPDATE leads
   SET campaign_name = raw_payload->>'campaign_name',
       adset_name    = raw_payload->>'adset_name',
       ad_name       = raw_payload->>'ad_name'
 WHERE source = 'meta'
   AND raw_payload IS NOT NULL
   AND campaign_name IS NULL;
