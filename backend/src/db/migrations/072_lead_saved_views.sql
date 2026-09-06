-- 072: Per-user saved filters for the Leads workspace.
CREATE TABLE IF NOT EXISTS lead_saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_saved_views_filters_object_check CHECK (jsonb_typeof(filters) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_saved_views_user_name
  ON lead_saved_views(user_id, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_lead_saved_views_user_updated
  ON lead_saved_views(user_id, updated_at DESC, id);
