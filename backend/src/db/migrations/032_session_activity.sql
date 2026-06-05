-- Track the most recent activity on each session so the Activity Logs page
-- can show "Last Activity Time" and compute "Session Duration" cleanly.
--   last_activity_at  — bumped by an Express middleware on every
--     authenticated API call (throttled to 30s so we don't hammer the DB
--     on chatty React Query polling).
--   last_activity_ip  — most recent client IP for the session, useful when
--     a session has been used from multiple networks.

ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_activity_ip INET;

-- Backfill last_activity_at to created_at so existing sessions don't show NULL.
UPDATE auth_sessions
   SET last_activity_at = COALESCE(last_activity_at, created_at)
 WHERE last_activity_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
  ON auth_sessions(user_id, last_activity_at DESC) WHERE revoked_at IS NULL;
