// Shared row projection keeps existing manager list fields intact in workflow reports.
function leadListSql({whereSql,sortCol='created_at',sortOrd='DESC',limitIdx,offsetIdx,readOnly=false}) {
  const completedWorkflowSql = `('communication_completed','respond_hi','session_730_attend','yes_after_730_session')`;
  return `
    SELECT
      l.id, l.full_name, l.phone, l.email, l.city, l.state, l.raw_payload,
      l.source, l.meta_form_id, l.campaign_label, l.product_tag,
      CASE WHEN l.source = 'manual' THEN 'Manual' ELSE INITCAP(l.source::text) END AS source_label,
      l.manual_added_by_user_id, manual_user.full_name AS manual_added_by_name, manual_user.role AS manual_added_by_role, l.manual_added_at,
      l.created_by_user_id, creator_user.full_name AS created_by_name, creator_user.role AS created_by_role,
      l.category, l.category_source, l.category_rule_id, l.category_resolved_at,
      l.campaign_name, l.adset_name, l.ad_name,
      l.meta_campaign_id, l.meta_adset_id, l.meta_ad_id,
      l.stage, l.call_status, l.last_call_at, l.next_followup_at, l.call_attempts,
      l.assigned_to_user_id, u.full_name AS assigned_to_name,
      l.locked_by_user_id, l.locked_until,
      l.created_at, l.assigned_at, l.stage_updated_at, l.updated_at,
      COALESCE(lead_labels.labels, '[]'::jsonb) AS labels,
      COALESCE(lead_labels.labels_count, 0) AS labels_count,
      latest_remark.id AS latest_remark_id,
      latest_remark.remark AS latest_remark_note,
      COALESCE(latest_remark.call_statuses, CASE WHEN latest_remark.call_status IS NOT NULL THEN jsonb_build_array(latest_remark.call_status::text) ELSE '[]'::jsonb END) AS latest_remark_statuses,
      CASE
        WHEN (wf.remark_status IS NOT NULL OR COALESCE(jsonb_array_length(wf.step_1_statuses), 0) > 0)
         AND COALESCE(wf.remark_saved_at, wf.updated_at, wf.created_at) >= COALESCE(latest_remark.created_at, '-infinity'::timestamptz)
          THEN COALESCE(wf.remark_status::text, wf.step_1_statuses->>0)
        WHEN latest_remark.call_status IS NOT NULL THEN latest_remark.call_status::text
        WHEN latest_remark.stage IS NOT NULL THEN latest_remark.stage::text
        ELSE NULL
      END AS latest_remark_status,
      latest_remark.call_status::text AS latest_remark_call_status,
      latest_remark.stage::text AS latest_remark_stage,
      latest_remark.source AS latest_remark_source,
      remark_user.full_name AS latest_remark_by_name,
      latest_remark.created_at AS latest_remark_at,
      latest_rm_update.title AS latest_rm_update_title,
      latest_rm_update.remark AS latest_rm_update_note,
      latest_rm_update.category AS latest_rm_update_category,
      latest_rm_update.priority AS latest_rm_update_priority,
      latest_rm_update.customer_interest AS latest_rm_update_customer_interest,
      latest_rm_update.next_followup AS latest_rm_update_next_followup,
      latest_rm_update_user.full_name AS latest_rm_update_author_name,
      latest_rm_update_user.role AS latest_rm_update_author_role,
      latest_rm_update.created_at AS latest_rm_update_at,
      COALESCE(latest_remark.next_followup_at, l.next_followup_at) AS latest_followup_at,
      CASE
        WHEN COALESCE(latest_remark.next_followup_at, l.next_followup_at) IS NULL THEN 'none'
        WHEN COALESCE(latest_remark.next_followup_at, l.next_followup_at) < NOW() THEN 'overdue'
        WHEN (COALESCE(latest_remark.next_followup_at, l.next_followup_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date THEN 'today'
        ELSE 'upcoming'
      END AS followup_state,
      COALESCE(wf.step_1_statuses, CASE WHEN wf.remark_status IS NOT NULL THEN jsonb_build_array(wf.remark_status::text) ELSE '[]'::jsonb END) AS workflow_step_1_statuses,
      wf.remark_status::text AS workflow_step_1_status,
      CASE
        WHEN (wf.remark_status::text NOT IN ${completedWorkflowSql} OR wf.remark_status IS NULL)
          AND NOT (COALESCE(wf.step_1_statuses, '[]'::jsonb) ?| ARRAY['communication_completed','respond_hi','session_730_attend','yes_after_730_session']) THEN 1
        WHEN COALESCE(jsonb_array_length(wf.step_2_statuses), 0) = 0 AND wf.lead_level IS NULL THEN 2
        WHEN (COALESCE(wf.step_2_statuses, '[]'::jsonb) ?| ARRAY['cold_lead','cold_partner','cold_trader']) OR wf.lead_level IN ('cold_lead','cold_partner','cold_trader') THEN 2
        WHEN NOT wf.followup_completed THEN 3
        WHEN NOT wf.conversion_completed THEN 4
        ELSE 5
      END AS workflow_unlocked_step,
      CASE
        WHEN (wf.remark_status::text NOT IN ${completedWorkflowSql} OR wf.remark_status IS NULL)
          AND NOT (COALESCE(wf.step_1_statuses, '[]'::jsonb) ?| ARRAY['communication_completed','respond_hi','session_730_attend','yes_after_730_session']) THEN 1
        WHEN COALESCE(jsonb_array_length(wf.step_2_statuses), 0) = 0 AND wf.lead_level IS NULL THEN 2
        WHEN (COALESCE(wf.step_2_statuses, '[]'::jsonb) ?| ARRAY['cold_lead','cold_partner','cold_trader']) OR wf.lead_level IN ('cold_lead','cold_partner','cold_trader') THEN 2
        WHEN NOT wf.followup_completed THEN 3
        WHEN NOT wf.conversion_completed THEN 4
        ELSE 5
      END AS workflow_current_step,
      (wf.remark_status::text IN ${completedWorkflowSql}
        OR COALESCE(wf.step_1_statuses, '[]'::jsonb) ?| ARRAY['communication_completed','respond_hi','session_730_attend','yes_after_730_session']) AS workflow_is_step_1_completed,
      CASE
        WHEN EXISTS (SELECT 1 FROM lead_sessions session_status WHERE session_status.lead_id = l.id AND session_status.deleted_at IS NULL)
          THEN 'has_session'
        ELSE 'no_session'
      END AS session_attendance_status,
      EXISTS (
        SELECT 1 FROM lead_assignments la
         WHERE la.lead_id = l.id
           AND la.previous_user_id IS NOT NULL
           AND COALESCE(la.assigned_to_user_id, la.user_id) = l.assigned_to_user_id
      ) AS was_reassigned,
      ${readOnly ? 'TRUE' : 'FALSE'} AS read_only_access
    FROM leads l
    LEFT JOIN users u ON u.id = l.assigned_to_user_id
    LEFT JOIN users manual_user ON manual_user.id = l.manual_added_by_user_id
    LEFT JOIN users creator_user ON creator_user.id = l.created_by_user_id
    LEFT JOIN LATERAL (
      SELECT lr.id, lr.remark, lr.call_status, lr.call_statuses, lr.stage, lr.next_followup_at,
             lr.source, lr.user_id, lr.created_at
        FROM lead_remarks lr
       WHERE lr.lead_id = l.id
       ORDER BY lr.created_at DESC
       LIMIT 1
    ) latest_remark ON TRUE
    LEFT JOIN users remark_user ON remark_user.id = latest_remark.user_id
    LEFT JOIN LATERAL (
      SELECT lr.id, lr.remark, lr.category, lr.title, lr.priority, lr.customer_interest, lr.next_followup, lr.user_id, lr.created_at
        FROM lead_remarks lr
       WHERE lr.lead_id = l.id
         AND lr.note_type = 'rm_update'
       ORDER BY lr.created_at DESC
       LIMIT 1
    ) latest_rm_update ON TRUE
    LEFT JOIN users latest_rm_update_user ON latest_rm_update_user.id = latest_rm_update.user_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('id', ll.id, 'name', ll.name, 'color', ll.color) ORDER BY assignment.created_at DESC) AS labels,
             COUNT(*)::int AS labels_count
      FROM lead_label_assignments assignment
      JOIN lead_labels ll ON ll.id = assignment.label_id AND ll.deleted_at IS NULL
      WHERE assignment.lead_id = l.id
    ) lead_labels ON TRUE
    LEFT JOIN lead_workflow wf ON wf.lead_id = l.id
    WHERE ${whereSql}
    ORDER BY l.${sortCol} ${sortOrd} NULLS LAST
    LIMIT $${limitIdx} OFFSET ${offsetIdx ? `$${offsetIdx}` : '0'}
  `;
}
module.exports={leadListSql};
