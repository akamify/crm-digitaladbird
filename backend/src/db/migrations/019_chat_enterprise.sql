-- =====================================================================
-- Enterprise Chat: pinned messages, @mentions, delete-for-me,
-- message pins, admin export logs
-- =====================================================================

-- Pinned messages per conversation (max 3 pinned)
CREATE TABLE IF NOT EXISTS chat_pinned_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  pinned_by       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, conversation_id)
);

-- Per-user message deletion (delete for me)
CREATE TABLE IF NOT EXISTS chat_deleted_for_user (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

-- @mentions in messages
CREATE TABLE IF NOT EXISTS chat_mentions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

-- Chat export logs for admin
CREATE TABLE IF NOT EXISTS chat_export_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  exported_by     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_path       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chat_pinned_conv ON chat_pinned_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_deleted_for_user ON chat_deleted_for_user(user_id, message_id);
CREATE INDEX IF NOT EXISTS idx_chat_mentions_user ON chat_mentions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_mentions_msg ON chat_mentions(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_export_conv ON chat_export_logs(conversation_id);
