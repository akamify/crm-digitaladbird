-- Migration 034: webhook event audit log + token health tracking
--
-- TWO additions for production observability:
--
-- 1. webhook_events table — every POST /webhooks/meta request lands here,
--    valid or not, signature pass or fail, leads ingested or dropped.
--    Survives restarts. Searchable by timestamp/status/page_id. This is
--    the ground-truth log when "leads stopped coming" — we can see
--    EXACTLY whether Meta is even reaching us, whether the signature
--    verified, what payload they sent, and what we did with it.
--
-- 2. meta_pages.token_health columns — populated by the periodic token
--    health monitor (services/metaTokenHealthJob.js). Updated every 15
--    minutes. The admin UI shows a real (not cached) green/red badge.

CREATE TABLE IF NOT EXISTS webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source          VARCHAR(20)  NOT NULL DEFAULT 'meta',     -- 'meta', 'whatsapp', etc.
  endpoint        VARCHAR(50)  NOT NULL,                    -- '/webhooks/meta' | '/webhook'
  method          VARCHAR(10)  NOT NULL,
  remote_ip       VARCHAR(64),
  user_agent      VARCHAR(255),
  signature_valid BOOLEAN,                                  -- HMAC verification result
  body_size       INTEGER,
  page_id         VARCHAR(64),                              -- extracted from payload
  form_id         VARCHAR(64),
  event_type      VARCHAR(50),                              -- 'leadgen' | 'verify_handshake' | ...
  lead_count      INTEGER NOT NULL DEFAULT 0,               -- leads in this payload
  leads_created   INTEGER NOT NULL DEFAULT 0,               -- leads successfully inserted
  leads_dup       INTEGER NOT NULL DEFAULT 0,               -- skipped as duplicates
  leads_error     INTEGER NOT NULL DEFAULT 0,               -- failed (token expired, etc.)
  status_code     INTEGER,                                  -- HTTP we sent back
  processing_ms   INTEGER,
  error_summary   TEXT,                                     -- nullable, first line only
  raw_body        TEXT                                       -- truncated to 8 KB
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received   ON webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_page       ON webhook_events (page_id, received_at DESC) WHERE page_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_events_signature  ON webhook_events (signature_valid, received_at DESC) WHERE signature_valid = FALSE;

-- ─── Token health tracking on meta_pages ─────────────────────────────
ALTER TABLE meta_pages
  ADD COLUMN IF NOT EXISTS token_last_checked  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS token_is_valid      BOOLEAN,
  ADD COLUMN IF NOT EXISTS token_expires_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS token_last_error    TEXT;

CREATE INDEX IF NOT EXISTS idx_meta_pages_token_invalid
  ON meta_pages (is_active, token_is_valid)
  WHERE is_active = TRUE AND (token_is_valid = FALSE OR token_is_valid IS NULL);
