-- 066: Extend customer_notes with meeting scheduler notification metadata.

ALTER TABLE customer_notes
  ADD COLUMN IF NOT EXISTS meeting_notification_emails TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS meeting_invite_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS meeting_reminder_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS meeting_started_email_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS meeting_completed_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_customer_notes_meeting_upcoming
  ON customer_notes(meeting_at)
  WHERE deleted_at IS NULL AND meeting_at IS NOT NULL AND meeting_completed_at IS NULL;
