-- 067: Support multi-counselor meeting schedules on customer notes.

ALTER TABLE customer_notes
  ADD COLUMN IF NOT EXISTS meeting_counselor_user_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_customer_notes_meeting_counselors_gin
  ON customer_notes
  USING GIN (meeting_counselor_user_ids);
