-- =====================================================================
-- Chat Stability: fix message_type constraint, add missing indexes,
-- ensure message ordering consistency
-- =====================================================================

-- Fix message_type CHECK to include 'voice' type
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_message_type_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_message_type_check
  CHECK (message_type IN ('text', 'system', 'file', 'voice'));

-- Composite index for message ordering (consistent tiebreaker by id)
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_order
  ON chat_messages(conversation_id, created_at DESC, id DESC);

-- Index for unread count query (conversation + created_at + sender + deleted)
CREATE INDEX IF NOT EXISTS idx_chat_messages_unread
  ON chat_messages(conversation_id, created_at, sender_id)
  WHERE is_deleted = FALSE;

-- Index for message status delivery tracking
CREATE INDEX IF NOT EXISTS idx_chat_msg_status_delivery
  ON chat_message_status(message_id, user_id)
  WHERE delivered_at IS NULL;

-- Index for message status read tracking
CREATE INDEX IF NOT EXISTS idx_chat_msg_status_read
  ON chat_message_status(message_id, user_id)
  WHERE read_at IS NULL;

-- Index for participant lookup (conversation + user + blocked)
CREATE INDEX IF NOT EXISTS idx_chat_participants_conv_user
  ON chat_participants(conversation_id, user_id)
  WHERE is_blocked = FALSE;

-- Index for deleted-for-user lookup in messages query
CREATE INDEX IF NOT EXISTS idx_chat_deleted_for_user_lookup
  ON chat_deleted_for_user(message_id, user_id);

-- Index for search queries (trigram would be better but requires extension)
CREATE INDEX IF NOT EXISTS idx_chat_messages_body_search
  ON chat_messages(conversation_id)
  WHERE is_deleted = FALSE;

-- Ensure last_read_at has a sane default for new participants
ALTER TABLE chat_participants ALTER COLUMN last_read_at SET DEFAULT '1970-01-01'::timestamptz;
