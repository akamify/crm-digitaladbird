-- =====================================================================
-- Advanced Chat: starred messages, edit tracking, forwarding,
-- last seen, message status, archive per-user
-- =====================================================================

-- Starred / bookmarked messages per user
CREATE TABLE IF NOT EXISTS chat_starred_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

-- Message edit tracking
DO $$ BEGIN
  ALTER TABLE chat_messages ADD COLUMN edited_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE chat_messages ADD COLUMN original_body TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Forwarded from
DO $$ BEGIN
  ALTER TABLE chat_messages ADD COLUMN forwarded_from_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Last seen tracking on users
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Per-user archive flag (moved from conversation-level to participant-level)
DO $$ BEGIN
  ALTER TABLE chat_participants ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Message delivery/read status per participant
CREATE TABLE IF NOT EXISTS chat_message_status (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ,
  read_at     TIMESTAMPTZ,
  UNIQUE(message_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chat_starred_user ON chat_starred_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_starred_msg ON chat_starred_messages(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_msg_status_msg ON chat_message_status(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_msg_status_user ON chat_message_status(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_msg_forwarded ON chat_messages(forwarded_from_id) WHERE forwarded_from_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at) WHERE last_seen_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_part_archived ON chat_participants(is_archived) WHERE is_archived = TRUE;
