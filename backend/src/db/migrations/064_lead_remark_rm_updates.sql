-- 064: Extend lead_remarks for structured RM and counselor updates.

ALTER TABLE lead_remarks
  ADD COLUMN IF NOT EXISTS note_type TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS category TEXT NULL,
  ADD COLUMN IF NOT EXISTS title TEXT NULL,
  ADD COLUMN IF NOT EXISTS priority TEXT NULL,
  ADD COLUMN IF NOT EXISTS customer_interest TEXT NULL,
  ADD COLUMN IF NOT EXISTS next_followup TIMESTAMPTZ NULL;

UPDATE lead_remarks
   SET note_type = 'general'
 WHERE note_type IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'lead_remarks_note_type_check'
  ) THEN
    ALTER TABLE lead_remarks
      ADD CONSTRAINT lead_remarks_note_type_check
      CHECK (note_type IN ('general', 'counselor_update', 'rm_update'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'lead_remarks_category_check'
  ) THEN
    ALTER TABLE lead_remarks
      ADD CONSTRAINT lead_remarks_category_check
      CHECK (category IS NULL OR category IN ('meeting', 'requirement', 'budget', 'problem', 'followup', 'status', 'proposal', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'lead_remarks_priority_check'
  ) THEN
    ALTER TABLE lead_remarks
      ADD CONSTRAINT lead_remarks_priority_check
      CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high', 'urgent'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'lead_remarks_customer_interest_check'
  ) THEN
    ALTER TABLE lead_remarks
      ADD CONSTRAINT lead_remarks_customer_interest_check
      CHECK (customer_interest IS NULL OR customer_interest IN ('cold', 'warm', 'hot', 'not_interested'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lead_remarks_note_type ON lead_remarks(note_type);
CREATE INDEX IF NOT EXISTS idx_lead_remarks_category ON lead_remarks(category);
CREATE INDEX IF NOT EXISTS idx_lead_remarks_priority ON lead_remarks(priority);
CREATE INDEX IF NOT EXISTS idx_lead_remarks_customer_interest ON lead_remarks(customer_interest);
CREATE INDEX IF NOT EXISTS idx_lead_remarks_next_followup ON lead_remarks(next_followup);
