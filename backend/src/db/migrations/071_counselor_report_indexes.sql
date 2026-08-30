-- 071: additive indexes for live Counselor Report ownership and attribution queries.
CREATE INDEX IF NOT EXISTS idx_lead_assignments_user_assigned_lead
  ON lead_assignments(COALESCE(assigned_to_user_id, user_id), assigned_at DESC, lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_remarks_user_lead_created
  ON lead_remarks(user_id, lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_wf_history_user_lead_created
  ON lead_workflow_history(user_id, lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_call_attempts_completed_user_time
  ON lead_call_attempts(completed_by_user_id, attempted_at DESC, lead_id)
  WHERE completed_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_personal_meetings_counselor_lead_created
  ON customer_notes(counselor_user_id, lead_id, created_at DESC)
  WHERE note_kind = 'personal_meeting' AND deleted_at IS NULL;
