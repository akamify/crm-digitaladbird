-- Dynamic, admin-managed integration configs (Google Sheets, Meta, etc.)
-- Replaces hardcoded ./credentials/google-service-account.json + env vars.
-- Each row holds an encrypted JSON blob — only the backend can decrypt
-- (key derived from JWT_ACCESS_SECRET, never exposed via API).

CREATE TABLE IF NOT EXISTS integration_configs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                 VARCHAR(32) NOT NULL,            -- 'google_sheets' | 'meta'
  label                VARCHAR(120) NOT NULL,
  -- Cleartext fields the user edits frequently (sheet id / name etc.) — safe to
  -- show in admin UI. Sensitive material (private_key, tokens) goes in secrets.
  config               JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- AES-256-GCM encrypted blob: { iv, tag, ciphertext } base64-encoded.
  -- Decryption happens server-side only.
  secrets_encrypted    TEXT,
  is_active            BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Last-known liveness check
  last_tested_at       TIMESTAMPTZ,
  last_test_ok         BOOLEAN,
  last_test_error      TEXT,
  -- Last successful sync
  last_synced_at       TIMESTAMPTZ,
  last_sync_count      INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_configs_kind_active
  ON integration_configs(kind, is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_integration_configs_kind
  ON integration_configs(kind);

-- At most ONE active row per kind (enforces "switch active sheet instantly" semantics).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_integration_configs_one_active_per_kind
  ON integration_configs(kind) WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS trg_integration_configs_updated_at ON integration_configs;
CREATE TRIGGER trg_integration_configs_updated_at BEFORE UPDATE ON integration_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
