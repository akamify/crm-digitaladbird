-- =====================================================================
-- Chat System Upgrade: attachments, reactions, pinning, read receipts,
-- admin controls, message status tracking
-- =====================================================================

-- Attachment storage
CREATE TABLE IF NOT EXISTS chat_attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID REFERENCES chat_messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  uploader_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name       VARCHAR(500) NOT NULL,
  file_type       VARCHAR(100) NOT NULL,
  file_size       BIGINT NOT NULL DEFAULT 0,
  file_path       VARCHAR(1000) NOT NULL,
  thumbnail_path  VARCHAR(1000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Message reactions
CREATE TABLE IF NOT EXISTS chat_reactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       VARCHAR(10) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

-- Add columns to existing tables (safe with IF NOT EXISTS pattern)
DO $$ BEGIN
  -- conversations: is_pinned, is_archived, is_blocked
  ALTER TABLE chat_conversations ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE chat_conversations ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE chat_conversations ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- messages: is_deleted, replied_to
DO $$ BEGIN
  ALTER TABLE chat_messages ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE chat_messages ADD COLUMN reply_to_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- participants: is_blocked
DO $$ BEGIN
  ALTER TABLE chat_participants ADD COLUMN is_blocked BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_chat_attach_msg ON chat_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_attach_conv ON chat_attachments(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_reactions_msg ON chat_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_conv_pinned ON chat_conversations(is_pinned) WHERE is_pinned = TRUE;
CREATE INDEX IF NOT EXISTS idx_chat_msg_reply ON chat_messages(reply_to_id) WHERE reply_to_id IS NOT NULL;
