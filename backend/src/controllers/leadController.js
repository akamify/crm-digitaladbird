const { query, withTransaction } = require('../config/database');
const { AppError, asyncHandler } = require('../utils/errors');
const { getVisibleUserIds } = require('../middleware/rbac');
const { assignLead, reassignLead } = require('../services/leadDistributionService');
const { appendLead: sheetAppend } = require('../services/googleSheetsService');
const { onLeadCreated, findExistingByContact } = require('../services/leadEventService');
const logger = require('../utils/logger');
const config = require('../config/env');
const { resolveLeadCategory } = require('../services/leadCategory/leadCategoryResolver');
const { validateCallStatus, validateLeadStage } = require('../constants/leadStatusOptions');
const leadSessionService = require('../services/leadSessionService');
const { normalizeWorkflowRemarkStatus, saveWorkflowRemark } = require('../services/leadWorkflowRemarkService');
const { assertLabelVisible } = require('../services/leadLabelService');
const { createLeadInteraction } = require('../services/leadInteractionService');
const { validateLeadAssignee } = require('../services/leadAssigneeValidator');
const { assertCreateReady } = require('../services/createReadinessService');

function humanizeValue(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function buildRemarkText({ remark, callStatus, stage, nextFollowupAt }) {
  const note = String(remark || '').trim();
  if (note) return note;
  const parts = [];
  if (callStatus) parts.push(`Call status: ${humanizeValue(callStatus)}`);
  if (stage) parts.push(`Stage: ${humanizeValue(stage)}`);
  if (nextFollowupAt) parts.push('Follow-up scheduled');
  return parts.length ? parts.join(' | ') : 'Lead activity updated';
}

function normalizeManualText(value, max = 255) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
}

function normalizeManualPhone(value) {
  const raw = String(value || '').trim();
  const cleaned = raw.replace(/[^\d+]/g, '');
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    throw new AppError(400, 'INVALID_PHONE', 'Enter a valid phone number.');
  }
  return cleaned.startsWith('+') ? cleaned : digits;
}

function normalizeManualEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  }
  return email;
}

function normalizeManualCategory(value) {
  const category = String(value || '').trim().toLowerCase();
  if (!category) return 'unknown';
  if (!['partner', 'trader', 'unknown'].includes(category)) {
    throw new AppError(400, 'INVALID_LEAD_CATEGORY', 'Invalid lead category.');
  }
  return category;
}

function normalizeUuidList(value, max = 25) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.map(item => String(item || '').trim()).filter(Boolean))].slice(0, max);
}

function toManualLeadCreateAppError(error) {
  if (error instanceof AppError) return error;
  if (error?.code === '42703' || error?.code === '42P01') {
    return new AppError(
      500,
      'MANUAL_LEAD_SCHEMA_MIGRATION_REQUIRED',
      'Manual lead database schema is not ready. Run latest migrations and retry.',
      {
        table: error.table || null,
        column: error.column || null,
        constraint: error.constraint || null,
      },
    );
  }
  if (error?.code === '22P02') {
    return new AppError(
      400,
      'INVALID_MANUAL_LEAD_VALUE',
      'Manual lead contains a value that is not supported by the current database schema.',
      {
        db_code: error.code,
        detail: error.detail || null,
      },
    );
  }
  return new AppError(
    500,
    'MANUAL_LEAD_CREATE_FAILED',
    'Manual lead creation failed. Check backend logs for the exact failed step.',
    {
      db_code: error?.code || null,
      db_table: error?.table || null,
      db_column: error?.column || null,
      db_constraint: error?.constraint || null,
    },
  );
}

const callStatusEnumCache = {
  values: null,
  loadedAt: 0,
};

async function getDbCallStatusValues(client) {
  const now = Date.now();
  if (callStatusEnumCache.values && now - callStatusEnumCache.loadedAt < 5 * 60 * 1000) {
    return callStatusEnumCache.values;
  }
  const { rows } = await client.query(
    `SELECT enumlabel
       FROM pg_enum
      WHERE enumtypid = 'call_status'::regtype`,
  );
  callStatusEnumCache.values = new Set(rows.map(row => row.enumlabel));
  callStatusEnumCache.loadedAt = now;
  return callStatusEnumCache.values;
}

async function toDbCallStatus(client, normalizedCallStatus) {
  if (!normalizedCallStatus) return null;
  const allowed = await getDbCallStatusValues(client);
  if (allowed.has(normalizedCallStatus)) return normalizedCallStatus;
  const fallbackMap = {
    communication_completed: 'interested',
    respond_hi: 'interested',
    talk_response: 'interested',
    recall: 'callback_requested',
    cb: 'busy',
    in: 'invalid_number',
    session_730_attend: 'follow_up',
    session_after_730: 'follow_up',
    yes_after_730_session: 'follow_up',
    custom_remark: null,
  };
  const fallback = Object.prototype.hasOwnProperty.call(fallbackMap, normalizedCallStatus)
    ? fallbackMap[normalizedCallStatus]
    : null;
  return fallback && allowed.has(fallback) ? fallback : null;
}

async function enqueueLeadSheetSync(leadId, payload) {
  try {
    const userSheets = require('../services/userGoogleSheetsService');
    await userSheets.enqueueLeadSync(leadId, payload);
  } catch (error) {
    logger.warn({
      leadId,
      eventType: payload?.eventType,
      code: error?.code || 'GOOGLE_SHEETS_SYNC_ENQUEUE_FAILED',
      message: error?.message,
    }, '[LeadRemarks] Google Sheets sync enqueue failed');
  }
}

async function assertLeadWriteAccess(client, leadId, user) {
  const { rows: [lead] } = await client.query(
    `SELECT l.id, l.assigned_to_user_id, l.client_id, assigned_user.report_to_id AS assigned_user_rm_id
       FROM leads l
       LEFT JOIN users assigned_user ON assigned_user.id = l.assigned_to_user_id
      WHERE l.id = $1 AND l.deleted_at IS NULL`,
    [leadId],
  );
  if (!lead) throw new AppError(404, 'NOT_FOUND', 'Lead not found');
  if (user.role === 'super_admin' || user.role === 'admin') return lead;
  if (user.role === 'client' && lead.client_id === user.id) return lead;
  if ((user.role === 'member' || user.role === 'partner') && lead.assigned_to_user_id === user.id) return lead;
  if (user.role === 'rm' && lead.assigned_user_rm_id === user.id) return lead;
  throw new AppError(403, 'REASSIGNED_LEAD_READ_ONLY', 'This lead has been reassigned. You can view it, but cannot edit it.');
}

/**
 * GET /api/leads — paginated, filterable list scoped by role.
 *
 * Query params:
 *   q                 search across name/phone/email
 *   stage             new|contacted|...
 *   call_status       not_called|rnr|...
 *   source            meta|google|...
 *   form_id           Meta form ID
 *   assigned_to       user id  (admin only — RM auto-scoped, members locked to self)
 *   from, to          ISO dates (filters created_at)
 *   created_preset    today|yesterday|day_before (IST created_at date)
 *   pending           true => only is_pending leads
 *   followup          today|overdue|week
 *   page, page_size
 *   sort              created_at | assigned_at | next_followup_at  (default created_at)
 *   order             asc | desc
 */
exports.list = asyncHandler(async (req, res) => {
  const visible = await getVisibleUserIds(req.user);
  const where = [`l.deleted_at IS NULL`];
  const params = [];
  const reassignment = String(req.query.reassignment || '').trim();

  // role scoping
  if (req.user.role === 'client') {
    params.push(req.user.id);
    where.push(`l.client_id = $${params.length}`);
  } else if (reassignment === 'to_others') {
    if (visible !== null) {
      if (visible.length === 0) return res.json({ success: true, data: { rows: [], total: 0 } });
      params.push(visible);
      const visibleIdx = params.length;
      where.push(`EXISTS (
        SELECT 1 FROM lead_assignments la
         WHERE la.lead_id = l.id
           AND la.previous_user_id = ANY($${visibleIdx}::uuid[])
      )`);
      where.push(`(
        l.assigned_to_user_id IS NULL
        OR l.assigned_to_user_id <> ALL($${visibleIdx}::uuid[])
      )`);
    } else {
      where.push(`EXISTS (
        SELECT 1 FROM lead_assignments la
         WHERE la.lead_id = l.id
           AND la.previous_user_id IS NOT NULL
           AND la.previous_user_id IS DISTINCT FROM l.assigned_to_user_id
      )`);
    }
  } else if (visible !== null) {
    if (visible.length === 0) return res.json({ success: true, data: { rows: [], total: 0 } });
    params.push(visible);
    where.push(`l.assigned_to_user_id = ANY($${params.length}::uuid[])`);
  }

  if (reassignment === 'to_me') {
    where.push(`EXISTS (
      SELECT 1 FROM lead_assignments la
       WHERE la.lead_id = l.id
         AND la.previous_user_id IS NOT NULL
         AND COALESCE(la.assigned_to_user_id, la.user_id) = l.assigned_to_user_id
    )`);
  }

  // explicit assigned_to filter (admin/RM only — and RM can only narrow within visible set)
  if (req.query.assigned_to) {
    if (req.query.assigned_to === '__unassigned') {
      where.push(`l.assigned_to_user_id IS NULL`);
    } else if (req.query.assigned_to === '__assigned') {
      where.push(`l.assigned_to_user_id IS NOT NULL`);
    } else {
      params.push(req.query.assigned_to);
      where.push(`l.assigned_to_user_id = $${params.length}`);
    }
  }
  if (req.query.assigned_today === 'true') {
    where.push(`l.assigned_to_user_id IS NOT NULL`);
    where.push(`l.assigned_at IS NOT NULL`);
    where.push(`(l.assigned_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date`);
  }

  if (req.query.q) {
    params.push(`%${req.query.q.trim()}%`);
    const n = params.length;
    where.push(`(l.full_name ILIKE $${n} OR l.phone ILIKE $${n} OR l.email ILIKE $${n})`);
  }
  if (req.query.stage) { params.push(req.query.stage); where.push(`l.stage = $${params.length}`); }
  if (req.query.call_status) {
    params.push(String(req.query.call_status).trim());
    const callStatusIdx = params.length;
    where.push(`(
      l.call_status::text = $${callStatusIdx}
      OR EXISTS (
        SELECT 1 FROM lead_remarks call_status_filter
         WHERE call_status_filter.lead_id = l.id
           AND (
             call_status_filter.call_status::text = $${callStatusIdx}
             OR COALESCE(call_status_filter.call_statuses, '[]'::jsonb) ? $${callStatusIdx}
           )
      )
    )`);
  }
  if (req.query.source) { params.push(req.query.source); where.push(`l.source = $${params.length}`); }
  if (req.query.form_id) { params.push(req.query.form_id); where.push(`l.meta_form_id = $${params.length}`); }
  if (req.query.campaign_id) {
    params.push(req.query.campaign_id);
    const n = params.length;
    where.push(`(
      l.meta_campaign_id = $${n}
      OR EXISTS (
        SELECT 1 FROM meta_campaigns mc
         WHERE mc.campaign_id = l.meta_campaign_id
           AND mc.campaign_id = $${n}
      )
    )`);
  }
  if (req.query.campaign) {
    params.push(`%${String(req.query.campaign).trim()}%`);
    const n = params.length;
    where.push(`(
      l.campaign_name ILIKE $${n}
      OR l.campaign_label ILIKE $${n}
      OR l.meta_campaign_id ILIKE $${n}
      OR EXISTS (
        SELECT 1 FROM meta_campaigns mc
         WHERE mc.campaign_id = l.meta_campaign_id
           AND (mc.campaign_name ILIKE $${n} OR mc.internal_label ILIKE $${n})
      )
    )`);
  }
  if (req.query.adset) { params.push(req.query.adset); where.push(`l.adset_name = $${params.length}`); }
  if (req.query.created_preset) {
    const preset = String(req.query.created_preset);
    const offsets = { today: 0, yesterday: 1, day_before: 2 };
    if (Object.prototype.hasOwnProperty.call(offsets, preset)) {
      where.push(`(l.created_at AT TIME ZONE 'Asia/Kolkata')::date = ((NOW() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '${offsets[preset]} days')`);
    }
  }
  if (req.query.from) { params.push(req.query.from); where.push(`l.created_at >= $${params.length}`); }
  if (req.query.to) { params.push(req.query.to); where.push(`l.created_at <= $${params.length}`); }
  if (req.query.pending === 'true') where.push(`l.is_pending = TRUE`);
  if (req.query.unworked === 'true') {
    where.push(`NOT EXISTS (
      SELECT 1 FROM lead_remarks lr
       WHERE lr.lead_id = l.id
    )`);
    where.push(`NOT EXISTS (
      SELECT 1 FROM lead_workflow wf_unworked
       WHERE wf_unworked.lead_id = l.id
         AND wf_unworked.remark_status IS NOT NULL
    )`);
  }
  if (req.query.no_remark === 'true') {
    where.push(`NOT EXISTS (
      SELECT 1 FROM lead_remarks lr_no_remark
       WHERE lr_no_remark.lead_id = l.id
    )`);
    where.push(`NOT EXISTS (
      SELECT 1 FROM lead_workflow wf_no_remark
       WHERE wf_no_remark.lead_id = l.id
         AND wf_no_remark.remark_status IS NOT NULL
    )`);
  }
  if (req.query.category && ['partner', 'trader', 'unknown'].includes(req.query.category)) {
    params.push(req.query.category);
    where.push(`l.category = $${params.length}`);
  }
  if (req.query.label_id) {
    const labelId = String(req.query.label_id).trim();
    await assertLabelVisible(req.user, labelId);
    params.push(labelId);
    where.push(`EXISTS (
      SELECT 1 FROM lead_label_assignments label_assignment
       WHERE label_assignment.lead_id = l.id
         AND label_assignment.label_id = $${params.length}
    )`);
  }
  if (req.query.remark_status) {
    params.push(String(req.query.remark_status).trim());
    const remarkStatusIdx = params.length;
    where.push(`(
      EXISTS (
      SELECT 1 FROM lead_remarks remark_filter
       WHERE remark_filter.lead_id = l.id
         AND (
           remark_filter.call_status::text = $${remarkStatusIdx}
           OR COALESCE(remark_filter.call_statuses, '[]'::jsonb) ? $${remarkStatusIdx}
         )
      )
      OR EXISTS (
        SELECT 1 FROM lead_workflow workflow_remark_filter
         WHERE workflow_remark_filter.lead_id = l.id
           AND (
             workflow_remark_filter.remark_status::text = $${remarkStatusIdx}
             OR COALESCE(workflow_remark_filter.step_1_statuses, '[]'::jsonb) ? $${remarkStatusIdx}
           )
      )
    )`);
  }
  if (req.query.session_attendance === 'has_session') {
    where.push(`EXISTS (SELECT 1 FROM lead_sessions session_filter WHERE session_filter.lead_id = l.id AND session_filter.deleted_at IS NULL)`);
  } else if (req.query.session_attendance === 'no_session') {
    where.push(`NOT EXISTS (SELECT 1 FROM lead_sessions session_filter WHERE session_filter.lead_id = l.id AND session_filter.deleted_at IS NULL)`);
  }

  const completedWorkflowSql = `('communication_completed','respond_hi','session_730_attend','yes_after_730_session')`;
  if (req.query.workflow_status) {
    const workflowStatus = String(req.query.workflow_status);
    if (workflowStatus === 'step_1_pending') {
      where.push(`NOT EXISTS (
        SELECT 1 FROM lead_workflow wf_status
         WHERE wf_status.lead_id = l.id
           AND (
             wf_status.remark_status::text IN ${completedWorkflowSql}
             OR COALESCE(wf_status.step_1_statuses, '[]'::jsonb) ?| ARRAY['communication_completed','respond_hi','session_730_attend','yes_after_730_session']
           )
      )`);
    } else if (['step_1_completed', 'step_2_unlocked', 'completed_response'].includes(workflowStatus)) {
      where.push(`EXISTS (
        SELECT 1 FROM lead_workflow wf_status
         WHERE wf_status.lead_id = l.id
           AND (
             wf_status.remark_status::text IN ${completedWorkflowSql}
             OR COALESCE(wf_status.step_1_statuses, '[]'::jsonb) ?| ARRAY['communication_completed','respond_hi','session_730_attend','yes_after_730_session']
           )
      )`);
    }
  }

  if (req.query.latest_activity) {
    const latestActivityExpr = `GREATEST(
      l.updated_at,
      COALESCE((SELECT MAX(lr_activity.created_at) FROM lead_remarks lr_activity WHERE lr_activity.lead_id = l.id), l.updated_at),
      COALESCE((SELECT MAX(wf_activity.updated_at) FROM lead_workflow wf_activity WHERE wf_activity.lead_id = l.id), l.updated_at)
    )`;
    const latestActivity = String(req.query.latest_activity);
    if (latestActivity === 'today') {
      where.push(`(${latestActivityExpr} AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date`);
    } else if (latestActivity === 'yesterday') {
      where.push(`(${latestActivityExpr} AT TIME ZONE 'Asia/Kolkata')::date = ((NOW() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '1 day')`);
    } else if (latestActivity === 'last_7_days') {
      where.push(`${latestActivityExpr} >= NOW() - INTERVAL '7 days'`);
    } else if (latestActivity === 'last_30_days') {
      where.push(`${latestActivityExpr} >= NOW() - INTERVAL '30 days'`);
    }
  }

  const hasWorkflowOrRemark = `(
    EXISTS (SELECT 1 FROM lead_remarks lr_follow WHERE lr_follow.lead_id = l.id)
    OR EXISTS (SELECT 1 FROM lead_workflow wf_follow WHERE wf_follow.lead_id = l.id)
  )`;

  if (req.query.followup === 'today' && req.query.followup_strict === 'true') {
    where.push(`(l.next_followup_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date`);
  } else if (req.query.followup === 'today') {
    where.push(`(
      (l.next_followup_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
      OR ${hasWorkflowOrRemark}
    )`);
  } else if (req.query.followup === 'overdue') {
    where.push(`l.next_followup_at < NOW()`);
  } else if (req.query.followup === 'week') {
    where.push(`(
      l.next_followup_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
      OR ${hasWorkflowOrRemark}
    )`);
  } else if (req.query.followup === 'upcoming') {
    where.push(`l.next_followup_at > NOW()`);
  } else if (req.query.followup === 'no_followup') {
    where.push(`l.next_followup_at IS NULL`);
  }

  const allowedSort = new Set(['created_at', 'assigned_at', 'next_followup_at', 'updated_at']);
  const sortCol = allowedSort.has(req.query.sort) ? req.query.sort : 'created_at';
  const sortOrd = req.query.order === 'asc' ? 'ASC' : 'DESC';

  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.page_size || '25', 10)));
  const offset = (page - 1) * pageSize;

  const whereSql = where.join(' AND ');

  const totalRes = await query(`SELECT COUNT(*) FROM leads l WHERE ${whereSql}`, params);
  const total = parseInt(totalRes.rows[0].count, 10);

  params.push(pageSize); const limitIdx = params.length;
  params.push(offset); const offsetIdx = params.length;

  const sql = `
    SELECT
      l.id, l.full_name, l.phone, l.email, l.city, l.state,
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
      ${reassignment === 'to_others' && visible !== null ? 'TRUE' : 'FALSE'} AS read_only_access
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
      SELECT jsonb_agg(jsonb_build_object('id', ll.id, 'name', ll.name, 'color', ll.color) ORDER BY assignment.created_at DESC) AS labels,
             COUNT(*)::int AS labels_count
      FROM lead_label_assignments assignment
      JOIN lead_labels ll ON ll.id = assignment.label_id AND ll.deleted_at IS NULL
      WHERE assignment.lead_id = l.id
    ) lead_labels ON TRUE
    LEFT JOIN lead_workflow wf ON wf.lead_id = l.id
    WHERE ${whereSql}
    ORDER BY l.${sortCol} ${sortOrd} NULLS LAST
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;
  const { rows } = await query(sql, params);

  res.json({ success: true, data: { rows, total, page, pageSize } });
});

exports.getOne = asyncHandler(async (req, res) => {
  const visible = await getVisibleUserIds(req.user);
  const params = [req.params.id];
  let scope = '';
  if (req.user.role === 'client') {
    params.push(null);
    params.push(req.user.id);
    scope = ` AND l.client_id = $3`;
  } else if (visible !== null) {
    params.push(visible);
    scope = ` AND (
      l.assigned_to_user_id = ANY($2::uuid[])
      OR EXISTS (
        SELECT 1 FROM lead_assignments la
         WHERE la.lead_id = l.id
           AND la.previous_user_id = ANY($2::uuid[])
           AND (
             l.assigned_to_user_id IS NULL
             OR l.assigned_to_user_id <> ALL($2::uuid[])
           )
      )
    )`;
  }
  const { rows } = await query(
    `SELECT l.*, u.full_name AS assigned_to_name,
            CASE WHEN l.source = 'manual' THEN 'Manual' ELSE INITCAP(l.source::text) END AS source_label,
            manual_user.full_name AS manual_added_by_name,
            manual_user.role AS manual_added_by_role,
            creator_user.full_name AS created_by_name,
            creator_user.role AS created_by_role,
            CASE
              WHEN $2::uuid[] IS NULL THEN FALSE
              WHEN l.assigned_to_user_id = ANY($2::uuid[]) THEN FALSE
              ELSE TRUE
            END AS read_only_access,
            CASE
              WHEN $2::uuid[] IS NULL THEN NULL
              WHEN l.assigned_to_user_id = ANY($2::uuid[]) THEN 'current_owner'
              ELSE 'reassigned_to_other'
            END AS reassignment_access_type
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to_user_id
       LEFT JOIN users manual_user ON manual_user.id = l.manual_added_by_user_id
       LEFT JOIN users creator_user ON creator_user.id = l.created_by_user_id
      WHERE l.id = $1 AND l.deleted_at IS NULL ${scope}`,
    visible === null && req.user.role !== 'client' ? [req.params.id, null] : params
  );
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Lead not found');

  const remarks = await query(
    `SELECT r.id, r.remark, r.call_status, r.next_followup_at, r.created_at,
            u.full_name AS by_name
       FROM lead_remarks r JOIN users u ON u.id = r.user_id
      WHERE r.lead_id = $1 ORDER BY r.created_at DESC`,
    [req.params.id]
  );
  const history = await query(
    `SELECT a.assigned_at, a.unassigned_at, a.reason,
            u.full_name AS user_name, b.full_name AS assigned_by_name
       FROM lead_assignments a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN users b ON b.id = a.assigned_by
      WHERE a.lead_id = $1 ORDER BY a.assigned_at DESC`,
    [req.params.id]
  );
  let labels = [];
  try {
    labels = await require('../services/leadLabelService').getLeadLabels(req.user, req.params.id);
  } catch (_) {
    labels = [];
  }

  res.json({ success: true, data: { ...rows[0], remarks: remarks.rows, history: history.rows, labels } });
});

exports.listSessions = asyncHandler(async (req, res) => {
  const data = await leadSessionService.listLeadSessions({ user: req.user, leadId: req.params.leadId });
  res.json({ success: true, data });
});

exports.createSession = asyncHandler(async (req, res) => {
  const data = await leadSessionService.createLeadSession({ user: req.user, leadId: req.params.leadId, body: req.body });
  res.status(201).json({ success: true, data });
});

exports.updateSession = asyncHandler(async (req, res) => {
  const data = await leadSessionService.updateLeadSession({
    user: req.user,
    leadId: req.params.leadId,
    sessionId: req.params.sessionId,
    body: req.body,
  });
  res.json({ success: true, data });
});

exports.deleteSession = asyncHandler(async (req, res) => {
  const data = await leadSessionService.deleteLeadSession({
    user: req.user,
    leadId: req.params.leadId,
    sessionId: req.params.sessionId,
  });
  res.json({ success: true, data });
});

/**
 * Pending-lead lock: when a member opens a lead to call it, we lock it for
 * config.leadLock.durationMinutes so a teammate doesn't race-call the same lead.
 */
exports.lock = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const result = await withTransaction(async (client) => {
    const { rows: [lead] } = await client.query(
      `SELECT id, assigned_to_user_id, locked_by_user_id, locked_until
         FROM leads WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id]
    );
    if (!lead) throw new AppError(404, 'NOT_FOUND', 'Lead not found');

    if (req.user.role === 'member' && lead.assigned_to_user_id !== req.user.id) {
      throw new AppError(403, 'FORBIDDEN', 'Lead not assigned to you');
    }
    if (lead.locked_by_user_id && lead.locked_by_user_id !== req.user.id &&
      lead.locked_until && new Date(lead.locked_until) > new Date()) {
      throw new AppError(409, 'LOCKED', 'Lead is currently being worked on by another user');
    }
    const until = new Date(Date.now() + config.leadLock.durationMinutes * 60_000);
    await client.query(
      `UPDATE leads SET locked_by_user_id = $1, locked_until = $2 WHERE id = $3`,
      [req.user.id, until, id]
    );
    return { lockedUntil: until };
  });
  res.json({ success: true, data: result });
});

exports.unlock = asyncHandler(async (req, res) => {
  await query(
    `UPDATE leads SET locked_by_user_id = NULL, locked_until = NULL
      WHERE id = $1 AND (locked_by_user_id = $2 OR $3 IN ('super_admin','rm'))`,
    [req.params.id, req.user.id, req.user.role]
  );
  res.json({ success: true });
});

/**
 * POST /api/leads/:id/remarks
 * Body: { remark, call_status?, next_followup_at?, stage? }
 * Updates lead call_status, next_followup_at, call_attempts atomically.
 */
exports.addRemark = asyncHandler(async (req, res) => {
  const { remark, call_status, call_statuses, remark_statuses, next_followup_at, stage, release_lock = true } = req.body;
  const result = await withTransaction(async (client) => {
    const interaction = await createLeadInteraction({
      client,
      user: req.user,
      leadId: req.params.id,
      note: remark,
      status: call_status,
      statuses: call_statuses || remark_statuses,
      stage,
      nextFollowupAt: next_followup_at,
      source: 'manual',
      releaseLock: release_lock,
    });
    return interaction.remark;
  });

  await enqueueLeadSheetSync(req.params.id, { eventType: 'lead_remark_updated', source: 'crm_remark', userId: req.user.id });

  res.status(201).json({ success: true, data: result });
});

/**
 * POST /api/leads/bulk/remarks
 * Body: { lead_ids, remark, call_status?, next_followup_at?, stage? }
 * Applies the same remark/status update rules as single-lead remarks.
 */
exports.bulkAddRemarks = asyncHandler(async (req, res) => {
  const leadIds = Array.isArray(req.body?.lead_ids) ? req.body.lead_ids : req.body?.leadIds;
  const { remark, call_status, call_statuses, remark_statuses, next_followup_at, stage } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) throw new AppError(400, 'LEAD_IDS_REQUIRED', 'Select at least one lead.');

  const uniqueLeadIds = [...new Set(leadIds.map(String).filter(Boolean))].slice(0, 500);
  const visible = await getVisibleUserIds(req.user);
  const result = await withTransaction(async (client) => {
    const params = [uniqueLeadIds];
    let scope = '';
    if (visible !== null) {
      params.push(visible);
      scope = ` AND assigned_to_user_id = ANY($${params.length}::uuid[])`;
    }
    const { rows: leads } = await client.query(
      `SELECT id
         FROM leads
        WHERE id = ANY($1::uuid[])
          AND deleted_at IS NULL
          ${scope}
        FOR UPDATE`,
      params,
    );
    const allowed = new Set(leads.map(lead => lead.id));
    const skippedReasons = {};
    let updated = 0;

    for (const leadId of uniqueLeadIds) {
      if (!allowed.has(leadId)) {
        skippedReasons[leadId] = 'not_found_or_forbidden';
        continue;
      }
      await createLeadInteraction({
        client,
        user: req.user,
        leadId,
        note: remark,
        status: call_status,
        statuses: call_statuses || remark_statuses,
        stage,
        nextFollowupAt: next_followup_at,
        source: 'bulk',
      });
      updated++;
    }

    return {
      requested: uniqueLeadIds.length,
      updated,
      skipped: uniqueLeadIds.length - updated,
      skippedReasons,
      updatedLeadIds: [...allowed],
    };
  });

  for (const leadId of result.updatedLeadIds) {
    await enqueueLeadSheetSync(leadId, { eventType: 'lead_bulk_remark_updated', source: 'crm_bulk_remark', userId: req.user.id });
  }

  res.status(201).json({ success: true, data: result });
});

/** Admin/RM only: change assignment manually. */
exports.reassign = asyncHandler(async (req, res) => {
  if (!['super_admin', 'rm'].includes(req.user.role)) throw new AppError(403, 'FORBIDDEN', 'Not allowed');
  const { to_user_id } = req.body;
  if (!to_user_id) throw new AppError(400, 'TO_USER_REQUIRED', 'to_user_id required');

  // Capture old assignee + names for the audit row BEFORE the reassign happens.
  const { rows: [prev] } = await query(
    `SELECT l.assigned_to_user_id, u.full_name AS prev_name, u.report_to_id AS prev_rm_id FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to_user_id WHERE l.id = $1`,
    [req.params.id]
  );
  if (req.user.role === 'rm' && prev?.prev_rm_id !== req.user.id) {
    throw new AppError(403, 'REASSIGNED_LEAD_READ_ONLY', 'This lead has been reassigned. You can view it, but cannot edit it.');
  }
  const { rows: [target] } = await query(`SELECT full_name FROM users WHERE id = $1`, [to_user_id]);

  const out = await reassignLead(req.params.id, to_user_id, req.user.id, 'manual');

  const { logActivity } = require('../utils/auditLog');
  await logActivity(req, {
    entity: 'lead', entity_id: req.params.id, action: 'reassigned',
    old_value: prev?.prev_name || prev?.assigned_to_user_id || '(unassigned)',
    new_value: target?.full_name || to_user_id,
    metadata: { from_user_id: prev?.assigned_to_user_id || null, to_user_id, reason: 'manual' },
  });

  res.json({ success: true, data: out });
});

exports.createManual = asyncHandler(async (req, res) => {
  try {
    if (!['super_admin', 'admin', 'rm'].includes(req.user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'Only admin and RM users can add manual leads.');
    }
    await assertCreateReady('manual_lead_create');

    const fullName = normalizeManualText(req.body?.full_name || req.body?.name, 190);
    if (!fullName) throw new AppError(400, 'NAME_REQUIRED', 'Lead name is required.');

    const phone = normalizeManualPhone(req.body?.phone);
    const alternatePhone = req.body?.alternate_phone ? normalizeManualPhone(req.body.alternate_phone) : null;
    const email = normalizeManualEmail(req.body?.email);
    if (!email) throw new AppError(400, 'EMAIL_REQUIRED', 'Lead email is required.');
    const city = normalizeManualText(req.body?.city, 120);
    if (!city) throw new AppError(400, 'CITY_REQUIRED', 'Lead city is required.');
    const state = normalizeManualText(req.body?.state, 120);
    if (!state) throw new AppError(400, 'STATE_REQUIRED', 'Lead state is required.');
  const category = normalizeManualCategory(req.body?.category);
  const normalizedStage = req.body?.stage ? validateLeadStage(req.body.stage) : null;
  if (req.body?.stage && normalizedStage === null) {
    throw new AppError(400, 'INVALID_LEAD_STATUS_VALUE', 'Invalid stage value. Please select one of the available CRM stages.');
  }
  const normalizedCallStatus = req.body?.call_status ? validateCallStatus(req.body.call_status) : null;
  if (req.body?.call_status && normalizedCallStatus === null) {
    throw new AppError(400, 'INVALID_LEAD_STATUS_VALUE', 'Invalid call status value. Please select one of the available CRM statuses.');
  }
  const initialRemark = String(req.body?.initial_remark || req.body?.notes || '').trim();
  const labelIds = normalizeUuidList(req.body?.label_ids || req.body?.labelIds);
  const assignedToUserId = String(req.body?.assigned_to_user_id || '').trim() || null;
  const nextFollowupAt = req.body?.next_followup_at || null;
  logger.info({
    route: 'POST /api/leads/manual',
    userId: req.user?.id,
    role: req.user?.role,
    has_email: Boolean(email),
    has_phone: Boolean(phone),
    has_city: Boolean(city),
    has_state: Boolean(state),
    label_count: labelIds.length,
    has_assignee: Boolean(assignedToUserId),
  }, 'Manual lead create validation passed');

  const dup = await findExistingByContact({ phone, email });
  if (dup) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_LEAD',
        message: `Lead already exists (matched by ${dup.reason}).`,
        data: { id: dup.id, reason: dup.reason },
      },
    });
  }

  const result = await withTransaction(async (client) => {
    let dbCallStatus = null;
    if (normalizedCallStatus) {
      dbCallStatus = await toDbCallStatus(client, normalizedCallStatus);
    }
    const labels = [];
    for (const labelId of labelIds) {
      labels.push(await assertLabelVisible(req.user, labelId));
    }

    let assignee = null;
    if (assignedToUserId) {
      assignee = await validateLeadAssignee(client, assignedToUserId, { actor: req.user });
    }

    const sourceMeta = {
      source: 'manual',
      alternate_phone: alternatePhone,
      created_by_user_id: req.user.id,
      created_by_name: req.user.name || req.user.full_name || null,
      created_by_role: req.user.role,
    };
    const rawPayload = {
      manual: true,
      name: fullName,
      phone,
      alternate_phone: alternatePhone,
      email,
      city,
      state,
      category,
      created_by_user_id: req.user.id,
    };

    const { rows: [lead] } = await client.query(
      `INSERT INTO leads (
         full_name, phone, email, city, state, source, category, category_source,
         category_resolved_at, stage, call_status, next_followup_at,
         assigned_to_user_id, assigned_at, raw_payload, source_meta,
         manual_added_by_user_id, manual_added_at, created_by_user_id
       )
       VALUES (
         $1, $2, $3, $4, $5, 'manual'::lead_source, $6, 'manual',
         NOW(), COALESCE($7, 'new')::lead_stage, COALESCE($8, 'not_called')::call_status, $9,
         $10, CASE WHEN $10 IS NULL THEN NULL ELSE NOW() END, $11::jsonb, $12::jsonb,
         $13, NOW(), $13
       )
       RETURNING id, full_name, phone, email, source, manual_added_by_user_id, manual_added_at,
                 created_by_user_id, created_at, assigned_to_user_id`,
      [
        fullName,
        phone,
        email,
        city,
        state,
        category,
        normalizedStage || null,
        dbCallStatus || null,
        nextFollowupAt,
        assignee?.id || null,
        JSON.stringify(rawPayload),
        JSON.stringify(sourceMeta),
        req.user.id,
      ],
    );
    logger.info({ route: 'POST /api/leads/manual', userId: req.user?.id, leadId: lead.id }, 'Manual lead DB insert succeeded');

    if (assignee) {
      await client.query(
        `INSERT INTO lead_assignments(lead_id, user_id, assigned_to_user_id, assigned_by, assigned_at, reason)
         VALUES ($1, $2, $2, $3, NOW(), 'manual_lead_create')`,
        [lead.id, assignee.id, req.user.id],
      );
    }

    for (const label of labels) {
      await client.query(
        `INSERT INTO lead_label_assignments(lead_id, label_id, assigned_by_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (lead_id, label_id) DO NOTHING`,
        [lead.id, label.id, req.user.id],
      );
    }
    if (labels.length) {
      logger.info({ route: 'POST /api/leads/manual', leadId: lead.id, label_count: labels.length }, 'Manual lead labels assigned');
    }

    if (initialRemark || normalizedCallStatus || normalizedStage || nextFollowupAt) {
      await client.query(
        `INSERT INTO lead_remarks(
           lead_id, user_id, remark, call_status, stage, next_followup_at,
           source, is_completed_response, call_statuses
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'manual', FALSE, $7::jsonb)`,
        [
          lead.id,
          req.user.id,
          buildRemarkText({
            remark: initialRemark,
            callStatus: normalizedCallStatus,
            stage: normalizedStage,
            nextFollowupAt,
          }),
          dbCallStatus,
          normalizedStage || null,
          nextFollowupAt,
          JSON.stringify(normalizedCallStatus ? [normalizedCallStatus] : []),
        ],
      );
      if (dbCallStatus) {
        await client.query(
          `UPDATE leads
              SET last_call_at = NOW(),
                  call_attempts = call_attempts + 1,
                  updated_at = NOW()
            WHERE id = $1`,
          [lead.id],
        );
      }
      logger.info({ route: 'POST /api/leads/manual', leadId: lead.id, has_status: Boolean(dbCallStatus), has_stage: Boolean(normalizedStage) }, 'Manual lead initial remark saved');
    }

    return {
      lead,
      labels,
      assignee,
    };
  });

  onLeadCreated(result.lead.id, { source: 'manual_create' });

  const { logActivity } = require('../utils/auditLog');
  await logActivity(req, {
    entity: 'lead',
    entity_id: result.lead.id,
    action: 'lead_created_manual',
    new_value: fullName,
    metadata: {
      lead_name: fullName,
      phone,
      source: 'manual',
      assigned_to_user_id: result.assignee?.id || null,
      labels: result.labels.map(label => ({ id: label.id, name: label.name })),
      created_at: result.lead.created_at,
    },
  });

  const createdByName = req.user.name || req.user.full_name || null;
  const payload = {
    id: result.lead.id,
    name: result.lead.full_name,
    full_name: result.lead.full_name,
    phone: result.lead.phone,
    email: result.lead.email,
    source: 'manual',
    source_label: 'Manual',
    created_by_user_id: req.user.id,
    created_by_name: createdByName,
    created_by_role: req.user.role,
    manual_added_by_user_id: req.user.id,
    manual_added_by_name: createdByName,
    manual_added_by_role: req.user.role,
    manual_added_at: result.lead.manual_added_at,
    created_at: result.lead.created_at,
    labels: result.labels.map(label => ({ id: label.id, name: label.name, color: label.color })),
  };

    res.status(201).json({ success: true, data: { lead: payload }, lead: payload });
  } catch (error) {
    logger.error({
      route: 'POST /api/leads/manual',
      userId: req.user?.id,
      role: req.user?.role,
      code: error.code || error.errorCode || null,
      status: error.status || error.statusCode || null,
      message: error.message,
      stack: error.stack,
      db_code: error.code || null,
      db_detail: error.detail || null,
      db_table: error.table || null,
      db_column: error.column || null,
      db_constraint: error.constraint || null,
      input: {
        has_name: Boolean(req.body?.full_name || req.body?.name),
        has_email: Boolean(req.body?.email),
        has_phone: Boolean(req.body?.phone),
        has_city: Boolean(req.body?.city),
        has_state: Boolean(req.body?.state),
        category: req.body?.category || null,
        stage: req.body?.stage || null,
        call_status: req.body?.call_status || null,
        label_count: Array.isArray(req.body?.label_ids || req.body?.labelIds) ? (req.body?.label_ids || req.body?.labelIds).length : 0,
        assigned_to_user_id: req.body?.assigned_to_user_id || null,
      },
    }, 'Manual lead creation failed');
    throw toManualLeadCreateAppError(error);
  }
});

/** Admin/RM: manually create a lead and auto-assign. */
exports.create = asyncHandler(async (req, res) => {
  if (!['super_admin', 'rm'].includes(req.user.role)) throw new AppError(403, 'FORBIDDEN', 'Not allowed');
  const { full_name, phone, email, city, state, source, product_tag, campaign_label, campaign_name, meta_campaign_id, meta_form_id, raw_payload, assigned_to_user_id } = req.body;
  if (!full_name && !phone && !email) throw new AppError(400, 'INVALID_LEAD', 'Provide at least name/phone/email');

  // Phone/email dedup — the same person shouldn't be entered twice from a
  // manual form either.
  if (phone || email) {
    const dup = await findExistingByContact({ phone, email });
    if (dup) {
      return res.status(409).json({ success: false, error: { code: 'DUPLICATE_LEAD', message: `Lead already exists (matched by ${dup.reason})`, data: { id: dup.id } } });
    }
  }

  const categoryResolution = await resolveLeadCategory({ leadPayload: req.body || {} });
  const { rows: [lead] } = await query(
    `INSERT INTO leads (full_name, phone, email, city, state, source, product_tag, campaign_label,
                        campaign_name, meta_campaign_id, meta_form_id, raw_payload,
                        category, category_source, category_rule_id, category_resolved_at)
        VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'manual')::lead_source, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
        RETURNING id`,
    [full_name, phone, email, city, state, source || null, product_tag, campaign_label,
      campaign_name || null, meta_campaign_id || null, meta_form_id || null, raw_payload || null,
      categoryResolution.category, categoryResolution.source, categoryResolution.rule_id]
  );

  let assignment;
  if (assigned_to_user_id) {
    assignment = await reassignLead(lead.id, assigned_to_user_id, req.user.id, 'manual');
  } else {
    assignment = await assignLead(lead.id);
  }

  // Single chokepoint: Socket.IO broadcast + Google Sheet append (non-blocking)
  onLeadCreated(lead.id, { source: 'manual_create' });

  const { logActivity } = require('../utils/auditLog');
  await logActivity(req, {
    entity: 'lead', entity_id: lead.id, action: 'created',
    new_value: full_name || phone || email || '(unnamed)',
    metadata: { source: source || 'manual', assigned_to_user_id: assigned_to_user_id || null, campaign_label, product_tag },
  });

  res.status(201).json({ success: true, data: { id: lead.id, assignment } });
});
