-- 068: Campaign-level CRM lead receiving toggle
-- Lets admins keep Meta ads running while selectively allowing/disallowing
-- lead ingestion into the CRM per campaign.

ALTER TABLE meta_campaigns
  ADD COLUMN IF NOT EXISTS lead_receiving_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_lead_receiving_enabled
  ON meta_campaigns(lead_receiving_enabled);
