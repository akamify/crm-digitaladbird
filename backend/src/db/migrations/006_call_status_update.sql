-- Migration 006: Update call_status system and is_pending column
-- NOTE: The new enum values (cnr, cw, nc, etc.) are added by a pre-migration
-- script because ALTER TYPE ADD VALUE cannot run inside a transaction.

-- Add call_status enum values required by this migration.
-- These statements must run outside a transaction in PostgreSQL.
ALTER TYPE call_status ADD VALUE IF NOT EXISTS 'cnr';
ALTER TYPE call_status ADD VALUE IF NOT EXISTS 'cw';
ALTER TYPE call_status ADD VALUE IF NOT EXISTS 'nc';
ALTER TYPE call_status ADD VALUE IF NOT EXISTS 'ccb';
ALTER TYPE call_status ADD VALUE IF NOT EXISTS 'ni';
ALTER TYPE call_status ADD VALUE IF NOT EXISTS 'so';
ALTER TYPE call_status ADD VALUE IF NOT EXISTS 'nn';
-- Drop views that depend on is_pending before modifying the column
DROP VIEW IF EXISTS v_user_daily_stats;
DROP VIEW IF EXISTS v_team_overview;

-- Update the is_pending generated column to include the new "unanswered" statuses.
-- is_pending = true when the lead hasn't had a meaningful conversation yet.
ALTER TABLE leads DROP COLUMN IF EXISTS is_pending;
ALTER TABLE leads ADD COLUMN is_pending BOOLEAN GENERATED ALWAYS AS (
  call_status = 'not_called'::call_status
  OR call_status = 'rnr'::call_status
  OR call_status = 'busy'::call_status
  OR call_status = 'switched_off'::call_status
  OR call_status = 'cnr'::call_status
  OR call_status = 'cw'::call_status
  OR call_status = 'nc'::call_status
  OR call_status = 'ccb'::call_status
  OR call_status = 'ni'::call_status
  OR call_status = 'so'::call_status
  OR call_status = 'nn'::call_status
) STORED;

-- Re-create the pending index
DROP INDEX IF EXISTS idx_leads_pending;
CREATE INDEX idx_leads_pending ON leads(is_pending) WHERE is_pending = TRUE AND deleted_at IS NULL;

-- Recreate the views
CREATE OR REPLACE VIEW v_user_daily_stats AS
SELECT assigned_to_user_id AS user_id,
    date(assigned_at) AS day,
    count(*) AS leads_received,
    count(*) FILTER (WHERE call_status <> 'not_called'::call_status) AS leads_worked,
    count(*) FILTER (WHERE call_status = 'converted'::call_status) AS conversions,
    count(*) FILTER (WHERE is_pending) AS pending,
    count(*) FILTER (WHERE call_status = 'rnr'::call_status OR call_status = 'cnr'::call_status) AS rnr,
    count(*) FILTER (WHERE call_status = 'not_interested'::call_status) AS not_interested
   FROM leads l
  WHERE deleted_at IS NULL AND assigned_to_user_id IS NOT NULL
  GROUP BY assigned_to_user_id, date(assigned_at);

CREATE OR REPLACE VIEW v_team_overview AS
SELECT rm.id AS rm_id,
    rm.full_name AS rm_name,
    count(DISTINCT m.id) AS members,
    count(l.id) AS team_leads,
    count(l.id) FILTER (WHERE l.call_status = 'converted'::call_status) AS team_conversions,
    count(l.id) FILTER (WHERE l.is_pending) AS team_pending
   FROM users rm
     LEFT JOIN users m ON m.report_to_id = rm.id AND m.role = 'member'::user_role AND m.deleted_at IS NULL
     LEFT JOIN leads l ON l.assigned_to_user_id = m.id AND l.deleted_at IS NULL
  WHERE rm.role = 'rm'::user_role AND rm.deleted_at IS NULL
  GROUP BY rm.id, rm.full_name;

