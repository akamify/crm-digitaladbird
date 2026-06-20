-- WaspAkamify WhatsApp chat integration.

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT,
  ADD COLUMN IF NOT EXISTS customer_wa_id TEXT,
  ADD COLUMN IF NOT EXISTS external_conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS session_status TEXT DEFAULT 'closed',
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_outbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_external_unknown BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider_metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE chat_messages
  ALTER COLUMN sender_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS sender_type TEXT DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS external_message_id TEXT,
  ADD COLUMN IF NOT EXISTS external_conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS delivery_error TEXT,
  ADD COLUMN IF NOT EXISTS provider_payload JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;

ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_message_type_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_message_type_check
  CHECK (message_type IN ('text', 'system', 'file', 'voice', 'image', 'audio', 'video', 'document'));

CREATE TABLE IF NOT EXISTS wasp_webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT,
  external_message_id TEXT,
  external_conversation_id TEXT,
  customer_phone TEXT,
  customer_wa_id TEXT,
  matched_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  matched_conversation_id UUID REFERENCES chat_conversations(id) ON DELETE SET NULL,
  processing_status TEXT DEFAULT 'received',
  error_message TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wasp_logs_external_message ON wasp_webhook_logs(external_message_id);
CREATE INDEX IF NOT EXISTS idx_wasp_logs_customer_phone ON wasp_webhook_logs(customer_phone);
CREATE INDEX IF NOT EXISTS idx_wasp_logs_customer_wa_id ON wasp_webhook_logs(customer_wa_id);
CREATE INDEX IF NOT EXISTS idx_wasp_logs_matched_lead ON wasp_webhook_logs(matched_lead_id);
CREATE INDEX IF NOT EXISTS idx_wasp_logs_created ON wasp_webhook_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conv_wasp_external ON chat_conversations(provider, external_conversation_id)
  WHERE provider = 'wasp' AND external_conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_conv_customer_phone ON chat_conversations(customer_phone)
  WHERE customer_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_external ON chat_messages(provider, external_message_id)
  WHERE provider = 'wasp' AND external_message_id IS NOT NULL;

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
    'lead_assignment_failed',
    'whatsapp_inbound_message',
    'whatsapp_external_inbound'
  ));
