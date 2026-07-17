-- 063: Production guards for client creation and manual lead category.
-- Clients intentionally do not get CP IDs, so the users.cp_id column must
-- allow NULL while still enforcing normalized CP IDs for RM/member/partner.

ALTER TABLE users ALTER COLUMN cp_id DROP NOT NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_cp_id_normalized_check;
ALTER TABLE users
  ADD CONSTRAINT users_cp_id_normalized_check
  CHECK (cp_id IS NULL OR (cp_id = UPPER(TRIM(cp_id)) AND cp_id <> '')) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT users_cp_id_normalized_check;

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
 WHERE category IS NULL
    OR BTRIM(category::text) = ''
    OR category::text NOT IN ('trader', 'partner', 'unknown');

ALTER TABLE leads ALTER COLUMN category SET DEFAULT 'unknown';
ALTER TABLE leads ALTER COLUMN category SET NOT NULL;
ALTER TABLE leads ADD CONSTRAINT leads_category_check
  CHECK (category IN ('trader', 'partner', 'unknown'));
