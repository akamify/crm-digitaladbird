-- Central notification/email support for lead assignment and request events.

ALTER TABLE user_notifications
  ADD COLUMN IF NOT EXISTS event_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id UUID,
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS email_status TEXT,
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_notifications_dedupe_key
  ON user_notifications(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT c.conname INTO constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'email_delivery_logs'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%email_type%'
   LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE email_delivery_logs DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE email_delivery_logs
  ADD CONSTRAINT email_delivery_logs_email_type_check
  CHECK (email_type IN (
    'password_reset',
    'new_user_onboarding',
    'admin_reset_link',
    'leads_assigned',
    'leads_reassigned_new_assignee',
    'leads_reassigned_old_assignee',
    'lead_request_submitted',
    'lead_request_approved',
    'lead_request_partially_approved',
    'lead_request_rejected',
    'partner_request_submitted',
    'partner_request_approved',
    'partner_request_partially_approved',
    'partner_request_rejected',
    'rm_request_submitted',
    'rm_request_approved',
    'rm_request_rejected',
    'bulk_leads_assigned',
    'auto_leads_distributed',
    'lead_assignment_failed'
  ));

