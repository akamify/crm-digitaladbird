-- Step 4 conversion attachments: payment screenshot, receipt, UTR proof.
-- Files live on disk under backend/uploads/payments/<leadId>/<uuid>.<ext>
-- and the row here holds the metadata + relative file_path. The existing
-- /uploads/* static mount in app.js makes them browsable directly.

CREATE TABLE IF NOT EXISTS lead_payment_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  -- conversion_id may be null on initial upload before conversion is finalised
  conversion_id UUID REFERENCES lead_conversion(id) ON DELETE SET NULL,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,

  kind          VARCHAR(32) NOT NULL DEFAULT 'payment_screenshot'
                CHECK (kind IN ('payment_screenshot', 'receipt', 'utr', 'other')),

  file_name     VARCHAR(255) NOT NULL,    -- original filename, for display
  file_path     VARCHAR(512) NOT NULL,    -- relative path under /uploads (servable)
  mime_type     VARCHAR(120),
  size_bytes    INTEGER,

  note          TEXT,                     -- optional admin/user note

  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lead_payment_attachments_lead
  ON lead_payment_attachments(lead_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lead_payment_attachments_user
  ON lead_payment_attachments(user_id, uploaded_at DESC) WHERE deleted_at IS NULL;
