-- 065: Advanced counselor + RM customer notes with approval workflow.

CREATE TABLE IF NOT EXISTS customer_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  customer_phone TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_second_name TEXT NULL,
  business_name TEXT NULL,
  about_client TEXT NULL,
  client_services_want TEXT NULL,
  client_budget TEXT NULL,
  meeting_name TEXT NULL,
  meeting_at TIMESTAMPTZ NULL,
  counselor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rm_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approval_status TEXT NOT NULL DEFAULT 'pending_rm_approval',
  submitted_to_rm_at TIMESTAMPTZ NULL,
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ NULL,
  rejected_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ NULL,
  rejection_note TEXT NULL,
  deleted_at TIMESTAMPTZ NULL,
  deleted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'customer_notes_approval_status_check'
  ) THEN
    ALTER TABLE customer_notes
      ADD CONSTRAINT customer_notes_approval_status_check
      CHECK (approval_status IN ('pending_rm_approval', 'approved', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_notes_lead_id ON customer_notes(lead_id);
CREATE INDEX IF NOT EXISTS idx_customer_notes_customer_phone ON customer_notes(customer_phone);
CREATE INDEX IF NOT EXISTS idx_customer_notes_approval_status ON customer_notes(approval_status);
CREATE INDEX IF NOT EXISTS idx_customer_notes_rm_user_id ON customer_notes(rm_user_id);
CREATE INDEX IF NOT EXISTS idx_customer_notes_counselor_user_id ON customer_notes(counselor_user_id);
CREATE INDEX IF NOT EXISTS idx_customer_notes_last_meeting_at ON customer_notes(meeting_at);
CREATE INDEX IF NOT EXISTS idx_customer_notes_created_at ON customer_notes(created_at);

CREATE TABLE IF NOT EXISTS customer_note_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES customer_notes(id) ON DELETE CASCADE,
  entry_text TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_note_entries_note_id_created_at
  ON customer_note_entries(note_id, created_at);
CREATE INDEX IF NOT EXISTS idx_customer_note_entries_created_by_user_id
  ON customer_note_entries(created_by_user_id);
