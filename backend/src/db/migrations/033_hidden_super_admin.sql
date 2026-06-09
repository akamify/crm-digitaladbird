-- Migration 033: hidden super-admin "system account" support
--
-- Adds three protection flags to users + a trigger that blocks
-- delete / role-change / status-change / un-hide / un-protect at the
-- DATABASE level — even if an admin route forgets to check, or a
-- malicious user reaches the DB directly through psql, the trigger
-- still refuses the change.
--
-- The flags are:
--   is_hidden          — row never returned in user-list endpoints
--                        (filtered in queries; not enforced at DB layer
--                        so the owner can still find it via SELECT for
--                        bootstrap / recovery)
--   is_system_account  — created by env-driven bootstrap, not by UI
--   is_protected       — cannot be deleted, role-changed, status-changed,
--                        un-hidden, or un-protected. Enforced by trigger
--                        below.
--
-- To remove a protected account, an operator with direct DB access must
-- first UPDATE the row to SET is_protected = FALSE in a SQL session
-- that uses session_replication_role = replica (which the trigger
-- specifically does NOT bypass), or drop the trigger temporarily.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_hidden         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_system_account BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_protected      BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_hidden_protected
  ON users (is_hidden, is_protected)
  WHERE is_hidden = TRUE OR is_protected = TRUE;

-- ─── Trigger function ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION block_protected_user_changes()
RETURNS TRIGGER AS $$
BEGIN
  -- DELETE: refuse unconditionally if the row is protected.
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_protected = TRUE THEN
      RAISE EXCEPTION 'PROTECTED_ACCOUNT_DELETE_BLOCKED: refusing to delete % (id=%)', OLD.email, OLD.id
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE on a protected row: refuse the change if it touches any
  -- critical attribute. last_login_at, last_seen_at, password_hash
  -- updates are allowed so the owner can use the account normally.
  IF TG_OP = 'UPDATE' AND OLD.is_protected = TRUE THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'PROTECTED_ACCOUNT_ROLE_CHANGE_BLOCKED: % cannot have role changed', OLD.email
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'PROTECTED_ACCOUNT_STATUS_CHANGE_BLOCKED: % cannot be deactivated', OLD.email
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      RAISE EXCEPTION 'PROTECTED_ACCOUNT_SOFT_DELETE_BLOCKED: % cannot be soft-deleted', OLD.email
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.is_protected IS DISTINCT FROM OLD.is_protected THEN
      RAISE EXCEPTION 'PROTECTED_ACCOUNT_UNPROTECT_BLOCKED: cannot un-protect % via normal UPDATE', OLD.email
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.is_hidden IS DISTINCT FROM OLD.is_hidden THEN
      RAISE EXCEPTION 'PROTECTED_ACCOUNT_UNHIDE_BLOCKED: cannot un-hide % via normal UPDATE', OLD.email
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.distribution_blocked IS DISTINCT FROM OLD.distribution_blocked AND NEW.distribution_blocked = TRUE THEN
      RAISE EXCEPTION 'PROTECTED_ACCOUNT_BLOCK_BLOCKED: % cannot be distribution-blocked', OLD.email
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_protected_user_changes ON users;
CREATE TRIGGER trg_block_protected_user_changes
  BEFORE UPDATE OR DELETE ON users
  FOR EACH ROW
  EXECUTE FUNCTION block_protected_user_changes();
