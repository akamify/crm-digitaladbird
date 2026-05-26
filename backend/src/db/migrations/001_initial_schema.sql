-- =====================================================================
-- DigitalADbird CRM — Initial Schema
-- PostgreSQL 14+
-- =====================================================================
-- Design notes:
--  * UUID primary keys for all user-facing entities (safe to expose)
--  * Soft-deletes via deleted_at where audit is required
--  * Role hierarchy: admin > rm > member  (members report to an RM)
--  * Lead ownership is tracked in `leads.assigned_to_user_id` plus a full
--    history in `lead_assignments` so reports can attribute correctly.
--  * Pending-lead locks prevent two users opening the same lead at once.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- ENUM TYPES
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_role        AS ENUM ('admin', 'rm', 'member');
  CREATE TYPE user_status      AS ENUM ('active', 'inactive', 'suspended');
  CREATE TYPE lead_source      AS ENUM ('meta', 'google', 'manual', 'import', 'website', 'whatsapp', 'other');
  CREATE TYPE lead_stage       AS ENUM ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'dropped');
  CREATE TYPE call_status      AS ENUM (
    'not_called',
    'rnr',                    -- ringing no response
    'busy',
    'switched_off',
    'invalid_number',
    'callback_requested',
    'interested',
    'not_interested',
    'wrong_number',
    'language_barrier',
    'converted',
    'follow_up'
  );
  CREATE TYPE distribution_strategy AS ENUM ('round_robin', 'weighted', 'manual', 'priority_queue');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------
-- USERS  (admins, RMs, members)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emp_code            VARCHAR(32)  UNIQUE,                 -- HR / employee code
  full_name           VARCHAR(160) NOT NULL,
  email               VARCHAR(190) UNIQUE NOT NULL,
  phone               VARCHAR(20)  UNIQUE NOT NULL,        -- E.164, used for OTP
  role                user_role    NOT NULL,
  status              user_status  NOT NULL DEFAULT 'active',

  -- hierarchy: a member.report_to_id => rm.id;  rm.report_to_id => admin.id (optional)
  report_to_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  team_name           VARCHAR(80),

  -- optional password fallback (OTP is primary)
  password_hash       VARCHAR(255),

  -- lead distribution config
  daily_lead_cap      INTEGER NOT NULL DEFAULT 50,
  distribution_weight INTEGER NOT NULL DEFAULT 1,
  is_available        BOOLEAN NOT NULL DEFAULT TRUE,        -- toggle to pause auto-assign

  last_login_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_role            ON users(role) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_report_to       ON users(report_to_id);
CREATE INDEX IF NOT EXISTS idx_users_phone           ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_status_avail    ON users(status, is_available);

-- ---------------------------------------------------------------------
-- OTP CODES
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier   VARCHAR(190) NOT NULL,           -- phone or email
  channel      VARCHAR(10)  NOT NULL DEFAULT 'sms',
  code_hash    VARCHAR(255) NOT NULL,
  expires_at   TIMESTAMPTZ  NOT NULL,
  attempts     INTEGER      NOT NULL DEFAULT 0,
  consumed_at  TIMESTAMPTZ,
  ip_address   INET,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_identifier_active
  ON otp_codes(identifier) WHERE consumed_at IS NULL;

-- ---------------------------------------------------------------------
-- AUTH SESSIONS  (JWT refresh tokens)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(255) NOT NULL,
  user_agent      TEXT,
  ip_address      INET,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

-- ---------------------------------------------------------------------
-- META PAGES & FORMS   (for Meta Lead Ads webhook routing)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta_pages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id           VARCHAR(64) UNIQUE NOT NULL,
  page_name         VARCHAR(190),
  page_access_token TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meta_forms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id         VARCHAR(64) UNIQUE NOT NULL,
  form_name       VARCHAR(190),
  page_id         VARCHAR(64) NOT NULL REFERENCES meta_pages(page_id) ON DELETE CASCADE,
  campaign_label  VARCHAR(120),                 -- internal label used for filters
  product_tag     VARCHAR(120),                 -- e.g. "real_estate", "education"
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- DISTRIBUTION RULES
--   one rule per form (or null form_id => default rule)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS distribution_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(120) NOT NULL,
  form_id       VARCHAR(64) REFERENCES meta_forms(form_id) ON DELETE CASCADE,
  strategy      distribution_strategy NOT NULL DEFAULT 'round_robin',
  -- list of eligible user ids (members). Empty => all available members.
  eligible_user_ids UUID[] DEFAULT '{}',
  priority      INTEGER NOT NULL DEFAULT 100,   -- lower = higher priority
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- LEADS  (the core entity)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- identifying info
  full_name           VARCHAR(190),
  phone               VARCHAR(32),
  email               VARCHAR(190),
  city                VARCHAR(120),
  state               VARCHAR(120),

  -- source / attribution
  source              lead_source NOT NULL DEFAULT 'manual',
  meta_lead_id        VARCHAR(64) UNIQUE,           -- Meta's leadgen_id
  meta_form_id        VARCHAR(64) REFERENCES meta_forms(form_id) ON DELETE SET NULL,
  meta_page_id        VARCHAR(64),
  campaign_label      VARCHAR(120),
  product_tag         VARCHAR(120),
  raw_payload         JSONB,                         -- full Meta field_data

  -- ownership
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at         TIMESTAMPTZ,
  assigned_by_rule_id UUID REFERENCES distribution_rules(id) ON DELETE SET NULL,

  -- workflow state
  stage               lead_stage  NOT NULL DEFAULT 'new',
  call_status         call_status NOT NULL DEFAULT 'not_called',
  last_call_at        TIMESTAMPTZ,
  next_followup_at    TIMESTAMPTZ,

  -- pending-lead lock (so two users can't open same lead simultaneously)
  locked_by_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  locked_until        TIMESTAMPTZ,

  -- metrics
  call_attempts       INTEGER NOT NULL DEFAULT 0,
  is_pending          BOOLEAN GENERATED ALWAYS AS (
                        call_status = 'not_called'::call_status
                        OR call_status = 'rnr'::call_status
                        OR call_status = 'busy'::call_status
                        OR call_status = 'switched_off'::call_status
                      ) STORED,

  -- soft delete
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_leads_assigned       ON leads(assigned_to_user_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_stage          ON leads(stage)                WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_call_status    ON leads(call_status)          WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_created_at     ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_form           ON leads(meta_form_id);
CREATE INDEX IF NOT EXISTS idx_leads_followup       ON leads(next_followup_at)
  WHERE next_followup_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_pending        ON leads(is_pending) WHERE is_pending = TRUE AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_phone          ON leads(phone);

-- ---------------------------------------------------------------------
-- LEAD ASSIGNMENT HISTORY
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_assignments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id        UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by    UUID REFERENCES users(id) ON DELETE SET NULL,    -- null = system
  rule_id        UUID REFERENCES distribution_rules(id) ON DELETE SET NULL,
  reason         VARCHAR(120),       -- 'auto', 'reassign', 'manual', 'reclaim'
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_lead ON lead_assignments(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_user ON lead_assignments(user_id);

-- ---------------------------------------------------------------------
-- REMARKS / FOLLOWUPS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_remarks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_status     call_status,
  remark          TEXT NOT NULL,
  next_followup_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_remarks_lead ON lead_remarks(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_remarks_user ON lead_remarks(user_id);

-- ---------------------------------------------------------------------
-- ROUND-ROBIN STATE  (one row per rule)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rr_state (
  rule_id           UUID PRIMARY KEY REFERENCES distribution_rules(id) ON DELETE CASCADE,
  last_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- AUDIT LOG
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  entity      VARCHAR(40)  NOT NULL,        -- 'lead', 'user', 'rule', ...
  entity_id   UUID,
  action      VARCHAR(40)  NOT NULL,        -- 'create', 'update', 'assign', 'login', ...
  metadata    JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_logs(user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- UPDATED_AT TRIGGERS
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_rules_updated_at ON distribution_rules;
CREATE TRIGGER trg_rules_updated_at BEFORE UPDATE ON distribution_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_meta_pages_updated_at ON meta_pages;
CREATE TRIGGER trg_meta_pages_updated_at BEFORE UPDATE ON meta_pages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- REPORTING VIEWS
-- ---------------------------------------------------------------------
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
