-- =====================================================================
-- Enterprise Performance Optimization — covering chat, messages,
-- conversations, unread counts, and composite query indexes.
-- Safe: uses IF NOT EXISTS, wraps optional tables/columns in DO blocks.
-- =====================================================================

-- Chat conversations: fast lookup by updated_at for sidebar ordering
CREATE INDEX IF NOT EXISTS idx_chat_conversations_last_msg
  ON chat_conversations(updated_at DESC NULLS LAST);

-- Chat participants: fast user->conversations lookup
CREATE INDEX IF NOT EXISTS idx_chat_participants_user_conv
  ON chat_participants(user_id, conversation_id);

CREATE INDEX IF NOT EXISTS idx_chat_participants_conv_user
  ON chat_participants(conversation_id, user_id);

-- Chat messages: fast conversation message loading (newest first)
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_created
  ON chat_messages(conversation_id, created_at DESC);

-- Chat messages: sender lookup
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender
  ON chat_messages(sender_id);

-- Chat messages: type filter for media/file queries
CREATE INDEX IF NOT EXISTS idx_chat_messages_type
  ON chat_messages(conversation_id, message_type) WHERE message_type != 'text';

-- Read receipts: fast lookup per message per user
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_read_receipts' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chat_read_receipts_msg_user ON chat_read_receipts(message_id, user_id)';
  END IF;
END $$;

-- Notifications: unread notifications per user
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_notifications' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chat_notifications_user_unread ON chat_notifications(user_id, created_at DESC) WHERE is_read = FALSE';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chat_notifications_user_all ON chat_notifications(user_id, created_at DESC)';
  END IF;
END $$;

-- Starred messages: per-user starred lookup
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_starred_messages' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chat_starred_user ON chat_starred_messages(user_id, created_at DESC)';
  END IF;
END $$;

-- Reactions: per-message reaction lookup
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_reactions' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chat_reactions_message ON chat_reactions(message_id)';
  END IF;
END $$;

-- Pinned messages: per-conversation lookup
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_pinned_messages' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chat_pinned_conv ON chat_pinned_messages(conversation_id, created_at DESC)';
  END IF;
END $$;

-- Mentions: per-user mention lookup
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_mentions' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chat_mentions_user ON chat_mentions(user_id, created_at DESC)';
  END IF;
END $$;

-- Delete-for-user: fast exclusion check
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_deleted_for_user' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chat_deleted_for_user_msg_user ON chat_deleted_for_user(message_id, user_id)';
  END IF;
END $$;

-- Leads: composite index for dashboard summary queries
CREATE INDEX IF NOT EXISTS idx_leads_assigned_created
  ON leads(assigned_to_user_id, created_at DESC) WHERE deleted_at IS NULL;

-- Leads: composite index for call_status filtering with assignment
CREATE INDEX IF NOT EXISTS idx_leads_assigned_call_status
  ON leads(assigned_to_user_id, call_status) WHERE deleted_at IS NULL;

-- Leads: followup queries covering index
CREATE INDEX IF NOT EXISTS idx_leads_followup_assigned
  ON leads(next_followup_at, assigned_to_user_id)
  WHERE next_followup_at IS NOT NULL AND deleted_at IS NULL;

-- Leads: search by phone (exact prefix match)
CREATE INDEX IF NOT EXISTS idx_leads_phone_pattern
  ON leads(phone varchar_pattern_ops) WHERE deleted_at IS NULL;

-- Users: fast email lookup for login
CREATE INDEX IF NOT EXISTS idx_users_email_active
  ON users(email) WHERE deleted_at IS NULL AND status = 'active';

-- Users: fast phone lookup for login
CREATE INDEX IF NOT EXISTS idx_users_phone_active
  ON users(phone) WHERE deleted_at IS NULL AND status = 'active';

-- OTP: cleanup of expired codes
CREATE INDEX IF NOT EXISTS idx_otp_expires
  ON otp_codes(expires_at) WHERE consumed_at IS NULL;

-- Auth sessions: fast refresh token validation
CREATE INDEX IF NOT EXISTS idx_auth_sessions_active
  ON auth_sessions(user_id, expires_at DESC) WHERE revoked_at IS NULL;
