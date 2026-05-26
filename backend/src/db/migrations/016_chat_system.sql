-- =====================================================================
-- Chat & Communication System
-- Conversations, messages, lead threads, broadcasts, notifications
-- =====================================================================

-- Conversation types: 'direct' (1:1), 'lead' (lead discussion), 'broadcast' (admin announcements)
CREATE TABLE IF NOT EXISTS chat_conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          VARCHAR(20) NOT NULL DEFAULT 'direct' CHECK (type IN ('direct','lead','broadcast')),
  title         VARCHAR(255),
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Participants in each conversation
CREATE TABLE IF NOT EXISTS chat_participants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_muted        BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(conversation_id, user_id)
);

-- Messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  message_type    VARCHAR(20) NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','system','file')),
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at       TIMESTAMPTZ
);

-- Read receipts per message
CREATE TABLE IF NOT EXISTS chat_read_receipts (
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);

-- Chat notifications (separate from existing user_notifications)
CREATE TABLE IF NOT EXISTS chat_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            VARCHAR(50) NOT NULL DEFAULT 'message',
  title           VARCHAR(255) NOT NULL,
  body            TEXT,
  conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  sender_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  action_url      VARCHAR(500),
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_chat_conv_type ON chat_conversations(type);
CREATE INDEX IF NOT EXISTS idx_chat_conv_lead ON chat_conversations(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_conv_updated ON chat_conversations(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_participants_conv ON chat_participants(conversation_id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages(sender_id);

CREATE INDEX IF NOT EXISTS idx_chat_read_user ON chat_read_receipts(user_id);

CREATE INDEX IF NOT EXISTS idx_chat_notif_user_unread ON chat_notifications(user_id, created_at DESC) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_chat_notif_conv ON chat_notifications(conversation_id) WHERE conversation_id IS NOT NULL;
