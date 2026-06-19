-- 035: Production lead assignment engine support
-- Additive/backward-compatible support for assignment settings, rich
-- assignment history, approved request quantities, and fulfillment indexes.

ALTER TABLE distribution_settings
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

INSERT INTO distribution_settings (key, value, label) VALUES
  ('auto_assign_enabled', 'true', 'Enable automatic lead assignment'),
  ('assign_start_hour', '8', 'Assignment start hour in Asia/Kolkata'),
  ('assign_end_hour', '19', 'Assignment end hour in Asia/Kolkata'),
  ('assignment_timezone', 'Asia/Kolkata', 'Assignment timezone'),
  ('auto_reassign_enabled', 'false', 'Enable automatic inactivity reassignment'),
  ('reassign_after_hours', '24', 'Reassign leads after this many inactive hours'),
  ('reassign_to_high_performers', 'true', 'Prefer high-performing members for auto reassignment'),
  ('assignment_tick_limit', '100', 'Maximum leads assigned per scheduler tick'),
  ('request_fulfillment_limit', '100', 'Maximum request leads fulfilled per scheduler tick'),
  ('reassignment_tick_limit', '50', 'Maximum leads reassigned per scheduler tick')
ON CONFLICT (key) DO NOTHING;

-- Keep legacy scheduler keys in sync with the new names on first rollout.
UPDATE distribution_settings dst
   SET value = src.value
  FROM distribution_settings src
 WHERE dst.key = 'auto_assign_enabled'
   AND src.key = 'auto_distribution_enabled'
   AND dst.value = 'true';

UPDATE distribution_settings dst
   SET value = src.value
  FROM distribution_settings src
 WHERE dst.key = 'assign_start_hour'
   AND src.key = 'distribution_start_hour'
   AND dst.value = '8';

UPDATE distribution_settings dst
   SET value = src.value
  FROM distribution_settings src
 WHERE dst.key = 'assign_end_hour'
   AND src.key = 'distribution_end_hour'
   AND dst.value = '19';

ALTER TABLE lead_assignments
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignment_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS previous_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS request_id UUID,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE lead_assignments
   SET assigned_to_user_id = COALESCE(assigned_to_user_id, user_id),
       assigned_by_user_id = COALESCE(assigned_by_user_id, assigned_by),
       assignment_type = COALESCE(
         assignment_type,
         CASE
           WHEN reason IN ('auto') THEN 'auto'
           WHEN reason IN ('lead_request', 'partner_request') THEN 'request_fulfillment'
           WHEN reason IN ('bulk_reassign', 'manual', 'reassign', 'rm_manual', 'partner_manual') THEN 'manual_reassign'
           ELSE COALESCE(reason, 'manual')
         END
       ),
       created_at = COALESCE(created_at, assigned_at, NOW())
 WHERE assigned_to_user_id IS NULL
    OR assigned_by_user_id IS NULL
    OR assignment_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_lead_assignments_lead_created
  ON lead_assignments(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_type_created
  ON lead_assignments(assignment_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_request
  ON lead_assignments(request_id) WHERE request_id IS NOT NULL;

ALTER TABLE lead_requests
  ADD COLUMN IF NOT EXISTS requested_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS approved_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS fulfilled_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT;

UPDATE lead_requests
   SET requested_quantity = COALESCE(requested_quantity, quantity),
       approved_quantity = COALESCE(approved_quantity, CASE WHEN status IN ('approved','fulfilled') THEN quantity ELSE NULL END),
       fulfilled_quantity = GREATEST(COALESCE(fulfilled_quantity, 0), COALESCE(leads_assigned, 0)),
       approved_by = COALESCE(approved_by, resolved_by),
       approved_at = COALESCE(approved_at, CASE WHEN status IN ('approved','fulfilled') THEN resolved_at ELSE NULL END),
       fulfilled_at = COALESCE(fulfilled_at, CASE WHEN status = 'fulfilled' THEN resolved_at ELSE NULL END),
       admin_notes = COALESCE(admin_notes, resolve_note);

ALTER TABLE lead_requests DROP CONSTRAINT IF EXISTS lead_requests_status_check;
ALTER TABLE lead_requests
  ADD CONSTRAINT lead_requests_status_check
  CHECK (status IN ('pending', 'approved', 'partially_fulfilled', 'fulfilled', 'rejected', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_lead_requests_fulfillment
  ON lead_requests(status, approved_at)
  WHERE status IN ('approved', 'partially_fulfilled');
CREATE INDEX IF NOT EXISTS idx_leads_assigned_created
  ON leads(assigned_to_user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_form_created
  ON leads(meta_form_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_assignable_queue
  ON leads(created_at ASC)
  WHERE assigned_to_user_id IS NULL AND deleted_at IS NULL;
