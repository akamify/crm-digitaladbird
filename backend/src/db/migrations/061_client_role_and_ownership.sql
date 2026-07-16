-- 061: Client role and ownership links for client-scoped CRM access.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'client';

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS client_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE meta_pages
  ADD COLUMN IF NOT EXISTS client_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE meta_forms
  ADD COLUMN IF NOT EXISTS client_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE meta_ad_accounts
  ADD COLUMN IF NOT EXISTS client_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE meta_campaigns
  ADD COLUMN IF NOT EXISTS client_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_client_id
  ON leads(client_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_meta_pages_client_id
  ON meta_pages(client_id);

CREATE INDEX IF NOT EXISTS idx_meta_forms_client_id
  ON meta_forms(client_id);

CREATE INDEX IF NOT EXISTS idx_meta_ad_accounts_client_id
  ON meta_ad_accounts(client_id);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_client_id
  ON meta_campaigns(client_id);
