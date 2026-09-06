const { query } = require('../config/database');
const { getVisibleUserIds } = require('../middleware/rbac');
const { AppError } = require('../utils/errors');
const { notWorkedLeadCondition } = require('../utils/leadWorkMetrics');
const { UNWORKED_SLA_HOURS } = require('../constants/counselorReportOptions');

const QUEUE_TYPES = new Set(['all', 'overdue_retry', 'unworked', 'followup', 'meeting']);
const QUEUE_ROLES = new Set(['super_admin', 'admin', 'rm', 'member', 'partner']);

function normalizeInput(input = {}) {
  const type = String(input.type || 'all').trim().toLowerCase();
  if (!QUEUE_TYPES.has(type)) {
    throw new AppError(400, 'INVALID_ACTION_QUEUE_TYPE', 'Select a valid action queue type.');
  }

  const page = Math.max(1, Number.parseInt(input.page || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(input.page_size || '25', 10) || 25));
  const search = String(input.q || '').trim().slice(0, 120);
  return { type, page, pageSize, search, offset: (page - 1) * pageSize };
}

function pushParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function buildQueueQuery({ visibleIds, type, pageSize, search, offset }) {
  const params = [];
  const visibleParam = visibleIds === null ? null : pushParam(params, visibleIds);
  const leadScope = visibleParam ? `AND l.assigned_to_user_id = ANY(${visibleParam}::uuid[])` : '';
  const meetingScope = visibleParam ? `AND (
    l.assigned_to_user_id = ANY(${visibleParam}::uuid[])
    OR n.counselor_user_id = ANY(${visibleParam}::uuid[])
    OR n.rm_user_id = ANY(${visibleParam}::uuid[])
    OR n.meeting_owner_user_id = ANY(${visibleParam}::uuid[])
    OR n.meeting_counselor_user_ids && ${visibleParam}::uuid[]
  )` : '';
  const typeParam = pushParam(params, type);
  const searchParam = search ? pushParam(params, `%${search}%`) : null;
  const searchClause = searchParam ? `AND (
    task.lead_name ILIKE ${searchParam}
    OR task.phone ILIKE ${searchParam}
    OR task.assigned_to_name ILIKE ${searchParam}
    OR task.campaign_name ILIKE ${searchParam}
  )` : '';
  const limitParam = pushParam(params, pageSize);
  const offsetParam = pushParam(params, offset);

  const sql = `WITH bounds AS MATERIALIZED (
    SELECT
      date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' AS today_start,
      (date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '1 day') AT TIME ZONE 'Asia/Kolkata' AS today_end
  ), visible_leads AS MATERIALIZED (
    SELECT
      l.id,
      l.full_name,
      l.phone,
      l.source,
      l.campaign_name,
      l.campaign_label,
      l.assigned_to_user_id,
      l.assigned_at,
      l.next_followup_at,
      l.call_status,
      l.last_call_at,
      assignee.full_name AS assigned_to_name
      FROM leads l
      LEFT JOIN users assignee ON assignee.id = l.assigned_to_user_id
     WHERE l.deleted_at IS NULL
       AND l.assigned_to_user_id IS NOT NULL
       ${leadScope}
  ), overdue_retry_source AS MATERIALIZED (
    SELECT DISTINCT ON (vl.id)
      ('retry:' || ca.id::text) AS task_id,
      'overdue_retry'::text AS task_type,
      'Complete overdue retry'::text AS title,
      ('Retry ' || GREATEST(ca.attempt_number - 1, 1)::text || ' was scheduled for ' || COALESCE(ca.trigger_reason, 'call issue'))::text AS reason,
      ca.scheduled_at AS due_at,
      'urgent'::text AS priority,
      1::int AS priority_rank,
      GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - ca.scheduled_at)) / 60))::int AS age_minutes,
      vl.id AS lead_id,
      vl.full_name AS lead_name,
      vl.phone,
      vl.source,
      COALESCE(vl.campaign_name, vl.campaign_label) AS campaign_name,
      vl.assigned_to_user_id,
      vl.assigned_to_name,
      ca.id AS attempt_id,
      ca.attempt_number,
      NULL::uuid AS meeting_id,
      NULL::text AS meeting_mode
    FROM visible_leads vl
    JOIN lead_call_attempts ca ON ca.lead_id = vl.id
    JOIN lead_call_attempt_sequences seq ON seq.id = ca.sequence_id AND seq.status = 'active'
    WHERE ca.status = 'scheduled'
      AND ca.scheduled_at < NOW()
    ORDER BY vl.id, ca.scheduled_at ASC, ca.id
  ), unworked_source AS MATERIALIZED (
    SELECT
      ('unworked:' || vl.id::text) AS task_id,
      'unworked'::text AS task_type,
      'Make the first contact'::text AS title,
      'No qualifying call or remark has been recorded'::text AS reason,
      vl.assigned_at AS due_at,
      CASE
        WHEN vl.assigned_at <= NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.critical}) THEN 'urgent'
        WHEN vl.assigned_at <= NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.delayed}) THEN 'high'
        WHEN vl.assigned_at <= NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.needs_action}) THEN 'medium'
        ELSE 'normal'
      END::text AS priority,
      CASE
        WHEN vl.assigned_at <= NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.critical}) THEN 6
        WHEN vl.assigned_at <= NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.delayed}) THEN 7
        WHEN vl.assigned_at <= NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.needs_action}) THEN 8
        ELSE 9
      END::int AS priority_rank,
      GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - vl.assigned_at)) / 60))::int AS age_minutes,
      vl.id AS lead_id,
      vl.full_name AS lead_name,
      vl.phone,
      vl.source,
      COALESCE(vl.campaign_name, vl.campaign_label) AS campaign_name,
      vl.assigned_to_user_id,
      vl.assigned_to_name,
      NULL::uuid AS attempt_id,
      NULL::int AS attempt_number,
      NULL::uuid AS meeting_id,
      NULL::text AS meeting_mode
    FROM visible_leads vl
    WHERE vl.assigned_at IS NOT NULL
      AND ${notWorkedLeadCondition('vl')}
  ), followup_source AS MATERIALIZED (
    SELECT
      ('followup:' || vl.id::text) AS task_id,
      'followup'::text AS task_type,
      'Complete today''s follow-up'::text AS title,
      'Follow-up is scheduled for today'::text AS reason,
      vl.next_followup_at AS due_at,
      CASE WHEN vl.next_followup_at < NOW() THEN 'high' ELSE 'medium' END::text AS priority,
      CASE WHEN vl.next_followup_at < NOW() THEN 4 ELSE 5 END::int AS priority_rank,
      GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - vl.next_followup_at)) / 60))::int AS age_minutes,
      vl.id AS lead_id,
      vl.full_name AS lead_name,
      vl.phone,
      vl.source,
      COALESCE(vl.campaign_name, vl.campaign_label) AS campaign_name,
      vl.assigned_to_user_id,
      vl.assigned_to_name,
      NULL::uuid AS attempt_id,
      NULL::int AS attempt_number,
      NULL::uuid AS meeting_id,
      NULL::text AS meeting_mode
    FROM visible_leads vl
    CROSS JOIN bounds b
    WHERE vl.next_followup_at >= b.today_start
      AND vl.next_followup_at < b.today_end
  ), meeting_source AS MATERIALIZED (
    SELECT
      ('meeting:' || n.id::text) AS task_id,
      'meeting'::text AS task_type,
      'Attend today''s meeting'::text AS title,
      COALESCE(NULLIF(n.meeting_name, ''), 'Personal meeting scheduled for today')::text AS reason,
      n.meeting_at AS due_at,
      CASE WHEN n.meeting_at < NOW() THEN 'urgent' ELSE 'high' END::text AS priority,
      CASE WHEN n.meeting_at < NOW() THEN 2 ELSE 3 END::int AS priority_rank,
      GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - n.meeting_at)) / 60))::int AS age_minutes,
      l.id AS lead_id,
      COALESCE(l.full_name, n.customer_name) AS lead_name,
      COALESCE(l.phone, n.customer_phone) AS phone,
      l.source,
      COALESCE(l.campaign_name, l.campaign_label) AS campaign_name,
      COALESCE(n.counselor_user_id, l.assigned_to_user_id, n.meeting_owner_user_id) AS assigned_to_user_id,
      COALESCE(counselor.full_name, assignee.full_name, meeting_owner.full_name) AS assigned_to_name,
      NULL::uuid AS attempt_id,
      NULL::int AS attempt_number,
      n.id AS meeting_id,
      n.meeting_mode
    FROM customer_notes n
    CROSS JOIN bounds b
    LEFT JOIN leads l ON l.id = n.lead_id AND l.deleted_at IS NULL
    LEFT JOIN users counselor ON counselor.id = n.counselor_user_id
    LEFT JOIN users assignee ON assignee.id = l.assigned_to_user_id
    LEFT JOIN users meeting_owner ON meeting_owner.id = n.meeting_owner_user_id
    WHERE n.deleted_at IS NULL
      AND n.note_kind = 'personal_meeting'
      AND n.meeting_at >= b.today_start
      AND n.meeting_at < b.today_end
      AND n.meeting_outcome IS NULL
      ${meetingScope}
  ), tasks AS MATERIALIZED (
    SELECT * FROM overdue_retry_source
    UNION ALL SELECT * FROM meeting_source
    UNION ALL SELECT * FROM followup_source
    UNION ALL SELECT * FROM unworked_source
  ), summary AS (
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE task_type = 'overdue_retry')::int AS overdue_retry,
      COUNT(*) FILTER (WHERE task_type = 'unworked')::int AS unworked,
      COUNT(*) FILTER (WHERE task_type = 'followup')::int AS followup,
      COUNT(*) FILTER (WHERE task_type = 'meeting')::int AS meeting
    FROM tasks
  ), filtered_tasks AS MATERIALIZED (
    SELECT task.*
      FROM tasks task
     WHERE (${typeParam}::text = 'all' OR task.task_type = ${typeParam}::text)
       ${searchClause}
  ), paged AS (
    SELECT *
      FROM filtered_tasks
     ORDER BY priority_rank ASC, due_at ASC NULLS LAST, task_id ASC
     LIMIT ${limitParam} OFFSET ${offsetParam}
  )
  SELECT
    (SELECT row_to_json(summary) FROM summary) AS summary,
    (SELECT COUNT(*)::int FROM filtered_tasks) AS total,
    COALESCE((SELECT jsonb_agg(to_jsonb(paged) ORDER BY priority_rank ASC, due_at ASC NULLS LAST, task_id ASC) FROM paged), '[]'::jsonb) AS rows`;

  return { sql, params };
}

async function listActionQueue(actor, input = {}) {
  if (!actor?.id || !QUEUE_ROLES.has(actor.role)) {
    throw new AppError(403, 'ACTION_QUEUE_FORBIDDEN', 'Action queue is not available for this role.');
  }

  const normalized = normalizeInput(input);
  const visibleIds = await getVisibleUserIds(actor);
  if (visibleIds !== null && visibleIds.length === 0) {
    return {
      scope: actor.role === 'rm' ? 'team' : 'self',
      summary: { total: 0, overdue_retry: 0, unworked: 0, followup: 0, meeting: 0 },
      rows: [], total: 0, page: normalized.page, page_size: normalized.pageSize,
    };
  }

  const built = buildQueueQuery({ visibleIds, ...normalized });
  const { rows: [result] } = await query(built.sql, built.params);
  return {
    scope: ['super_admin', 'admin'].includes(actor.role) ? 'all' : actor.role === 'rm' ? 'team' : 'self',
    summary: result?.summary || { total: 0, overdue_retry: 0, unworked: 0, followup: 0, meeting: 0 },
    rows: (result?.rows || []).map(row => ({
      ...row,
      age_minutes: Number(row.age_minutes || 0),
      attempt_number: row.attempt_number === null ? null : Number(row.attempt_number),
      priority_rank: Number(row.priority_rank || 0),
    })),
    total: Number(result?.total || 0),
    page: normalized.page,
    page_size: normalized.pageSize,
  };
}

module.exports = { listActionQueue, normalizeInput, _buildQueueQuery: buildQueueQuery };
