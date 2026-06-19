-- Secure password reset/onboarding support and globally unique CP IDs.
-- This migration intentionally stops before modifying data when normalized
-- duplicate CP IDs exist. Resolve those rows manually, then rerun migrate.

DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
    FROM (
      SELECT UPPER(TRIM(cp_id))
        FROM users
       WHERE cp_id IS NOT NULL AND TRIM(cp_id) <> ''
       GROUP BY UPPER(TRIM(cp_id))
      HAVING COUNT(*) > 1
    ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'CP ID migration stopped: % normalized duplicate group(s) found. Run the documented duplicate query and resolve them manually.',
      duplicate_count;
  END IF;
END $$;

UPDATE users
   SET cp_id = UPPER(TRIM(cp_id))
 WHERE cp_id IS NOT NULL AND TRIM(cp_id) <> '';

UPDATE users
   SET cp_id = 'DAB-' || UPPER(REPLACE(id::text, '-', ''))
 WHERE cp_id IS NULL OR TRIM(cp_id) = '';

DROP INDEX IF EXISTS idx_users_cp_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cp_id_unique
  ON users (UPPER(cp_id));

ALTER TABLE users ALTER COLUMN cp_id SET NOT NULL;
ALTER TABLE users
  ADD CONSTRAINT users_cp_id_normalized_check
  CHECK (cp_id = UPPER(TRIM(cp_id)) AND cp_id <> '') NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT users_cp_id_normalized_check;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash           TEXT NOT NULL UNIQUE,
  purpose              VARCHAR(30) NOT NULL DEFAULT 'password_reset'
                         CHECK (purpose IN ('password_reset', 'new_user_setup', 'admin_forced_reset')),
  requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at           TIMESTAMPTZ NOT NULL,
  used_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address           INET,
  user_agent           TEXT,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user_created
  ON password_reset_tokens(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_expires
  ON password_reset_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_unused
  ON password_reset_tokens(user_id, purpose, expires_at)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS email_delivery_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  email_to            TEXT NOT NULL,
  email_type          VARCHAR(50) NOT NULL
                        CHECK (email_type IN ('password_reset', 'new_user_onboarding', 'admin_reset_link')),
  provider            VARCHAR(50) NOT NULL DEFAULT 'brevo',
  provider_message_id TEXT,
  status              VARCHAR(30) NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at             TIMESTAMPTZ,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_email_delivery_user_created
  ON email_delivery_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_delivery_type_status
  ON email_delivery_logs(email_type, status, created_at DESC);
