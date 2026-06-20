-- User lifecycle hardening:
-- - partner users are normalized to member
-- - CP IDs become backend-generated MSA######## values
-- - block/delete lifecycle metadata is added
-- - email/phone/CP ID remain reserved even after soft delete

ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'deleted';

ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS delete_reason TEXT;

DO $$
DECLARE
  duplicate_cp_count INTEGER;
  duplicate_email_count INTEGER;
  duplicate_phone_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_cp_count
    FROM (
      SELECT UPPER(TRIM(cp_id))
        FROM users
       WHERE cp_id IS NOT NULL AND TRIM(cp_id) <> ''
       GROUP BY UPPER(TRIM(cp_id))
      HAVING COUNT(*) > 1
    ) d;

  SELECT COUNT(*) INTO duplicate_email_count
    FROM (
      SELECT LOWER(TRIM(email))
        FROM users
       WHERE email IS NOT NULL AND TRIM(email) <> ''
       GROUP BY LOWER(TRIM(email))
      HAVING COUNT(*) > 1
    ) d;

  SELECT COUNT(*) INTO duplicate_phone_count
    FROM (
      SELECT TRIM(phone)
        FROM users
       WHERE phone IS NOT NULL AND TRIM(phone) <> ''
       GROUP BY TRIM(phone)
      HAVING COUNT(*) > 1
    ) d;

  IF duplicate_cp_count > 0 OR duplicate_email_count > 0 OR duplicate_phone_count > 0 THEN
    RAISE EXCEPTION
      'User lifecycle migration stopped: duplicate groups found. cp_id=%, email=%, phone=%. Resolve manually before rerun.',
      duplicate_cp_count, duplicate_email_count, duplicate_phone_count;
  END IF;
END $$;

UPDATE users
   SET email = LOWER(TRIM(email))
 WHERE email IS NOT NULL;

UPDATE users
   SET phone = TRIM(phone)
 WHERE phone IS NOT NULL;

UPDATE users
   SET cp_id = UPPER(TRIM(cp_id))
 WHERE cp_id IS NOT NULL AND TRIM(cp_id) <> '';

WITH missing AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
    FROM users
   WHERE cp_id IS NULL OR TRIM(cp_id) = ''
)
UPDATE users u
   SET cp_id = 'MSA' || LPAD(((missing.rn + 9000000)::text), 8, '0')
  FROM missing
 WHERE u.id = missing.id;

UPDATE users
   SET role = 'member'
 WHERE role::text = 'partner';

UPDATE users
   SET report_to_id = NULL
 WHERE role = 'rm' AND report_to_id IS NOT NULL;

UPDATE users
   SET team_name = COALESCE(NULLIF(TRIM(team_name), ''), full_name || ' Team')
 WHERE role = 'rm';

UPDATE users
   SET is_available = FALSE
 WHERE status IN ('blocked', 'deleted') OR deleted_at IS NOT NULL;

UPDATE users
   SET status = 'deleted'
 WHERE deleted_at IS NOT NULL;

DROP INDEX IF EXISTS idx_users_cp_id;
DROP INDEX IF EXISTS idx_users_cp_id_unique;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cp_id_unique
  ON users (UPPER(cp_id));

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique_reserved
  ON users (LOWER(email))
  WHERE email IS NOT NULL AND TRIM(email) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique_reserved
  ON users (phone)
  WHERE phone IS NOT NULL AND TRIM(phone) <> '';

ALTER TABLE users ALTER COLUMN cp_id SET NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_cp_id_normalized_check;
ALTER TABLE users
  ADD CONSTRAINT users_cp_id_normalized_check
  CHECK (cp_id = UPPER(TRIM(cp_id)) AND cp_id <> '') NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT users_cp_id_normalized_check;
