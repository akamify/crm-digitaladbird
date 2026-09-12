const { query } = require('../config/database');
const { AppError } = require('../utils/errors');
const {
  businessDateToday,
  normalizeLeadDailyDate,
  buildLeadPeriodMetricConditions,
} = require('../utils/leadDailyMetrics');
const { buildLeadAllTimeMetricConditions } = require('../utils/leadAllTimeMetrics');
const { activeSequenceIssueSql } = require('../utils/leadCallIssueMetrics');
const { leadHasFollowupActivityCondition } = require('../utils/followupMetrics');
const {
  RETRYABLE_CONTACT_ISSUES,
  CALL_ISSUE_LABELS,
  sqlArray,
} = require('../constants/counselorReportOptions');

const ADMIN_ROLES = new Set(['super_admin', 'admin']);
const VIEW_MODES = new Set(['all_time', 'daily']);
const METRICS = new Set(['received', 'worked', 'pending', 'session_9pm', 'personal_meeting', 'converted', 'call_issues']);
const RETRYABLE_SQL = sqlArray(RETRYABLE_CONTACT_ISSUES);
const MAX_RANGE_DAYS = 366;
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function normalizeScope(input = {}, now = new Date()) {
  const view = String(input.view || 'all_time').trim().toLowerCase();
  if (!VIEW_MODES.has(view)) {
    throw new AppError(400, 'INVALID_ANALYTICS_VIEW', 'view must be all_time or daily');
  }
  if (view === 'all_time') return { view, from: null, to: null };

  const fallback = businessDateToday(now);
  const from = normalizeLeadDailyDate(input.from || input.selected_date || fallback, now);
  const to = normalizeLeadDailyDate(input.to || input.from || input.selected_date || fallback, now);
  if (from > to) throw new AppError(400, 'INVALID_DATE_RANGE', 'from must be on or before to');

  const duration = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (duration > MAX_RANGE_DAYS) {
    throw new AppError(400, 'DATE_RANGE_TOO_LARGE', `Date range cannot exceed ${MAX_RANGE_DAYS} days`);
  }
  return { view, from, to };
}

function normalizeMetric(value) {
  const fallback = 'received';
  const metric = String(value || fallback).trim().toLowerCase();
  if (!METRICS.has(metric)) throw new AppError(400, 'INVALID_ANALYTICS_METRIC', 'Select a valid lead metric');
  return metric;
}

function pushParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function requireUuid(value, code, message) {
  const candidate = String(value || '').trim();
  if (!UUID_PATTERN.test(candidate)) throw new AppError(400, code, message);
  return candidate;
}

function buildAnalyticsFilters(input, params, alias = 'l') {
  const clauses = [`${alias}.deleted_at IS NULL`];
  const text = value => String(value || '').trim();

  if (text(input.q)) {
    const param = pushParam(params, `%${text(input.q)}%`);
    clauses.push(`(${alias}.full_name ILIKE ${param} OR ${alias}.phone ILIKE ${param} OR ${alias}.email ILIKE ${param})`);
  }
  if (['partner', 'trader', 'unknown'].includes(text(input.category))) {
    clauses.push(`${alias}.category = ${pushParam(params, text(input.category))}`);
  }
  if (text(input.stage)) clauses.push(`${alias}.stage::text = ${pushParam(params, text(input.stage))}`);
  if (text(input.call_status)) {
    const param = pushParam(params, text(input.call_status));
    clauses.push(`(
      ${alias}.call_status::text = ${param}
      OR EXISTS (
        SELECT 1 FROM lead_remarks distribution_call_status
         WHERE distribution_call_status.lead_id = ${alias}.id
           AND (
             distribution_call_status.call_status::text = ${param}
             OR COALESCE(distribution_call_status.call_statuses, '[]'::jsonb) ? ${param}
           )
      )
    )`);
  }
  if (text(input.source)) clauses.push(`${alias}.source::text = ${pushParam(params, text(input.source))}`);
  if (text(input.form_id)) clauses.push(`${alias}.meta_form_id = ${pushParam(params, text(input.form_id))}`);
  if (text(input.campaign_id)) clauses.push(`${alias}.meta_campaign_id = ${pushParam(params, text(input.campaign_id))}`);
  if (text(input.campaign)) {
    const param = pushParam(params, `%${text(input.campaign)}%`);
    clauses.push(`(
      ${alias}.campaign_name ILIKE ${param}
      OR ${alias}.campaign_label ILIKE ${param}
      OR ${alias}.meta_campaign_id ILIKE ${param}
      OR EXISTS (
        SELECT 1 FROM meta_campaigns distribution_campaign
         WHERE distribution_campaign.campaign_id = ${alias}.meta_campaign_id
           AND (distribution_campaign.campaign_name ILIKE ${param} OR distribution_campaign.internal_label ILIKE ${param})
      )
    )`);
  }
  if (text(input.adset)) clauses.push(`${alias}.adset_name = ${pushParam(params, text(input.adset))}`);
  if (text(input.label_id)) {
    const param = pushParam(params, text(input.label_id));
    clauses.push(`EXISTS (
      SELECT 1 FROM lead_label_assignments distribution_label
       WHERE distribution_label.lead_id = ${alias}.id AND distribution_label.label_id = ${param}::uuid
    )`);
  }
  if (text(input.remark_status)) {
    const param = pushParam(params, text(input.remark_status));
    clauses.push(`(
      EXISTS (
        SELECT 1 FROM lead_remarks distribution_remark
         WHERE distribution_remark.lead_id = ${alias}.id
           AND (distribution_remark.call_status::text = ${param} OR COALESCE(distribution_remark.call_statuses, '[]'::jsonb) ? ${param})
      )
      OR EXISTS (
        SELECT 1 FROM lead_workflow distribution_workflow_remark
         WHERE distribution_workflow_remark.lead_id = ${alias}.id
           AND (distribution_workflow_remark.remark_status::text = ${param} OR COALESCE(distribution_workflow_remark.step_1_statuses, '[]'::jsonb) ? ${param})
      )
    )`);
  }
  if (text(input.customer_interest)) {
    const param = pushParam(params, text(input.customer_interest));
    clauses.push(`EXISTS (
      SELECT 1 FROM lead_remarks distribution_interest
       WHERE distribution_interest.lead_id = ${alias}.id AND distribution_interest.customer_interest = ${param}
    )`);
  }

  const assignment = text(input.assignment || input.assigned_to);
  if (assignment === 'assigned' || assignment === '__assigned') clauses.push(`${alias}.assigned_to_user_id IS NOT NULL`);
  else if (assignment === 'unassigned' || assignment === '__unassigned') clauses.push(`${alias}.assigned_to_user_id IS NULL`);
  else if (assignment && /^[0-9a-f-]{36}$/i.test(assignment)) {
    clauses.push(`${alias}.assigned_to_user_id = ${pushParam(params, assignment)}::uuid`);
  }

  const completedStatuses = `ARRAY['communication_completed','respond_hi','session_730_attend','yes_after_730_session']::text[]`;
  const workflowStatus = text(input.workflow_status);
  if (workflowStatus === 'step_1_pending') {
    clauses.push(`NOT EXISTS (
      SELECT 1 FROM lead_workflow distribution_workflow
       WHERE distribution_workflow.lead_id = ${alias}.id
         AND (
           distribution_workflow.remark_status::text = ANY(${completedStatuses})
           OR COALESCE(distribution_workflow.step_1_statuses, '[]'::jsonb) ?| ${completedStatuses}
         )
    )`);
  } else if (['step_1_completed', 'step_2_unlocked', 'completed_response'].includes(workflowStatus)) {
    clauses.push(`EXISTS (
      SELECT 1 FROM lead_workflow distribution_workflow
       WHERE distribution_workflow.lead_id = ${alias}.id
         AND (
           distribution_workflow.remark_status::text = ANY(${completedStatuses})
           OR COALESCE(distribution_workflow.step_1_statuses, '[]'::jsonb) ?| ${completedStatuses}
         )
    )`);
  }

  const latestActivity = text(input.latest_activity);
  if (latestActivity) {
    const latestActivityExpr = `GREATEST(
      ${alias}.updated_at,
      COALESCE((SELECT MAX(distribution_activity_remark.created_at) FROM lead_remarks distribution_activity_remark WHERE distribution_activity_remark.lead_id = ${alias}.id), ${alias}.updated_at),
      COALESCE((SELECT MAX(distribution_activity_workflow.updated_at) FROM lead_workflow distribution_activity_workflow WHERE distribution_activity_workflow.lead_id = ${alias}.id), ${alias}.updated_at)
    )`;
    if (latestActivity === 'today') clauses.push(`(${latestActivityExpr} AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date`);
    else if (latestActivity === 'yesterday') clauses.push(`(${latestActivityExpr} AT TIME ZONE 'Asia/Kolkata')::date = ((NOW() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '1 day')`);
    else if (latestActivity === 'last_7_days') clauses.push(`${latestActivityExpr} >= NOW() - INTERVAL '7 days'`);
    else if (latestActivity === 'last_30_days') clauses.push(`${latestActivityExpr} >= NOW() - INTERVAL '30 days'`);
  }

  const followup = text(input.followup);
  if (followup === 'today') clauses.push(`(${alias}.next_followup_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date`);
  else if (followup === 'overdue') clauses.push(`${alias}.next_followup_at < NOW()`);
  else if (followup === 'week') clauses.push(`${alias}.next_followup_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'`);
  else if (followup === 'upcoming') clauses.push(`${alias}.next_followup_at > NOW()`);
  else if (followup === 'no_followup') clauses.push(`NOT ${leadHasFollowupActivityCondition(alias)}`);

  return clauses;
}

function metricConditions(scope, params, alias = 'l') {
  if (scope.view === 'daily') {
    const fromParam = `${pushParam(params, scope.from)}::date`;
    const toParam = `${pushParam(params, scope.to)}::date`;
    return buildLeadPeriodMetricConditions(fromParam, toParam, alias);
  }
  const allTime = buildLeadAllTimeMetricConditions(alias);
  return { received: allTime.all, ...allTime };
}

function buildScopeCte(input, scope, params) {
  const filters = buildAnalyticsFilters(input, params, 'source_lead');
  const conditions = metricConditions(scope, params, 'l');
  const cohortFilter = scope.view === 'daily' ? conditions.received : 'TRUE';
  const flags = [...METRICS]
    .map(metric => `${conditions[metric]} AS metric_${metric}`)
    .join(',\n        ');

  return {
    conditions,
    sql: `WITH lead_candidates AS MATERIALIZED (
      SELECT source_lead.*,
        assignee.role::text AS assignee_role,
        assignee.status::text AS assignee_status,
        assignee.deleted_at AS assignee_deleted_at,
        assignee.report_to_id AS assignee_rm_id,
        CASE
          WHEN assignee.role::text IN ('member', 'partner') THEN COALESCE(assignee.report_to_id, source_lead.pool_rm_id)
          WHEN assignee.role::text = 'rm' THEN assignee.id
          ELSE source_lead.pool_rm_id
        END AS candidate_rm_id
      FROM leads source_lead
      LEFT JOIN users assignee ON assignee.id = source_lead.assigned_to_user_id
      WHERE ${filters.join(' AND ')}
    ), scoped_leads AS MATERIALIZED (
      SELECT candidate.*,
        CASE
          WHEN rm.id IS NOT NULL
           AND rm.role::text = 'rm'
           AND rm.deleted_at IS NULL
          THEN rm.id
          ELSE NULL
        END AS distribution_rm_id,
        CASE
          WHEN candidate.assignee_role IN ('member', 'partner')
           AND candidate.assignee_deleted_at IS NULL
           AND candidate.assignee_status = 'active'
           AND candidate.assignee_rm_id = rm.id
          THEN candidate.assigned_to_user_id
          ELSE NULL
        END AS distribution_counselor_id
      FROM lead_candidates candidate
      LEFT JOIN users rm ON rm.id = candidate.candidate_rm_id
    ), classified AS MATERIALIZED (
      SELECT l.*,
        ${flags}
      FROM scoped_leads l
      WHERE ${cohortFilter}
    )`,
  };
}

function summarySelect(alias = 'c') {
  return [...METRICS]
    .map(metric => `COUNT(*) FILTER (WHERE ${alias}.metric_${metric})::int AS ${metric}`)
    .join(',\n        ');
}

function numericSummary(row = {}) {
  return Object.fromEntries([...METRICS].map(metric => [metric, Number(row?.[metric] || 0)]));
}

function numericCard(row = {}) {
  return { ...row, ...numericSummary(row), counselor_count: Number(row.counselor_count || 0) };
}

async function assertRmAccess(actor, rmId) {
  const safeRmId = requireUuid(rmId, 'INVALID_RM_ID', 'Select a valid Relationship Manager');
  const { rows: [rm] } = await query(
    `SELECT id, full_name, team_name, role::text AS role, status::text AS status
       FROM users
      WHERE id = $1::uuid AND role::text = 'rm' AND deleted_at IS NULL`,
    [safeRmId],
  );
  if (!rm) throw new AppError(404, 'RM_NOT_FOUND', 'Relationship Manager not found');
  if (ADMIN_ROLES.has(actor.role)) return rm;
  if (actor.role === 'rm' && actor.id === rm.id) return rm;
  if (['member', 'partner'].includes(actor.role) && actor.report_to_id === rm.id) return rm;
  throw new AppError(403, 'FORBIDDEN', 'You cannot access this RM analytics scope');
}

async function assertCounselorAccess(actor, rmId, counselorId) {
  const rm = await assertRmAccess(actor, rmId);
  const safeCounselorId = requireUuid(counselorId, 'INVALID_COUNSELOR_ID', 'Select a valid counselor');
  const { rows: [counselor] } = await query(
    `SELECT id, full_name, role::text AS role, status::text AS status, report_to_id, team_name
       FROM users
      WHERE id = $1::uuid
        AND role::text IN ('member', 'partner')
        AND report_to_id = $2::uuid
        AND deleted_at IS NULL`,
    [safeCounselorId, rm.id],
  );
  if (!counselor) throw new AppError(404, 'COUNSELOR_NOT_FOUND', 'Counselor not found under this RM');
  if (['member', 'partner'].includes(actor.role) && actor.id !== counselor.id) {
    throw new AppError(403, 'FORBIDDEN', 'You cannot access another counselor analytics scope');
  }
  return { rm, counselor };
}

function rmAccessClause(actor, params, alias = 'rm') {
  if (ADMIN_ROLES.has(actor.role)) {
    return { rm: 'TRUE', summary: 'TRUE', unassigned: 'TRUE' };
  }
  if (actor.role === 'rm') {
    const actorParam = `${pushParam(params, actor.id)}::uuid`;
    return {
      rm: `${alias}.id = ${actorParam}`,
      summary: `c.distribution_rm_id = ${actorParam}`,
      unassigned: 'FALSE',
    };
  }
  throw new AppError(403, 'FORBIDDEN', 'RM distribution is not available for this role');
}

function sortSql(input, allowed, fallback) {
  const key = String(input.sort || fallback).trim().toLowerCase();
  const selected = allowed[key] || allowed[fallback];
  const order = String(input.order || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `${selected} ${key === 'name' && !input.order ? 'ASC' : order}, full_name ASC`;
}

async function listRms(actor, input = {}) {
  const scope = normalizeScope(input);
  const params = [];
  const { sql: cte } = buildScopeCte(input, scope, params);
  const access = rmAccessClause(actor, params);
  const search = String(input.search || '').trim();
  const searchClause = search ? `AND rm.full_name ILIKE ${pushParam(params, `%${search}%`)}` : '';
  const order = sortSql(input, {
    received: 'received', worked: 'worked', pending: 'pending', converted: 'converted', call_issues: 'call_issues', name: 'full_name',
  }, 'received');

  const { rows: [result] } = await query(`${cte},
    overall AS (
      SELECT ${summarySelect('c')} FROM classified c WHERE ${access.summary}
    ), rm_metrics AS (
      SELECT rm.id, rm.full_name, rm.team_name,
        (SELECT COUNT(*)::int FROM users member
          WHERE member.report_to_id = rm.id
            AND member.role::text IN ('member', 'partner')
            AND member.status::text = 'active'
            AND member.deleted_at IS NULL) AS counselor_count,
        ${summarySelect('c')}
      FROM users rm
      LEFT JOIN classified c ON c.distribution_rm_id = rm.id
      WHERE rm.role::text = 'rm'
        AND rm.status::text = 'active'
        AND rm.deleted_at IS NULL
        AND ${access.rm}
        ${searchClause}
      GROUP BY rm.id, rm.full_name, rm.team_name
    ), unassigned AS (
      SELECT ${summarySelect('c')} FROM classified c WHERE c.distribution_rm_id IS NULL AND ${access.unassigned}
    )
    SELECT
      (SELECT row_to_json(overall) FROM overall) AS summary,
      COALESCE((SELECT jsonb_agg(to_jsonb(rm_metrics) ORDER BY ${order}) FROM rm_metrics), '[]'::jsonb) AS rms,
      (SELECT row_to_json(unassigned) FROM unassigned) AS unassigned`, params);

  const summary = numericSummary(result.summary);
  const rms = (result.rms || []).map(numericCard).map(card => ({
    ...card,
    distribution_share: summary.received ? Number((card.received / summary.received * 100).toFixed(1)) : 0,
  }));
  return {
    scope,
    summary,
    rms,
    unassigned: { id: null, full_name: 'Unassigned RM', ...numericCard(result.unassigned) },
  };
}

async function listCounselors(actor, rmId, input = {}) {
  const rm = await assertRmAccess(actor, rmId);
  const scope = normalizeScope(input);
  const params = [];
  const { sql: cte } = buildScopeCte(input, scope, params);
  const rmParam = `${pushParam(params, rmId)}::uuid`;
  const search = String(input.search || '').trim();
  const searchClause = search ? `AND counselor.full_name ILIKE ${pushParam(params, `%${search}%`)}` : '';
  const order = sortSql(input, {
    received: 'received', worked: 'worked', pending: 'pending', converted: 'converted', call_issues: 'call_issues', name: 'full_name',
  }, 'received');

  const { rows: [result] } = await query(`${cte},
    rm_summary AS (
      SELECT ${summarySelect('c')} FROM classified c WHERE c.distribution_rm_id = ${rmParam}
    ), counselor_metrics AS (
      SELECT counselor.id, counselor.full_name, counselor.team_name,
        0::int AS counselor_count,
        ${summarySelect('c')},
        MAX(GREATEST(c.updated_at, COALESCE(c.last_call_at, c.updated_at))) AS last_activity_at
      FROM users counselor
      LEFT JOIN classified c
        ON c.distribution_rm_id = ${rmParam}
       AND c.distribution_counselor_id = counselor.id
      WHERE counselor.report_to_id = ${rmParam}
        AND counselor.role::text IN ('member', 'partner')
        AND counselor.status::text = 'active'
        AND counselor.deleted_at IS NULL
        ${searchClause}
      GROUP BY counselor.id, counselor.full_name, counselor.team_name
    ), unassigned AS (
      SELECT ${summarySelect('c')}
      FROM classified c
      WHERE c.distribution_rm_id = ${rmParam} AND c.distribution_counselor_id IS NULL
    )
    SELECT
      (SELECT row_to_json(rm_summary) FROM rm_summary) AS summary,
      COALESCE((SELECT jsonb_agg(to_jsonb(counselor_metrics) ORDER BY ${order}) FROM counselor_metrics), '[]'::jsonb) AS counselors,
      (SELECT row_to_json(unassigned) FROM unassigned) AS unassigned`, params);

  const summary = numericSummary(result.summary);
  const counselors = (result.counselors || []).map(numericCard).map(card => ({
    ...card,
    work_rate: card.received ? Number((card.worked / card.received * 100).toFixed(1)) : 0,
  }));
  return {
    scope,
    rm,
    summary,
    counselors,
    unassigned: { id: null, full_name: 'Unassigned to Counselor', ...numericCard(result.unassigned) },
  };
}

function issueStatusSql(alias = 'l') {
  return `COALESCE(${activeSequenceIssueSql(alias)}, ${alias}.call_status::text)`;
}

function pagination(input = {}) {
  const page = Math.max(1, Number.parseInt(input.page || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(input.page_size || '25', 10) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

async function getCounselorLeads(actor, rmId, counselorId, input = {}) {
  const { rm, counselor } = await assertCounselorAccess(actor, rmId, counselorId);
  const scope = normalizeScope(input);
  const metric = normalizeMetric(input.metric);
  const requestedIssue = String(input.call_issue_type || '').trim().toLowerCase();
  if (requestedIssue && !RETRYABLE_CONTACT_ISSUES.includes(requestedIssue)) {
    throw new AppError(400, 'INVALID_CALL_ISSUE', 'Select a valid call issue');
  }
  const { page, pageSize, offset } = pagination(input);

  const summaryParams = [];
  const { sql: summaryCte } = buildScopeCte(input, scope, summaryParams);
  const summaryRm = `${pushParam(summaryParams, rmId)}::uuid`;
  const summaryCounselor = `${pushParam(summaryParams, counselorId)}::uuid`;
  const effectiveIssue = issueStatusSql('c');
  const { rows: [summaryResult] } = await query(`${summaryCte},
    counselor_scope AS MATERIALIZED (
      SELECT c.* FROM classified c
       WHERE c.distribution_rm_id = ${summaryRm}
         AND c.distribution_counselor_id = ${summaryCounselor}
    ), issue_buckets AS (
      SELECT ${effectiveIssue} AS issue, COUNT(*)::int AS count
        FROM counselor_scope c
       WHERE c.metric_call_issues
       GROUP BY ${effectiveIssue}
    )
    SELECT
      (SELECT row_to_json(summary_row) FROM (SELECT ${summarySelect('c')} FROM counselor_scope c) summary_row) AS summary,
      COALESCE((SELECT jsonb_object_agg(issue, count) FROM issue_buckets WHERE issue = ANY(${RETRYABLE_SQL})), '{}'::jsonb) AS call_issue_buckets`, summaryParams);

  const rowParams = [];
  const { sql: rowCte } = buildScopeCte(input, scope, rowParams);
  const rowRm = `${pushParam(rowParams, rmId)}::uuid`;
  const rowCounselor = `${pushParam(rowParams, counselorId)}::uuid`;
  const issueClause = requestedIssue
    ? `${issueStatusSql('c')} = ${pushParam(rowParams, requestedIssue)}`
    : 'TRUE';
  const limitParam = pushParam(rowParams, pageSize);
  const offsetParam = pushParam(rowParams, offset);
  const metricFlag = `c.metric_${metric}`;

  const { rows } = await query(`${rowCte},
    candidates AS MATERIALIZED (
      SELECT c.*
        FROM classified c
       WHERE c.distribution_rm_id = ${rowRm}
         AND c.distribution_counselor_id = ${rowCounselor}
         AND ${metricFlag}
         AND ${metric === 'call_issues' ? issueClause : 'TRUE'}
    )
    SELECT c.id, c.full_name, c.phone, c.email, c.source::text AS source,
      c.campaign_name, c.campaign_label, c.assigned_at, c.created_at,
      c.stage::text AS stage, c.call_status::text AS call_status,
      latest_remark.remark AS current_remark,
      latest_remark.call_status::text AS latest_remark_status,
      latest_remark.created_at AS latest_remark_at,
      c.next_followup_at,
      latest_attempt.attempt_number,
      latest_attempt.status::text AS attempt_status,
      latest_attempt.scheduled_at AS attempt_scheduled_at,
      latest_attempt.attempted_at,
      latest_attempt.outcome::text AS attempt_outcome,
      latest_attempt.trigger_reason::text AS attempt_reason,
      next_attempt.scheduled_at AS next_attempt_at,
      conversion_evidence.converted_at,
      conversion_evidence.conversion_source,
      GREATEST(c.updated_at, COALESCE(latest_remark.created_at, c.updated_at), COALESCE(last_call.created_at, c.updated_at)) AS last_activity_at,
      c.metric_call_issues AS has_call_issue,
      CASE WHEN c.metric_call_issues THEN ${issueStatusSql('c')} ELSE NULL END AS effective_call_issue,
      COUNT(*) OVER()::int AS total_count
    FROM candidates c
    LEFT JOIN LATERAL (
      SELECT lr.remark, lr.call_status, lr.created_at
        FROM lead_remarks lr WHERE lr.lead_id = c.id
       ORDER BY lr.created_at DESC, lr.id DESC LIMIT 1
    ) latest_remark ON TRUE
    LEFT JOIN LATERAL (
      SELECT ca.attempt_number, ca.status, ca.scheduled_at, ca.attempted_at, ca.outcome, ca.trigger_reason
        FROM lead_call_attempts ca
       WHERE ca.lead_id = c.id
       ORDER BY COALESCE(ca.attempted_at, ca.scheduled_at, ca.created_at) DESC, ca.attempt_number DESC
       LIMIT 1
    ) latest_attempt ON TRUE
    LEFT JOIN LATERAL (
      SELECT ca.scheduled_at
        FROM lead_call_attempts ca
        JOIN lead_call_attempt_sequences seq ON seq.id = ca.sequence_id AND seq.status = 'active'
       WHERE ca.lead_id = c.id AND ca.status = 'scheduled'
       ORDER BY ca.scheduled_at ASC LIMIT 1
    ) next_attempt ON TRUE
    LEFT JOIN LATERAL (
      SELECT cl.created_at FROM lead_call_logs cl WHERE cl.lead_id = c.id ORDER BY cl.created_at DESC LIMIT 1
    ) last_call ON TRUE
    LEFT JOIN LATERAL (
      SELECT evidence.converted_at, evidence.conversion_source
      FROM (
        SELECT lr.created_at AS converted_at, 'remark'::text AS conversion_source
          FROM lead_remarks lr
         WHERE lr.lead_id = c.id
           AND (lr.call_status::text = 'converted' OR COALESCE(lr.call_statuses, '[]'::jsonb) ? 'converted')
        UNION ALL
        SELECT wh.created_at, 'workflow'::text
          FROM lead_workflow_history wh
         WHERE wh.lead_id = c.id
           AND (wh.new_value = 'converted' OR (COALESCE(wh.metadata, '{}'::jsonb)->'step_1_statuses') ? 'converted')
        UNION ALL
        SELECT le.occurred_at, 'lifecycle'::text
          FROM lead_lifecycle_events le
         WHERE le.lead_id = c.id
           AND le.event_type = 'lifecycle_closed'
           AND COALESCE(le.metadata->>'terminal_state', '') = 'converted'
        UNION ALL
        SELECT NULL::timestamptz, 'lead_state'::text
         WHERE c.call_status::text = 'converted' OR c.stage::text = 'won'
      ) evidence
      ORDER BY evidence.converted_at DESC NULLS LAST
      LIMIT 1
    ) conversion_evidence ON TRUE
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ${limitParam} OFFSET ${offsetParam}`, rowParams);

  const leadIds = rows.filter(row => row.has_call_issue).map(row => row.id);
  const attemptsByLead = new Map();
  if (leadIds.length) {
    const { rows: attempts } = await query(`
      SELECT ca.id, ca.lead_id, ca.attempt_number, ca.status::text AS status,
        ca.trigger_reason::text AS trigger_reason, ca.outcome::text AS outcome,
        ca.scheduled_at, ca.attempted_at, ca.is_final_attempt,
        CASE
          WHEN ca.attempt_number = 1 THEN 'initial_issue'
          WHEN ca.status = 'completed' THEN 'completed'
          WHEN ca.status = 'missed' OR (ca.status = 'scheduled' AND ca.scheduled_at <= NOW()) THEN 'missed'
          WHEN ca.status = 'scheduled' THEN 'upcoming'
          ELSE 'not_required'
        END AS attempt_state,
        CASE WHEN ca.status IN ('scheduled', 'missed') AND ca.scheduled_at <= NOW()
          THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - ca.scheduled_at)) / 60))::int END AS overdue_by_minutes
      FROM lead_call_attempts ca
      JOIN lead_call_attempt_sequences seq ON seq.id = ca.sequence_id AND seq.status = 'active'
      WHERE ca.lead_id = ANY($1::uuid[])
      ORDER BY ca.lead_id, ca.attempt_number ASC`, [leadIds]);
    for (const attempt of attempts) {
      const list = attemptsByLead.get(attempt.lead_id) || [];
      list.push(attempt);
      attemptsByLead.set(attempt.lead_id, list);
    }
  }

  return {
    scope,
    rm,
    counselor,
    summary: numericSummary(summaryResult.summary),
    call_issue_buckets: Object.fromEntries(
      Object.entries(summaryResult.call_issue_buckets || {}).map(([key, value]) => [key, Number(value || 0)]),
    ),
    call_issue_labels: CALL_ISSUE_LABELS,
    rows: rows.map(({ total_count: _total, ...row }) => ({ ...row, attempts: attemptsByLead.get(row.id) || [] })),
    total: Number(rows[0]?.total_count || 0),
    page,
    page_size: pageSize,
    metric,
  };
}

module.exports = {
  normalizeScope,
  normalizeMetric,
  buildAnalyticsFilters,
  listRms,
  listCounselors,
  getCounselorLeads,
  _buildScopeCte: buildScopeCte,
};
