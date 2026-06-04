-- Extend activity_logs for a complete audit-trail view.
--   old_value / new_value — string-encoded before/after (use JSON.stringify
--     when the value is structured, otherwise just the literal).
--   user_agent            — raw User-Agent header so admin can see "Chrome
--     on Windows" vs "Mobile Safari" at-a-glance.
--   session_id            — links a row to a specific auth_sessions row,
--     letting the UI compute session duration from the matching
--     login/logout pair.

ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS old_value TEXT;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS new_value TEXT;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS session_id UUID;

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_time   ON activity_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity      ON activity_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_session     ON activity_logs(session_id)
  WHERE session_id IS NOT NULL;
