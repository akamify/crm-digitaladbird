-- 008: Admin features — broadcast messages, notifications, password resets tracking

-- Broadcast messages from admin to team
CREATE TABLE IF NOT EXISTS broadcast_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id     UUID NOT NULL REFERENCES users(id),
  title         VARCHAR(200) NOT NULL,
  body          TEXT NOT NULL,
  priority      VARCHAR(20) NOT NULL DEFAULT 'normal'
                CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  target_role   VARCHAR(20) DEFAULT NULL
                CHECK (target_role IS NULL OR target_role IN ('rm', 'member', 'all')),
  target_user_ids UUID[] DEFAULT NULL,
  expires_at    TIMESTAMPTZ DEFAULT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broadcast_created ON broadcast_messages(created_at DESC);

-- Admin notifications (system events for admin attention)
CREATE TABLE IF NOT EXISTS admin_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          VARCHAR(50) NOT NULL,
  title         VARCHAR(200) NOT NULL,
  body          TEXT,
  metadata      JSONB DEFAULT '{}',
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_notif_unread ON admin_notifications(is_read, created_at DESC);

-- Track password resets for audit
CREATE TABLE IF NOT EXISTS password_resets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  reset_by      UUID NOT NULL REFERENCES users(id),
  ip_address    VARCHAR(45),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pw_resets_user ON password_resets(user_id, created_at DESC);
