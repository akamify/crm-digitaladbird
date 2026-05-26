-- =====================================================================
-- Migration 002: Hierarchy roles, member types, lead categories
-- =====================================================================

-- 1. Extend user_role enum with super_admin
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'super_admin';

-- 2. member_type as constrained text column (avoids custom enum DDL inside transaction)
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_type VARCHAR(20) CHECK (member_type IN ('fresher', 'veteran'));

-- 3. lead category as constrained text column
ALTER TABLE leads ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'trader' CHECK (category IN ('partner', 'trader'));

-- 4. Rename existing admin → super_admin
UPDATE users SET role = 'super_admin' WHERE role = 'admin';
