-- Activity log table for admin/RM/member actions.
--
-- Several endpoints (sheets trigger-sync, broadcast, admin actions, webhook
-- activity feed) write here, and the admin dashboard reads `WHERE entity = ...`
-- streams from it. Migration 015 already had an IF EXISTS guard for the
-- indexes, so this CREATE TABLE is the source of truth.
--
-- Separate from `audit_logs` (which is a stricter security trail with no
-- denormalised user fields) on purpose: activity_logs carries `user_name` and
-- `user_role` so the UI can render history without a join even if the user
-- is later soft-deleted.

CREATE TABLE IF NOT EXISTS activity_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  user_name   VARCHAR(190),
  user_role   VARCHAR(32),
  entity      VARCHAR(64)  NOT NULL,
  entity_id   VARCHAR(190),
  action      VARCHAR(64)  NOT NULL,
  metadata    JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_entity_created
  ON activity_logs(entity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_created
  ON activity_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created
  ON activity_logs(created_at DESC);
