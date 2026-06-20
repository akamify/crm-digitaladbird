-- =====================================================================
-- DigitalADbird CRM — pg-mem Compatible Schema
-- Same as 001_initial_schema.sql but without plpgsql triggers,
-- DO blocks, and unsupported features
-- =====================================================================

-- ENUM TYPES (direct creation, no DO block)
CREATE TYPE user_role        AS ENUM ('admin', 'rm', 'member');
CREATE TYPE user_status      AS ENUM ('active', 'inactive', 'suspended');
CREATE TYPE lead_source      AS ENUM ('meta', 'google', 'manual', 'import', 'website', 'whatsapp', 'other');
CREATE TYPE lead_stage       AS ENUM ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'dropped');
CREATE TYPE call_status      AS ENUM (
  'not_called',
  'rnr',
  'busy',
  'switched_off',
  'invalid_number',
  'callback_requested',
  'interested',
  'not_interested',
  'wrong_number',
  'language_barrier',
  'converted',
  'follow_up',
  'cnr',
  'cw',
  'nc',
  'ccb',
  'ni',
  'so',
  'nn',
  'talk_response',
  'custom_remark'
);
CREATE TYPE distribution_strategy AS ENUM ('round_robin', 'weighted', 'manual', 'priority_queue');

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emp_code            VARCHAR(32)  UNIQUE,
  cp_id               VARCHAR(40) UNIQUE,
  full_name           VARCHAR(160) NOT NULL,
  email               VARCHAR(190) UNIQUE NOT NULL,
  phone               VARCHAR(20)  UNIQUE NOT NULL,
  role                user_role    NOT NULL,
  status              user_status  NOT NULL DEFAULT 'active',
  report_to_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  team_name           VARCHAR(80),
  password_hash       VARCHAR(255),
  password_changed_at TIMESTAMPTZ,
  daily_lead_cap      INTEGER NOT NULL DEFAULT 50,
  distribution_weight INTEGER NOT NULL DEFAULT 1,
  is_available        BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_role            ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_report_to       ON users(report_to_id);
CREATE INDEX IF NOT EXISTS idx_users_phone           ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_status_avail    ON users(status, is_available);

-- OTP CODES
CREATE TABLE IF NOT EXISTS otp_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier   VARCHAR(190) NOT NULL,
  channel      VARCHAR(10)  NOT NULL DEFAULT 'sms',
  code_hash    VARCHAR(255) NOT NULL,
  expires_at   TIMESTAMPTZ  NOT NULL,
  attempts     INTEGER      NOT NULL DEFAULT 0,
  consumed_at  TIMESTAMPTZ,
  ip_address   TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_identifier_active ON otp_codes(identifier);

-- AUTH SESSIONS
CREATE TABLE IF NOT EXISTS auth_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(255) NOT NULL,
  user_agent      TEXT,
  ip_address      TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

-- PASSWORD RESET TOKENS
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash           TEXT NOT NULL UNIQUE,
  purpose              VARCHAR(30) NOT NULL DEFAULT 'password_reset',
  requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at           TIMESTAMPTZ NOT NULL,
  used_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address           TEXT,
  user_agent           TEXT,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user_created ON password_reset_tokens(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_expires ON password_reset_tokens(expires_at);

-- EMAIL DELIVERY LOGS
CREATE TABLE IF NOT EXISTS email_delivery_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  email_to            TEXT NOT NULL,
  email_type          VARCHAR(50) NOT NULL,
  provider            VARCHAR(50) NOT NULL DEFAULT 'brevo',
  provider_message_id TEXT,
  status              VARCHAR(30) NOT NULL DEFAULT 'queued',
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at             TIMESTAMPTZ,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_email_delivery_user_created ON email_delivery_logs(user_id, created_at);

-- USER NOTIFICATIONS
CREATE TABLE IF NOT EXISTS user_notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id),
  type           VARCHAR(50) NOT NULL,
  title          VARCHAR(200) NOT NULL,
  body           TEXT,
  metadata       JSONB DEFAULT '{}',
  is_read        BOOLEAN NOT NULL DEFAULT FALSE,
  event_type     TEXT,
  entity_type    TEXT,
  entity_id      UUID,
  dedupe_key     TEXT,
  email_status   TEXT,
  email_sent_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_notif_user ON user_notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_user_notif_created ON user_notifications(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_notifications_dedupe_key
  ON user_notifications(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS admin_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        VARCHAR(50) NOT NULL,
  title       VARCHAR(200) NOT NULL,
  body        TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- META PAGES
CREATE TABLE IF NOT EXISTS meta_pages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id           VARCHAR(64) UNIQUE NOT NULL,
  page_name         VARCHAR(190),
  page_access_token TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  connection_status TEXT NOT NULL DEFAULT 'discovered',
  selected_at       TIMESTAMPTZ,
  selected_by_user_id UUID REFERENCES users(id),
  deactivated_at    TIMESTAMPTZ,
  deactivation_reason TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- META FORMS
CREATE TABLE IF NOT EXISTS meta_forms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id         VARCHAR(64) UNIQUE NOT NULL,
  form_name       VARCHAR(190),
  page_id         VARCHAR(64) NOT NULL REFERENCES meta_pages(page_id) ON DELETE CASCADE,
  campaign_label  VARCHAR(120),
  product_tag     VARCHAR(120),
  lead_category   TEXT NOT NULL DEFAULT 'unknown',
  category_notes  TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- DISTRIBUTION RULES
CREATE TABLE IF NOT EXISTS distribution_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(120) NOT NULL,
  form_id       VARCHAR(64) REFERENCES meta_forms(form_id) ON DELETE CASCADE,
  strategy      distribution_strategy NOT NULL DEFAULT 'round_robin',
  eligible_user_ids UUID[] DEFAULT '{}',
  priority      INTEGER NOT NULL DEFAULT 100,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- LEADS (without GENERATED column - use regular boolean column)
CREATE TABLE IF NOT EXISTS leads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name           VARCHAR(190),
  phone               VARCHAR(32),
  email               VARCHAR(190),
  city                VARCHAR(120),
  state               VARCHAR(120),
  source              lead_source NOT NULL DEFAULT 'manual',
  meta_lead_id        VARCHAR(64) UNIQUE,
  meta_form_id        VARCHAR(64) REFERENCES meta_forms(form_id) ON DELETE SET NULL,
  meta_page_id        VARCHAR(64),
  campaign_label      VARCHAR(120),
  product_tag         VARCHAR(120),
  raw_payload         JSONB,
  category            TEXT NOT NULL DEFAULT 'unknown',
  category_source     TEXT,
  category_rule_id    UUID REFERENCES lead_category_rules(id) ON DELETE SET NULL,
  category_resolved_at TIMESTAMPTZ,
  category_manually_updated_by_user_id UUID REFERENCES users(id),
  category_manually_updated_at TIMESTAMPTZ,
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at         TIMESTAMPTZ,
  assigned_by_rule_id UUID REFERENCES distribution_rules(id) ON DELETE SET NULL,
  stage               lead_stage  NOT NULL DEFAULT 'new',
  call_status         call_status NOT NULL DEFAULT 'not_called',
  last_call_at        TIMESTAMPTZ,
  next_followup_at    TIMESTAMPTZ,
  locked_by_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  locked_until        TIMESTAMPTZ,
  call_attempts       INTEGER NOT NULL DEFAULT 0,
  is_pending          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_leads_assigned    ON leads(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_leads_stage       ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_leads_call_status ON leads(call_status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at  ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_form        ON leads(meta_form_id);
CREATE INDEX IF NOT EXISTS idx_leads_followup    ON leads(next_followup_at);
CREATE INDEX IF NOT EXISTS idx_leads_pending     ON leads(is_pending);
CREATE INDEX IF NOT EXISTS idx_leads_phone       ON leads(phone);

-- LEAD ASSIGNMENT HISTORY
CREATE TABLE IF NOT EXISTS lead_assignments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id        UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  rule_id        UUID REFERENCES distribution_rules(id) ON DELETE SET NULL,
  reason         VARCHAR(120),
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_lead ON lead_assignments(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_user ON lead_assignments(user_id);

-- REMARKS
CREATE TABLE IF NOT EXISTS lead_remarks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_status     call_status,
  remark          TEXT NOT NULL,
  next_followup_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_remarks_lead ON lead_remarks(lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_remarks_user ON lead_remarks(user_id);

-- LEAD CALL LOGS
CREATE TABLE IF NOT EXISTS lead_call_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id            UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider           VARCHAR(50),
  provider_call_id   VARCHAR(255),
  direction          VARCHAR(20) NOT NULL DEFAULT 'outbound',
  status             VARCHAR(30) NOT NULL DEFAULT 'initiated',
  started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at           TIMESTAMPTZ,
  duration_seconds   INTEGER,
  recording_url      TEXT,
  notes              TEXT,
  failure_reason     TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lead_category_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  match_value TEXT NOT NULL,
  match_mode TEXT NOT NULL DEFAULT 'exact',
  category TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_call_logs_lead_created ON lead_call_logs(lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lead_call_logs_user_created ON lead_call_logs(user_id, created_at);

-- ROUND-ROBIN STATE
CREATE TABLE IF NOT EXISTS rr_state (
  rule_id           UUID PRIMARY KEY REFERENCES distribution_rules(id) ON DELETE CASCADE,
  last_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AUDIT LOG
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  entity      VARCHAR(40)  NOT NULL,
  entity_id   UUID,
  action      VARCHAR(40)  NOT NULL,
  metadata    JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_logs(user_id, created_at);

-- REPORTING VIEWS
CREATE OR REPLACE VIEW v_user_daily_stats AS
SELECT
  l.assigned_to_user_id AS user_id,
  DATE(l.assigned_at)   AS day,
  COUNT(*)                                                         AS leads_received,
  COUNT(*) FILTER (WHERE l.call_status <> 'not_called')             AS leads_worked,
  COUNT(*) FILTER (WHERE l.call_status = 'converted')               AS conversions,
  COUNT(*) FILTER (WHERE l.is_pending)                              AS pending,
  COUNT(*) FILTER (WHERE l.call_status = 'rnr')                     AS rnr,
  COUNT(*) FILTER (WHERE l.call_status = 'not_interested')          AS not_interested
FROM leads l
WHERE l.deleted_at IS NULL AND l.assigned_to_user_id IS NOT NULL
GROUP BY l.assigned_to_user_id, DATE(l.assigned_at);

CREATE OR REPLACE VIEW v_team_overview AS
SELECT
  rm.id                  AS rm_id,
  rm.full_name           AS rm_name,
  COUNT(DISTINCT m.id)   AS members,
  COUNT(l.id)            AS team_leads,
  COUNT(l.id) FILTER (WHERE l.call_status = 'converted') AS team_conversions,
  COUNT(l.id) FILTER (WHERE l.is_pending)                 AS team_pending
FROM users rm
LEFT JOIN users m ON m.report_to_id = rm.id AND m.role = 'member' AND m.deleted_at IS NULL
LEFT JOIN leads l ON l.assigned_to_user_id = m.id AND l.deleted_at IS NULL
WHERE rm.role = 'rm' AND rm.deleted_at IS NULL
GROUP BY rm.id, rm.full_name;
