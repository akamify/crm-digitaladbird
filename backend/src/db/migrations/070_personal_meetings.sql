-- 070: Structured Personal Meeting support on existing customer_notes.

ALTER TABLE customer_notes
  ADD COLUMN IF NOT EXISTS note_kind TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS meeting_number INTEGER NULL,
  ADD COLUMN IF NOT EXISTS meeting_owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS meeting_owner_custom_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS meeting_owner_custom_designation TEXT NULL,
  ADD COLUMN IF NOT EXISTS meeting_mode TEXT NULL,
  ADD COLUMN IF NOT EXISTS meeting_mode_custom TEXT NULL,
  ADD COLUMN IF NOT EXISTS meeting_link TEXT NULL,
  ADD COLUMN IF NOT EXISTS meeting_end_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NULL,
  ADD COLUMN IF NOT EXISTS pricing_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS personal_meeting_services JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS package_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS package_price NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS package_duration TEXT NULL,
  ADD COLUMN IF NOT EXISTS package_pricing_notes TEXT NULL,
  ADD COLUMN IF NOT EXISTS client_requirements TEXT NULL,
  ADD COLUMN IF NOT EXISTS client_objections TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS objection_notes TEXT NULL,
  ADD COLUMN IF NOT EXISTS meeting_outcome TEXT NULL,
  ADD COLUMN IF NOT EXISTS next_meeting_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS followup_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS followup_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS followup_note TEXT NULL;

UPDATE customer_notes
   SET note_kind = 'meeting_schedule'
 WHERE note_kind = 'general'
   AND COALESCE(meeting_name, '') <> ''
   AND meeting_at IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_notes_note_kind_check'
  ) THEN
    ALTER TABLE customer_notes
      ADD CONSTRAINT customer_notes_note_kind_check
      CHECK (note_kind IN ('general', 'meeting_schedule', 'personal_meeting'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_notes_meeting_mode_check'
  ) THEN
    ALTER TABLE customer_notes
      ADD CONSTRAINT customer_notes_meeting_mode_check
      CHECK (meeting_mode IS NULL OR meeting_mode IN ('zoom', 'google_meet', 'phone_call', 'in_person', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_notes_pricing_type_check'
  ) THEN
    ALTER TABLE customer_notes
      ADD CONSTRAINT customer_notes_pricing_type_check
      CHECK (pricing_type IS NULL OR pricing_type IN ('individual_services', 'package'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_notes_followup_required_consistency_check'
  ) THEN
    ALTER TABLE customer_notes
      ADD CONSTRAINT customer_notes_followup_required_consistency_check
      CHECK (
        followup_required = FALSE
        OR followup_at IS NOT NULL
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_notes_note_kind
  ON customer_notes(note_kind);

CREATE INDEX IF NOT EXISTS idx_customer_notes_meeting_owner_user_id
  ON customer_notes(meeting_owner_user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_notes_personal_meeting_outcome
  ON customer_notes(meeting_outcome)
  WHERE deleted_at IS NULL AND note_kind = 'personal_meeting';

CREATE INDEX IF NOT EXISTS idx_customer_notes_personal_meeting_time
  ON customer_notes(meeting_at DESC, meeting_end_at DESC)
  WHERE deleted_at IS NULL AND note_kind = 'personal_meeting';

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_notes_personal_meeting_number
  ON customer_notes(lead_id, meeting_number)
  WHERE note_kind = 'personal_meeting' AND meeting_number IS NOT NULL;
