-- 013: Partner Lead Requests + In-App Notifications for All Roles
-- ================================================================

-- Partner-specific lead request table (richer than generic lead_requests)
CREATE TABLE IF NOT EXISTS partner_lead_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id      UUID NOT NULL REFERENCES users(id),
  quantity        INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 500),
  category        VARCHAR(20) DEFAULT NULL,
  note            TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','assigned','completed')),
  assigned_rm_id  UUID REFERENCES users(id),
  resolved_by     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  resolve_note    TEXT,
  leads_assigned  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_requests_partner ON partner_lead_requests(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_requests_status  ON partner_lead_requests(status);
CREATE INDEX IF NOT EXISTS idx_partner_requests_rm      ON partner_lead_requests(assigned_rm_id);

-- Timeline / activity log per request
CREATE TABLE IF NOT EXISTS partner_request_timeline (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES partner_lead_requests(id) ON DELETE CASCADE,
  actor_id    UUID REFERENCES users(id),
  action      VARCHAR(50) NOT NULL,
  detail      TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prt_timeline_request ON partner_request_timeline(request_id);

-- In-app notifications for ALL roles (replaces admin-only admin_notifications)
CREATE TABLE IF NOT EXISTS user_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  type        VARCHAR(50) NOT NULL,
  title       VARCHAR(200) NOT NULL,
  body        TEXT,
  metadata    JSONB DEFAULT '{}',
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_notif_user    ON user_notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_user_notif_created ON user_notifications(created_at DESC);
