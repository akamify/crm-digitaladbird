CREATE TABLE IF NOT EXISTS lead_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(60) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#2563EB',
  visibility VARCHAR(16) NOT NULL DEFAULT 'custom' CHECK (visibility IN ('global', 'custom')),
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (created_by_user_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_global_lead_label_name
  ON lead_labels (LOWER(name))
  WHERE visibility = 'global' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lead_labels_creator ON lead_labels(created_by_user_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS lead_label_assignments (
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES lead_labels(id) ON DELETE CASCADE,
  assigned_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lead_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_label_assignments_label ON lead_label_assignments(label_id, lead_id);
