-- =====================================================================
-- Migration 003: Allow non-unique phone numbers (shared test/OTP number)
--                and make phone nullable (email is now primary login ID)
-- =====================================================================
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key;
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
