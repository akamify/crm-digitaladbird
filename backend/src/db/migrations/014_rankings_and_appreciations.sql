-- 014: Performance Rankings + Appreciation System
-- =================================================

-- Daily computed rankings (refreshed by scheduler)
CREATE TABLE IF NOT EXISTS daily_rankings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  rank_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  scope         VARCHAR(30) NOT NULL CHECK (scope IN ('member','partner','rm','team','overall')),
  team_name     VARCHAR(100),
  rank_position INTEGER NOT NULL,
  prev_position INTEGER,
  score         NUMERIC(10,2) NOT NULL DEFAULT 0,
  leads_total   INTEGER NOT NULL DEFAULT 0,
  leads_converted INTEGER NOT NULL DEFAULT 0,
  calls_made    INTEGER NOT NULL DEFAULT 0,
  followups_done INTEGER NOT NULL DEFAULT 0,
  avg_response_hrs NUMERIC(8,2),
  conv_rate     NUMERIC(5,2) NOT NULL DEFAULT 0,
  movement      VARCHAR(10) CHECK (movement IN ('up','down','new','stable')),
  UNIQUE(user_id, rank_date, scope)
);

CREATE INDEX IF NOT EXISTS idx_rankings_date_scope ON daily_rankings(rank_date, scope);
CREATE INDEX IF NOT EXISTS idx_rankings_user ON daily_rankings(user_id, rank_date);

-- Appreciation badges given by RM/Admin
CREATE TABLE IF NOT EXISTS appreciations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id  UUID NOT NULL REFERENCES users(id),
  to_user_id    UUID NOT NULL REFERENCES users(id),
  badge_type    VARCHAR(30) NOT NULL CHECK (badge_type IN ('star','excellent','good_work','outstanding','fast_worker','top_closer','best_followup')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appreciations_to ON appreciations(to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appreciations_from ON appreciations(from_user_id);
