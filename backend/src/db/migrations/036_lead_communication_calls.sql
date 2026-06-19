-- =====================================================================
-- 036: Lead communication hardening and in-system call logs
-- =====================================================================

CREATE TABLE IF NOT EXISTS lead_call_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id            UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider           VARCHAR(50),
  provider_call_id   VARCHAR(255),
  direction          VARCHAR(20) NOT NULL DEFAULT 'outbound',
  status             VARCHAR(30) NOT NULL DEFAULT 'initiated'
                       CHECK (status IN ('initiated','ringing','connected','completed','failed','missed','cancelled')),
  started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at           TIMESTAMPTZ,
  duration_seconds   INTEGER,
  recording_url      TEXT,
  notes              TEXT,
  failure_reason     TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_call_logs_lead_created
  ON lead_call_logs(lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_call_logs_user_created
  ON lead_call_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_call_logs_provider_call
  ON lead_call_logs(provider_call_id)
  WHERE provider_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_conversations_lead
  ON chat_conversations(lead_id)
  WHERE lead_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM chat_conversations
     WHERE type = 'lead' AND lead_id IS NOT NULL AND is_deleted = FALSE
     GROUP BY lead_id
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_chat_active_lead_conversation
      ON chat_conversations(lead_id)
      WHERE type = 'lead' AND lead_id IS NOT NULL AND is_deleted = FALSE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chat_participants_conversation
  ON chat_participants(conversation_id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created
  ON chat_messages(conversation_id, created_at DESC);
