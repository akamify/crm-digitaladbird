-- =====================================================================
-- Migration 012: Add partner role + CP ID column for production users
-- =====================================================================

-- 1. Add 'partner' to the user_role enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'partner';

-- 2. Add cp_id column (Channel Partner ID — used for login)
ALTER TABLE users ADD COLUMN IF NOT EXISTS cp_id VARCHAR(40);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cp_id ON users(cp_id) WHERE cp_id IS NOT NULL AND deleted_at IS NULL;

-- 3. Allow phone to be NULL (some admin users may not have phone numbers)
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

-- 4. Add 'blocked' to user_status enum if not present
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'blocked';
