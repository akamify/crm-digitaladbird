-- Two-sheet architecture: each Google Sheet config is now tagged with a
-- "purpose" so the admin can run a Traders sheet and a Partners sheet side by
-- side. Each purpose can have exactly one active config; the active config's
-- purpose drives lead.category on import, which the lead-request flow already
-- filters on. Existing rows keep purpose=NULL (treated as generic / both).

ALTER TABLE integration_configs
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(20);
  -- nullable on purpose: existing single-tenant deployments don't have to
  -- pick a purpose to keep working. New configs created via the UI always set
  -- one of 'traders' | 'partners'.

CREATE INDEX IF NOT EXISTS idx_integration_configs_purpose
  ON integration_configs(kind, purpose) WHERE is_active = TRUE;

-- Drop the OLD constraint that allowed only one active config per kind.
-- New constraint: at most one active config per (kind, purpose).
DROP INDEX IF EXISTS uniq_integration_configs_one_active_per_kind;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_integration_configs_one_active_per_kind_purpose
  ON integration_configs(kind, COALESCE(purpose, ''))
  WHERE is_active = TRUE;
