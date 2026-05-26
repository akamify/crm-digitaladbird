-- =====================================================================
-- Performance Indexes — covers heavy admin queries, analytics, filters
-- Safe: uses IF NOT EXISTS, wraps optional tables in DO blocks
-- =====================================================================

-- Leads: composite indexes for admin analytics aggregation queries
CREATE INDEX IF NOT EXISTS idx_leads_source_deleted
  ON leads(source) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_campaign_id
  ON leads(meta_campaign_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_page_id
  ON leads(meta_page_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_converted
  ON leads(call_status) WHERE call_status = 'converted' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_category
  ON leads(category) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_fullname_trgm
  ON leads(full_name varchar_pattern_ops) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_email
  ON leads(email) WHERE deleted_at IS NULL;

-- Lead remarks: fast count + recent lookup
CREATE INDEX IF NOT EXISTS idx_lead_remarks_lead_created
  ON lead_remarks(lead_id, created_at DESC);

-- Audit logs: entity + created for webhook log queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_created
  ON audit_logs(entity, created_at DESC);

-- Users: fast lookup by status for admin panels
CREATE INDEX IF NOT EXISTS idx_users_status_role
  ON users(status, role) WHERE deleted_at IS NULL;

-- Meta sync log: fast ordering
CREATE INDEX IF NOT EXISTS idx_meta_sync_log_started
  ON meta_sync_log(started_at DESC);

-- Meta campaigns: lookup by campaign_id for lead joins
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_campaign_id
  ON meta_campaigns(campaign_id);

-- Partner lead requests: status filter
CREATE INDEX IF NOT EXISTS idx_partner_requests_status
  ON partner_lead_requests(status, created_at DESC);

-- Optional tables — create indexes only if table exists
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lead_assignments' AND table_schema = 'public') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lead_assignments' AND column_name = 'assigned_at') THEN
      CREATE INDEX IF NOT EXISTS idx_lead_assignments_assigned ON lead_assignments(assigned_at DESC);
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activity_logs' AND table_schema = 'public') THEN
    CREATE INDEX IF NOT EXISTS idx_activity_logs_entity_created ON activity_logs(entity, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC);
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_notifications' AND table_schema = 'public') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_notifications' AND column_name = 'is_read') THEN
      CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON user_notifications(user_id, created_at DESC) WHERE is_read = FALSE;
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_rankings' AND table_schema = 'public') THEN
    CREATE INDEX IF NOT EXISTS idx_rankings_period ON user_rankings(period_type, period_start DESC);
  END IF;
END $$;
