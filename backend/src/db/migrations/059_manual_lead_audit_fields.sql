-- 059: Manual lead source/audit metadata.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS manual_added_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_added_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_leads_manual_added_by
  ON leads(manual_added_by_user_id, manual_added_at DESC)
  WHERE manual_added_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_created_by
  ON leads(created_by_user_id, created_at DESC)
  WHERE created_by_user_id IS NOT NULL;
