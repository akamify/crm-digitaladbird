-- 042: Production lead-category classification.
-- Lead category is separate from the CRM user role named "partner".

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS category_source TEXT,
  ADD COLUMN IF NOT EXISTS category_rule_id UUID,
  ADD COLUMN IF NOT EXISTS category_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS category_manually_updated_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS category_manually_updated_at TIMESTAMPTZ;

DO $$
DECLARE constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'leads'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE leads DROP CONSTRAINT IF EXISTS %I', constraint_row.conname);
  END LOOP;
END $$;

UPDATE leads
   SET category = 'unknown'
 WHERE category IS NULL OR BTRIM(category::text) = ''
    OR category::text NOT IN ('trader', 'partner', 'unknown');

ALTER TABLE leads ALTER COLUMN category SET DEFAULT 'unknown';
ALTER TABLE leads ALTER COLUMN category SET NOT NULL;
ALTER TABLE leads ADD CONSTRAINT leads_category_check
  CHECK (category IN ('trader', 'partner', 'unknown'));

CREATE TABLE IF NOT EXISTS lead_category_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('campaign_id','campaign_name','form_id','form_name','page_id','ad_account_id','payload_field')),
  match_value TEXT NOT NULL,
  match_mode TEXT NOT NULL DEFAULT 'exact' CHECK (match_mode IN ('exact','contains','regex')),
  category TEXT NOT NULL CHECK (category IN ('trader','partner','unknown')),
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_category_rule_id_fkey;
ALTER TABLE leads ADD CONSTRAINT leads_category_rule_id_fkey
  FOREIGN KEY (category_rule_id) REFERENCES lead_category_rules(id) ON DELETE SET NULL;

ALTER TABLE meta_forms
  ADD COLUMN IF NOT EXISTS lead_category TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS category_notes TEXT,
  ADD COLUMN IF NOT EXISTS category_updated_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS category_updated_at TIMESTAMPTZ;

DO $$
DECLARE constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'meta_campaigns'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE meta_campaigns DROP CONSTRAINT IF EXISTS %I', constraint_row.conname);
  END LOOP;
END $$;

ALTER TABLE meta_campaigns ALTER COLUMN category SET DEFAULT 'unknown';
UPDATE meta_campaigns SET category = 'unknown' WHERE category IS NULL OR category NOT IN ('trader','partner','unknown');
ALTER TABLE meta_campaigns ADD CONSTRAINT meta_campaigns_category_check
  CHECK (category IN ('trader','partner','unknown'));
ALTER TABLE meta_campaigns
  ADD COLUMN IF NOT EXISTS category_notes TEXT,
  ADD COLUMN IF NOT EXISTS category_updated_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS category_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_category ON leads(category);
CREATE INDEX IF NOT EXISTS idx_leads_meta_campaign_id ON leads(meta_campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_meta_form_id ON leads(meta_form_id);
CREATE INDEX IF NOT EXISTS idx_lead_category_rules_active ON lead_category_rules(is_active, priority);
CREATE INDEX IF NOT EXISTS idx_lead_category_rules_source ON lead_category_rules(source_type, match_value);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_category ON meta_campaigns(category);

