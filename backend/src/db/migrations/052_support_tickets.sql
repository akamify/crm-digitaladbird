-- 052: Support tickets raised by CRM users

CREATE SEQUENCE IF NOT EXISTS support_ticket_no_seq START 1001;

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no TEXT NOT NULL UNIQUE DEFAULT ('SUP-' || to_char(NOW(), 'YYYYMMDD') || '-' || nextval('support_ticket_no_seq')),
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  cp_id TEXT NULL,
  role TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'solved', 'not_solved')),
  last_admin_note TEXT NULL,
  solved_at TIMESTAMPTZ NULL,
  not_solved_at TIMESTAMPTZ NULL,
  resolved_by_user_id UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_ticket_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  actor_user_id UUID NULL REFERENCES users(id),
  action TEXT NOT NULL,
  status TEXT NULL,
  admin_note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_created_by ON support_tickets(created_by_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_ticket_no ON support_tickets(ticket_no);
CREATE INDEX IF NOT EXISTS idx_support_ticket_history_ticket ON support_ticket_history(ticket_id, created_at DESC);
