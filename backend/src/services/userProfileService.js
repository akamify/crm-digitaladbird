const { query, withTransaction } = require('../config/database');
const { AppError } = require('../utils/errors');
const { workedLeadCondition, notWorkedLeadCondition } = require('../utils/leadWorkMetrics');
const { remarkHasFollowupActivityCondition } = require('../utils/followupMetrics');
const { RETRYABLE_CONTACT_ISSUES, CALL_ISSUE_LABELS } = require('../constants/counselorReportOptions');
const { GRACE_MINUTES: ATTEMPT_GRACE_MINUTES } = require('./leadCallAttemptService');
const { assertCpIdNotEditable, normalizeRole } = require('./userIdentityService');
const { updateSingleLeadAvailability } = require('./userAvailabilityService');

const ADMIN_ROLES = new Set(['super_admin', 'admin']);
const CLOSED_CALL_STATUSES = ['converted', 'not_interested', 'wrong_number', 'invalid_number'];

function normalizedRole(role) {
  return role === 'partner' ? 'member' : role;
}

function profileTypeFor(user) {
  if (!user || user.status === 'deleted' || user.deleted_at) return 'deleted';
  const role = normalizedRole(user.role);
  if (ADMIN_ROLES.has(role)) return 'admin';
  if (role === 'rm') return 'rm';
  return 'member';
}

async function safeQuery(sql, params = [], fallbackRows = []) {
  try {
    const result = await query(sql, params);
    return result.rows;
  } catch {
    return fallbackRows;
  }
}

function rangeToDates(range = '30d', startDate, endDate) {
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(end);
  if (!startDate) {
    const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
    start.setDate(start.getDate() - days + 1);
  }
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

async function assertProfileAccess(actor, userId, { edit = false } = {}) {
  if (!actor) throw new AppError(401, 'NO_USER', 'Not authenticated');
  if (ADMIN_ROLES.has(actor.role)) return;
  if (normalizedRole(actor.role) === 'member') {
    if (actor.id !== userId || edit) throw new AppError(403, 'FORBIDDEN', 'You can only view your own profile');
    return;
  }
  if (actor.role !== 'rm') throw new AppError(403, 'FORBIDDEN', 'Insufficient permissions');
  if (edit) throw new AppError(403, 'FORBIDDEN', 'RM cannot edit user profiles');
  const { rows: [target] } = await query(
    `SELECT id FROM users
      WHERE deleted_at IS NULL
        AND (id = $1 OR report_to_id = $1)
        AND id = $2`,
    [actor.id, userId],
  );
  if (!target) throw new AppError(403, 'FORBIDDEN', 'You can only view users in your team');
}

async function getSanitizedUser(userId) {
  const { rows: [user] } = await query(`
    SELECT u.id, u.emp_code, u.full_name, u.email, u.phone, u.cp_id,
           u.role, u.member_type, u.status, u.report_to_id, u.team_name,
           u.daily_lead_cap, u.distribution_weight, u.is_available,
           u.distribution_blocked, u.distribution_blocked_reason,
           u.distribution_blocked_at, u.blocked_at, u.blocked_by, u.deleted_at,
           u.lead_assignment_enabled, u.lead_assignment_status,
           u.lead_assignment_disabled_reason, u.lead_assignment_updated_by,
           u.lead_assignment_updated_at, lau.full_name AS lead_assignment_updated_by_name,
           u.deleted_by, u.delete_reason, u.last_login_at, u.created_at, u.updated_at,
           rm.id AS rm_id, rm.full_name AS rm_name, rm.email AS rm_email
      FROM users u
      LEFT JOIN users rm ON rm.id = u.report_to_id
      LEFT JOIN users lau ON lau.id = u.lead_assignment_updated_by
     WHERE u.id = $1 AND COALESCE(u.is_hidden, FALSE) = FALSE
  `, [userId]);
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  user.role = normalizedRole(user.role);
  return user;
}

async function getBasicCounts(userId) {
  const { rows: [counts] } = await query(`
    SELECT
      COUNT(*)::int AS total_assigned_leads,
      COUNT(*) FILTER (WHERE ${notWorkedLeadCondition('l')})::int AS pending_leads,
      COUNT(*) FILTER (WHERE ${workedLeadCondition('l')})::int AS worked_leads,
      COUNT(*) FILTER (WHERE l.call_status = 'converted')::int AS converted_leads,
      COUNT(*) FILTER (WHERE l.stage = 'lost' OR l.call_status IN ('not_interested','wrong_number','invalid_number'))::int AS lost_not_interested_leads,
      COUNT(*) FILTER (WHERE l.next_followup_at IS NOT NULL AND l.next_followup_at <= NOW())::int AS followups_due,
      COUNT(*) FILTER (WHERE l.assigned_at::date = CURRENT_DATE)::int AS assigned_today,
      COUNT(*) FILTER (WHERE l.assigned_at >= date_trunc('week', NOW()))::int AS assigned_this_week,
      COUNT(*) FILTER (WHERE l.assigned_at >= date_trunc('month', NOW()))::int AS assigned_this_month
    FROM leads l
    WHERE l.assigned_to_user_id = $1 AND l.deleted_at IS NULL
  `, [userId]);

  const { rows: [requests] } = await query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending')::int AS requests_pending,
      COUNT(*) FILTER (WHERE status IN ('approved','partially_fulfilled'))::int AS requests_approved,
      COUNT(*) FILTER (WHERE status = 'fulfilled')::int AS requests_fulfilled
    FROM lead_requests
    WHERE user_id = $1
  `, [userId]);

  const { rows: [history] } = await query(`
    SELECT
      COUNT(*) FILTER (WHERE previous_user_id = $1)::int AS reassigned_out_count,
      COUNT(*) FILTER (WHERE assigned_to_user_id = $1 AND previous_user_id IS NOT NULL)::int AS reassigned_in_count
    FROM lead_assignments
    WHERE previous_user_id = $1 OR assigned_to_user_id = $1
  `, [userId]).catch(() => ({ rows: [{ reassigned_out_count: 0, reassigned_in_count: 0 }] }));

  return { ...counts, ...requests, ...history };
}

async function getAdminMetrics(userId) {
  const [sessions = {}, audit = {}, email = {}] = await Promise.all([
    safeQuery(`
      SELECT COUNT(*)::int AS total_sessions,
             COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > NOW())::int AS active_sessions,
             MAX(COALESCE(last_activity_at, created_at)) AS last_session_activity
        FROM auth_sessions
       WHERE user_id = $1
    `, [userId], [{}]).then(rows => rows[0] || {}),
    safeQuery(`
      SELECT COUNT(*)::int AS total_admin_actions,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS actions_last_7_days,
             COUNT(*) FILTER (WHERE entity = 'meta')::int AS meta_actions,
             COUNT(*) FILTER (WHERE entity = 'user')::int AS user_management_actions,
             COUNT(*) FILTER (WHERE entity IN ('sheets','lead_ingestion','webhook'))::int AS integration_actions
        FROM activity_logs
       WHERE user_id = $1
    `, [userId], [{}]).then(rows => rows[0] || {}),
    safeQuery(`
      SELECT COUNT(*)::int AS total_emails,
             COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_emails,
             COUNT(*) FILTER (WHERE email_type = 'password_reset')::int AS password_reset_emails,
             COUNT(*) FILTER (WHERE email_type = 'new_user_onboarding')::int AS onboarding_emails,
             MAX(sent_at) AS last_email_sent_at
        FROM email_delivery_logs
       WHERE user_id = $1
    `, [userId], [{}]).then(rows => rows[0] || {}),
  ]);
  return { ...sessions, ...audit, ...email };
}

async function getRmMetrics(userId) {
  const { rows: [metrics] } = await query(`
    WITH team AS (
      SELECT id FROM users
       WHERE report_to_id = $1
         AND deleted_at IS NULL
         AND COALESCE(status, 'active') <> 'deleted'
         AND role = 'member'
    )
    SELECT
      (SELECT COUNT(*)::int FROM team) AS team_members_count,
      (SELECT COUNT(*)::int FROM users u JOIN team t ON t.id = u.id WHERE u.status = 'active') AS active_members,
      COUNT(l.id)::int AS team_assigned_leads,
      COUNT(l.id) FILTER (WHERE ${notWorkedLeadCondition('l')})::int AS team_pending_leads,
      COUNT(l.id) FILTER (WHERE ${workedLeadCondition('l')})::int AS team_worked_leads,
      COUNT(l.id) FILTER (WHERE l.call_status = 'converted')::int AS team_conversions,
      COUNT(l.id) FILTER (WHERE l.next_followup_at IS NOT NULL AND l.next_followup_at <= NOW())::int AS overdue_followups,
      (SELECT COUNT(*)::int FROM lead_requests lr JOIN team t ON t.id = lr.user_id WHERE lr.status = 'pending') AS requests_pending,
      (SELECT COUNT(*)::int FROM lead_requests lr JOIN team t ON t.id = lr.user_id WHERE lr.status IN ('approved','partially_fulfilled')) AS requests_approved,
      (SELECT COUNT(*)::int FROM lead_requests lr JOIN team t ON t.id = lr.user_id WHERE lr.status IN ('rejected','cancelled')) AS requests_rejected
    FROM leads l
    JOIN team t ON t.id = l.assigned_to_user_id
    WHERE l.deleted_at IS NULL
  `, [userId]);
  return metrics || {};
}

function tabsFor(type) {
  if (type === 'admin') return ['overview', 'security', 'admin_actions', 'email_history', 'activity', 'permissions'];
  if (type === 'rm') return ['overview', 'team_members', 'team_leads', 'requests', 'team_performance', 'activity', 'settings'];
  if (type === 'deleted') return ['overview', 'activity', 'email_history'];
  return ['leads', 'pending_leads', 'notes', 'requests', 'assignment_history', 'notifications', 'activity', 'settings'];
}

const BUSINESS_TIMEZONE = process.env.CRM_BUSINESS_TIMEZONE || 'Asia/Kolkata';

function businessDateToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function selectedDateOrToday(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return businessDateToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) throw new AppError(400, 'INVALID_DATE', 'selected_date must be YYYY-MM-DD');
  const parsed = new Date(`${candidate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) {
    throw new AppError(400, 'INVALID_DATE', 'selected_date must be YYYY-MM-DD');
  }
  const today = businessDateToday();
  if (candidate > today) throw new AppError(400, 'INVALID_DATE', 'selected_date cannot be in the future');
  return candidate;
}

function localDateSql(column) {
  return `(${column} AT TIME ZONE '${BUSINESS_TIMEZONE}')::date`;
}

function attemptStateSql(alias = 'ca') {
  return `CASE
    WHEN ${alias}.attempt_number = 1 AND ${alias}.status = 'completed' THEN 'initial_issue'
    WHEN ${alias}.status = 'completed' THEN 'completed'
    WHEN ${alias}.status = 'cancelled' THEN 'not_required'
    WHEN ${alias}.status = 'missed' OR (${alias}.status = 'scheduled' AND ${alias}.scheduled_at <= NOW() - make_interval(mins => ${ATTEMPT_GRACE_MINUTES})) THEN 'missed'
    WHEN ${alias}.status = 'scheduled' AND ${alias}.scheduled_at > NOW() THEN 'upcoming'
    ELSE 'not_required'
  END`;
}

function actionsFor(actor, user, type) {
  const isAdmin = ADMIN_ROLES.has(actor.role);
  if (!isAdmin || type === 'deleted') return [];
  const actions = ['edit_profile', 'send_reset_link', 'resend_onboarding_email'];
  if (user.role !== 'super_admin') {
    if (user.status === 'blocked') actions.push('unblock');
    else actions.push('block');
    actions.push('disable_delete');
  }
  if (type === 'admin') actions.push('force_logout_sessions', 'view_activity_logs');
  if (type === 'member') actions.push('change_rm', 'change_distribution_settings');
  if (type === 'rm') actions.push('edit_team_name');
  return actions;
}

async function getProfile(actor, userId) {
  await assertProfileAccess(actor, userId);
  const user = await getSanitizedUser(userId);
  const profileType = profileTypeFor(user);
  const counts = profileType === 'member' ? await getBasicCounts(userId) : {};
  const [reportees, adminMetrics, rmMetrics, security, emailHistory] = await Promise.all([
    safeQuery(`
    SELECT id, full_name, email, phone, role, member_type, status, team_name, is_available,
           lead_assignment_enabled, lead_assignment_status, lead_assignment_disabled_reason,
           lead_assignment_updated_at
     FROM users
     WHERE report_to_id = $1 AND deleted_at IS NULL AND COALESCE(is_hidden, FALSE) = FALSE
     ORDER BY full_name
  `, [userId]),
    profileType === 'admin' ? getAdminMetrics(userId) : Promise.resolve(null),
    profileType === 'rm' ? getRmMetrics(userId) : Promise.resolve(null),
    getSecurity(actor, userId),
    getEmailHistory(actor, userId, { limit: 5 }),
  ]);
  return {
    user,
    role: user.role,
    profileType,
    permissions: {
      canEdit: ADMIN_ROLES.has(actor.role) && profileType !== 'deleted',
      canManageLifecycle: ADMIN_ROLES.has(actor.role) && user.role !== 'super_admin' && profileType !== 'deleted',
      readOnly: profileType === 'deleted' || user.status === 'blocked',
    },
    tabs: tabsFor(profileType),
    actions: actionsFor(actor, user, profileType),
    counts,
    metrics: profileType === 'admin' ? adminMetrics : profileType === 'rm' ? rmMetrics : counts,
    reportees,
    security,
    emailHistory,
  };
}

async function getPerformance(actor, userId, opts = {}) {
  await assertProfileAccess(actor, userId);
  const { start, end } = rangeToDates(opts.range, opts.start_date, opts.end_date);
  const params = [userId, start, end];

  const { rows: [summary] } = await query(`
    SELECT
      COUNT(*)::int AS assigned,
      COUNT(*) FILTER (WHERE ${workedLeadCondition('l')})::int AS worked,
      COUNT(*) FILTER (WHERE ${notWorkedLeadCondition('l')})::int AS pending,
      COUNT(*) FILTER (WHERE call_status = 'converted')::int AS converted,
      ROUND(
        CASE WHEN COUNT(*) = 0 THEN 0
             ELSE COUNT(*) FILTER (WHERE call_status = 'converted')::numeric * 100 / COUNT(*) END,
        2
      ) AS conversion_rate,
      COUNT(*) FILTER (WHERE next_followup_at IS NOT NULL AND next_followup_at <= NOW())::int AS overdue_leads
    FROM leads l
    WHERE assigned_to_user_id = $1 AND deleted_at IS NULL
      AND assigned_at::date BETWEEN $2::date AND $3::date
  `, params);

  const { rows: dailyTrend } = await query(`
    WITH days AS (
      SELECT generate_series($2::date, $3::date, interval '1 day')::date AS day
    )
    SELECT d.day::text AS date,
           COUNT(l.id)::int AS assigned_count,
           COUNT(l.id) FILTER (WHERE ${workedLeadCondition('l')})::int AS worked_count,
           COUNT(l.id) FILTER (WHERE l.call_status = 'converted')::int AS converted_count,
           COUNT(r.id) FILTER (WHERE ${remarkHasFollowupActivityCondition('r')})::int AS followups_done
      FROM days d
      LEFT JOIN leads l ON l.assigned_to_user_id = $1
        AND l.deleted_at IS NULL
        AND l.assigned_at::date = d.day
      LEFT JOIN lead_remarks r ON r.user_id = $1
        AND r.created_at::date = d.day
     GROUP BY d.day
     ORDER BY d.day
  `, params);

  const { rows: callStatusBreakdown } = await query(`
    SELECT call_status AS status, COUNT(*)::int AS count
      FROM leads
     WHERE assigned_to_user_id = $1 AND deleted_at IS NULL
       AND assigned_at::date BETWEEN $2::date AND $3::date
     GROUP BY call_status
     ORDER BY count DESC
  `, params);

  const { rows: sourceBreakdown } = await query(`
    SELECT l.source, l.meta_form_id, mf.form_name, COUNT(*)::int AS count
      FROM leads l
      LEFT JOIN meta_forms mf ON mf.form_id = l.meta_form_id
     WHERE l.assigned_to_user_id = $1 AND l.deleted_at IS NULL
       AND l.assigned_at::date BETWEEN $2::date AND $3::date
     GROUP BY l.source, l.meta_form_id, mf.form_name
     ORDER BY count DESC
     LIMIT 20
  `, params);

  // Keep profile rank and score aligned with the live leaderboard instead of
  // depending on a daily snapshot that may not have been computed yet.
  const { rows: [ranking] } = await query(`
    WITH target AS (
      SELECT role::text AS role FROM users WHERE id = $1
    ), performance AS (
      SELECT
        u.id AS user_id,
        COALESCE(leads.total_leads, 0)::int AS total_leads,
        COALESCE(leads.converted_leads, 0)::int AS converted_leads,
        COALESCE(leads.completed_leads, 0)::int AS completed_leads,
        COALESCE(leads.contacted_leads, 0)::int AS contacted_leads,
        COALESCE(remarks.followups_done, 0)::int AS followups_done,
        COALESCE(calls.call_count, 0)::int AS call_count,
        CASE WHEN COALESCE(leads.total_leads, 0) > 0
          THEN ROUND(COALESCE(leads.converted_leads, 0)::numeric * 100 / leads.total_leads, 2)
          ELSE 0 END AS conversion_rate,
        (
          COALESCE(leads.converted_leads, 0) * 50
          + COALESCE(leads.completed_leads, 0) * 20
          + COALESCE(leads.contacted_leads, 0) * 10
          + COALESCE(remarks.followups_done, 0) * 5
          + COALESCE(calls.call_count, 0) * 2
          + CASE WHEN COALESCE(leads.total_leads, 0) > 0
              THEN ROUND(COALESCE(leads.converted_leads, 0)::numeric * 100 / leads.total_leads)
              ELSE 0 END
        )::numeric AS performance_score,
        u.full_name
      FROM users u
      CROSS JOIN target t
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS total_leads,
          COUNT(*) FILTER (WHERE l.call_status::text = 'converted' OR l.stage::text = 'won') AS converted_leads,
          COUNT(*) FILTER (WHERE l.stage::text IN ('won', 'lost', 'dropped') OR l.call_status::text IN ('converted', 'not_interested', 'wrong_number', 'invalid_number', 'ni')) AS completed_leads,
          COUNT(*) FILTER (WHERE l.last_call_at IS NOT NULL OR l.call_status::text NOT IN ('not_called', 'rnr', 'cnr', 'busy', 'switched_off', 'so', 'nc', 'ccb', 'nn')) AS contacted_leads
        FROM leads l
        WHERE l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
          AND l.assigned_at::date BETWEEN $2::date AND $3::date
      ) leads ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS call_count
        FROM lead_call_logs cl
        WHERE cl.user_id = u.id AND cl.created_at::date BETWEEN $2::date AND $3::date
      ) calls ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE ${remarkHasFollowupActivityCondition('lr')}) AS followups_done
        FROM lead_remarks lr
        WHERE lr.user_id = u.id AND lr.created_at::date BETWEEN $2::date AND $3::date
      ) remarks ON TRUE
      WHERE u.deleted_at IS NULL
        AND COALESCE(u.status::text, 'active') = 'active'
        AND u.role::text = t.role
        AND u.role::text IN ('member', 'partner')
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        ORDER BY performance_score DESC, converted_leads DESC, completed_leads DESC,
                 contacted_leads DESC, total_leads DESC, full_name ASC
      )::int AS rank_position,
      COUNT(*) OVER()::int AS total_ranked_users
      FROM performance
    )
    SELECT rank_position, total_ranked_users, performance_score AS score,
           total_leads AS leads_total, converted_leads AS leads_converted,
           completed_leads, contacted_leads, followups_done, call_count AS calls_made,
           conversion_rate AS conv_rate
    FROM ranked WHERE user_id = $1
  `, params).catch(() => ({ rows: [null] }));

  const { rows: [workload] } = await query(`
    SELECT
      COUNT(*) FILTER (WHERE ${notWorkedLeadCondition('l')})::int AS currently_pending,
      COUNT(*) FILTER (WHERE next_followup_at IS NOT NULL AND next_followup_at < NOW())::int AS overdue_leads,
      COUNT(*) FILTER (WHERE assigned_at < NOW() - INTERVAL '24 hours'
        AND ${notWorkedLeadCondition('l')})::int AS inactive_assigned_leads
    FROM leads l
    WHERE assigned_to_user_id = $1 AND deleted_at IS NULL
  `, [userId]);

  return {
    range: { start, end },
    summary: {
      ...summary,
      average_response_time: null,
      follow_up_completion_rate: null,
    },
    dailyTrend,
    callStatusBreakdown,
    sourceBreakdown,
    ranking: ranking || null,
    workload,
  };
}

async function getUserLeads(actor, userId, opts = {}) {
  await assertProfileAccess(actor, userId);
  const user = await getSanitizedUser(userId);
  const profileType = profileTypeFor(user);
  const page = Math.max(1, Number.parseInt(opts.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(opts.page_size || '25', 10)));
  const offset = (page - 1) * pageSize;
  const where = ['l.deleted_at IS NULL'];
  const params = [userId];

  // Daily monitoring is intentionally additive. The existing Leads/Pending Leads
  // callers keep their current-assignment semantics unless they opt into it.
  const monitoringDate = opts.monitoring === 'true' ? selectedDateOrToday(opts.selected_date) : null;
  if (monitoringDate && profileType === 'member') {
    params.push(monitoringDate);
    const dayParam = `$${params.length}::date`;
    const assignedOnDate = `EXISTS (SELECT 1 FROM lead_assignments la WHERE la.lead_id = l.id AND la.user_id = $1 AND ${localDateSql('la.assigned_at')} = ${dayParam})`;
    if (opts.monitoring_scope === 'assigned') {
      // This drill-down deliberately includes leads reassigned later so it exactly matches Daily Assigned.
      where.push(assignedOnDate);
    } else {
      where.push('l.assigned_to_user_id = $1');
      where.push(`(
        ${assignedOnDate}
        OR EXISTS (SELECT 1 FROM lead_remarks r WHERE r.lead_id = l.id AND r.user_id = $1 AND ${localDateSql('r.created_at')} = ${dayParam})
        OR EXISTS (SELECT 1 FROM lead_workflow_history h WHERE h.lead_id = l.id AND h.user_id = $1 AND ${localDateSql('h.created_at')} = ${dayParam})
        OR EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND COALESCE(ca.completed_by_user_id, ca.responsible_user_id) = $1 AND (${localDateSql('ca.scheduled_at')} = ${dayParam} OR ${localDateSql('ca.attempted_at')} = ${dayParam}))
        OR EXISTS (SELECT 1 FROM customer_notes pm WHERE pm.lead_id = l.id AND pm.note_kind = 'personal_meeting' AND pm.deleted_at IS NULL AND pm.counselor_user_id = $1 AND ${localDateSql('pm.created_at')} = ${dayParam})
      )`);
    }
  } else {
    where.push(profileType === 'rm'
      ? 'l.assigned_to_user_id IN (SELECT id FROM users WHERE report_to_id = $1)'
      : 'l.assigned_to_user_id = $1');
  }

  const requestedIssue = String(opts.call_issue || '').trim().toLowerCase();
  if (requestedIssue === 'call_issues') {
    where.push(`l.call_status::text = ANY(ARRAY[${RETRYABLE_CONTACT_ISSUES.map(status => `'${status}'`).join(', ')}]::text[])`);
  } else if (requestedIssue && RETRYABLE_CONTACT_ISSUES.includes(requestedIssue)) {
    where.push(`l.call_status::text = '${requestedIssue}'`);
  } else if (opts.call_status) { params.push(opts.call_status); where.push(`l.call_status = $${params.length}`); }
  if (opts.status) { params.push(opts.status); where.push(`l.stage = $${params.length}`); }
  if (opts.source) { params.push(opts.source); where.push(`l.source = $${params.length}`); }
  if (opts.pending === 'true') where.push(`${notWorkedLeadCondition('l')}`);
  if (opts.assigned_from) { params.push(opts.assigned_from); where.push(`l.assigned_at >= $${params.length}`); }
  if (opts.assigned_to) { params.push(opts.assigned_to); where.push(`l.assigned_at <= $${params.length}`); }
  if (opts.search) {
    params.push(`%${String(opts.search).trim()}%`);
    where.push(`(l.full_name ILIKE $${params.length} OR l.phone ILIKE $${params.length} OR l.email ILIKE $${params.length})`);
  }

  const whereSql = where.join(' AND ');
  const { rows: [{ total }] } = await query(`SELECT COUNT(*)::int AS total FROM leads l WHERE ${whereSql}`, params);

  let callIssueFilters = null;
  if (monitoringDate && profileType === 'member') {
    const baseWhereSql = where.filter(clause => !clause.includes('l.call_status::text =')).join(' AND ');
    const { rows: [{ all_count }] } = await query(`SELECT COUNT(DISTINCT l.id)::int AS all_count FROM leads l WHERE ${baseWhereSql}`, params);
    const { rows: issueRows } = await query(`
      SELECT l.call_status::text AS status, COUNT(DISTINCT l.id)::int AS count
        FROM leads l
       WHERE ${baseWhereSql}
         AND l.call_status::text = ANY(ARRAY[${RETRYABLE_CONTACT_ISSUES.map(status => `'${status}'`).join(', ')}]::text[])
       GROUP BY l.call_status
    `, params);
    const counts = new Map(issueRows.map(row => [row.status, Number(row.count || 0)]));
    const allCount = Number(all_count || 0);
    const issueCount = [...counts.values()].reduce((sum, count) => sum + count, 0);
    callIssueFilters = [
      { key: 'all', label: 'All', count: allCount },
      { key: 'call_issues', label: 'Call Issues', count: issueCount },
      ...RETRYABLE_CONTACT_ISSUES.map(key => ({ key, label: CALL_ISSUE_LABELS[key] || key, count: counts.get(key) || 0 })),
    ];
  }

  params.push(pageSize, offset);
  const { rows } = await query(`
    SELECT l.id, l.full_name, l.phone, l.email, l.source, l.category, l.category_source, l.meta_form_id,
           mf.form_name, l.campaign_name, l.campaign_label, l.assigned_at,
           l.call_status, l.stage, l.is_pending, l.next_followup_at,
           l.created_at,
           COALESCE(next_attempt.next_scheduled_at, l.next_followup_at) AS next_action_at,
           GREATEST(l.updated_at, COALESCE((SELECT MAX(created_at) FROM lead_remarks r WHERE r.lead_id = l.id), l.updated_at)) AS last_activity_at
      FROM leads l
      LEFT JOIN meta_forms mf ON mf.form_id = l.meta_form_id
      LEFT JOIN LATERAL (
        SELECT MIN(ca.scheduled_at) AS next_scheduled_at
          FROM lead_call_attempts ca
          JOIN lead_call_attempt_sequences seq ON seq.id = ca.sequence_id AND seq.status = 'active'
         WHERE ca.lead_id = l.id AND ca.status = 'scheduled'
      ) next_attempt ON TRUE
     WHERE ${whereSql}
     ORDER BY l.${opts.sort === 'created_at' ? 'created_at' : 'assigned_at'} DESC NULLS LAST
     LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  if (monitoringDate && rows.length) {
    const leadIds = rows.map(row => row.id);
    const { rows: attempts } = await query(`
      SELECT ca.lead_id, ca.attempt_number, ca.status, ca.outcome, ca.scheduled_at, ca.attempted_at,
             ca.delay_minutes, ca.is_final_attempt, ca.completed_by_user_id, ca.responsible_user_id,
             completed_by.full_name AS completed_by_name, responsible.full_name AS responsible_name,
             ${attemptStateSql('ca')} AS attempt_state
        FROM lead_call_attempts ca
        JOIN lead_call_attempt_sequences seq ON seq.id = ca.sequence_id AND seq.status = 'active'
        LEFT JOIN users completed_by ON completed_by.id = ca.completed_by_user_id
        LEFT JOIN users responsible ON responsible.id = ca.responsible_user_id
       WHERE ca.lead_id = ANY($1::uuid[])
       ORDER BY ca.lead_id, ca.attempt_number
    `, [leadIds]);
    const byLead = new Map();
    attempts.forEach(attempt => {
      const current = byLead.get(attempt.lead_id) || [];
      current.push(attempt);
      byLead.set(attempt.lead_id, current);
    });
    rows.forEach(row => {
      row.attempts = byLead.get(row.id) || [];
      row.attempt_tracking = row.attempts.length ? 'tracked' : 'none';
    });
  }
  return { rows, total, page, pageSize, call_issue_filters: callIssueFilters, selected_date: monitoringDate };
}

async function getDailyLeadMonitoringSummary(actor, userId, opts = {}) {
  await assertProfileAccess(actor, userId);
  const user = await getSanitizedUser(userId);
  if (profileTypeFor(user) !== 'member') {
    return { selected_date: selectedDateOrToday(opts.selected_date), assigned: 0, worked: 0, pending: 0, call_issues: 0, attempts_completed: 0, attempts_missed: 0, personal_meeting_leads: 0, converted: 0 };
  }
  const selectedDate = selectedDateOrToday(opts.selected_date);
  const params = [userId, selectedDate];
  const date = '$2::date';
  const assignmentToday = `EXISTS (SELECT 1 FROM lead_assignments la WHERE la.lead_id = l.id AND la.user_id = $1 AND ${localDateSql('la.assigned_at')} = ${date})`;
  const actionToday = `(
    EXISTS (SELECT 1 FROM lead_remarks r WHERE r.lead_id = l.id AND r.user_id = $1 AND ${localDateSql('r.created_at')} = ${date})
    OR EXISTS (SELECT 1 FROM lead_workflow_history h WHERE h.lead_id = l.id AND h.user_id = $1 AND ${localDateSql('h.created_at')} = ${date})
    OR EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND COALESCE(ca.completed_by_user_id, ca.responsible_user_id) = $1 AND ca.status = 'completed' AND ${localDateSql('COALESCE(ca.attempted_at, ca.created_at)')} = ${date})
    OR EXISTS (SELECT 1 FROM customer_notes pm WHERE pm.lead_id = l.id AND pm.note_kind = 'personal_meeting' AND pm.deleted_at IS NULL AND pm.counselor_user_id = $1 AND ${localDateSql('pm.created_at')} = ${date})
  )`;
  const dailyScope = `(${assignmentToday} OR ${actionToday} OR EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.responsible_user_id = $1 AND ${localDateSql('ca.scheduled_at')} = ${date}))`;
  const retryableSql = `ARRAY[${RETRYABLE_CONTACT_ISSUES.map(status => `'${status}'`).join(', ')}]::text[]`;
  const { rows: [summary] } = await query(`
    SELECT
      COUNT(DISTINCT l.id) FILTER (WHERE ${assignmentToday})::int AS assigned,
      COUNT(DISTINCT l.id) FILTER (WHERE ${actionToday})::int AS worked,
      COUNT(DISTINCT l.id) FILTER (WHERE l.assigned_to_user_id = $1 AND ${dailyScope} AND (
        (${assignmentToday} AND NOT ${actionToday})
        OR EXISTS (SELECT 1 FROM lead_remarks r WHERE r.lead_id = l.id AND r.user_id = $1 AND r.next_followup_at IS NOT NULL AND ${localDateSql('r.next_followup_at')} = ${date})
        OR EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.responsible_user_id = $1 AND ca.attempt_number > 1 AND ca.status IN ('scheduled', 'missed') AND ${localDateSql('ca.scheduled_at')} = ${date})
      ))::int AS pending,
      COUNT(DISTINCT l.id) FILTER (WHERE l.assigned_to_user_id = $1 AND ${dailyScope} AND l.call_status::text = ANY(${retryableSql}))::int AS call_issues,
      (SELECT COUNT(*)::int FROM lead_call_attempts ca WHERE ca.completed_by_user_id = $1 AND ca.attempt_number > 1 AND ca.status = 'completed' AND ${localDateSql('COALESCE(ca.attempted_at, ca.created_at)')} = ${date}) AS attempts_completed,
      (SELECT COUNT(*)::int FROM lead_call_attempts ca WHERE ca.responsible_user_id = $1 AND ca.attempt_number > 1 AND (${attemptStateSql('ca')} = 'missed') AND ${localDateSql('ca.scheduled_at')} = ${date}) AS attempts_missed,
      COUNT(DISTINCT l.id) FILTER (WHERE EXISTS (SELECT 1 FROM customer_notes pm WHERE pm.lead_id = l.id AND pm.note_kind = 'personal_meeting' AND pm.deleted_at IS NULL AND pm.counselor_user_id = $1 AND ${localDateSql('pm.created_at')} = ${date}))::int AS personal_meeting_leads,
      COUNT(DISTINCT l.id) FILTER (WHERE EXISTS (SELECT 1 FROM lead_remarks r WHERE r.lead_id = l.id AND r.user_id = $1 AND r.call_status::text = 'converted' AND ${localDateSql('r.created_at')} = ${date}) OR EXISTS (SELECT 1 FROM lead_workflow_history h WHERE h.lead_id = l.id AND h.user_id = $1 AND h.new_value::text = 'converted' AND ${localDateSql('h.created_at')} = ${date}))::int AS converted
    FROM leads l
    WHERE l.deleted_at IS NULL
  `, params);
  return { selected_date: selectedDate, ...summary };
}

async function takeBackPendingLeads(actor, userId, input = {}) {
  if (!actor || !ADMIN_ROLES.has(actor.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Only admins can take back pending leads');
  }

  const user = await getSanitizedUser(userId);
  const profileType = profileTypeFor(user);
  if (profileType !== 'member') {
    throw new AppError(400, 'INVALID_TARGET', 'Pending lead take-back is available only for member/partner profiles');
  }

  const requested = Number.parseInt(String(input.quantity || ''), 10);
  if (!Number.isFinite(requested) || requested < 1) {
    throw new AppError(400, 'INVALID_QUANTITY', 'Enter a valid take-back quantity');
  }

  const reason = String(input.reason || '').trim() || 'Taken back from member profile by admin';

  const eligibleRows = await query(
    `SELECT l.id
       FROM leads l
      WHERE l.assigned_to_user_id = $1
        AND l.deleted_at IS NULL
        AND ${notWorkedLeadCondition('l')}
      ORDER BY l.assigned_at DESC NULLS LAST, l.created_at DESC NULLS LAST, l.id DESC
      LIMIT $2`,
    [userId, requested],
  );

  const eligibleLeadIds = eligibleRows.rows.map(row => row.id).filter(Boolean);

  if (!eligibleLeadIds.length) {
    const counts = await getBasicCounts(userId);
    return {
      requested,
      affected: 0,
      available: Number(counts.pending_leads || 0),
      skipped: requested,
      remaining_pending: Number(counts.pending_leads || 0),
      lead_ids: [],
      reason,
    };
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE lead_assignments
          SET unassigned_at = NOW()
        WHERE lead_id = ANY($1::uuid[])
          AND unassigned_at IS NULL`,
      [eligibleLeadIds],
    );

    await client.query(
      `UPDATE leads
          SET assigned_to_user_id = NULL,
              assigned_at = NULL,
              locked_by_user_id = NULL,
              locked_until = NULL,
              updated_at = NOW()
        WHERE id = ANY($1::uuid[])
          AND deleted_at IS NULL`,
      [eligibleLeadIds],
    );

    await client.query(
      `INSERT INTO activity_logs (user_id, entity, entity_id, action, metadata, ip_address, created_at)
       VALUES ($1, 'user', $2, 'take_back_pending_leads', $3::jsonb, NULL, NOW())`,
      [
        actor.id,
        userId,
        JSON.stringify({
          target_user_id: userId,
          target_user_name: user.full_name,
          requested,
          affected: eligibleLeadIds.length,
          lead_ids: eligibleLeadIds.slice(0, 25),
          reason,
        }),
      ],
    ).catch(() => null);
  });

  const counts = await getBasicCounts(userId);
  return {
    requested,
    affected: eligibleLeadIds.length,
    available: Number(counts.pending_leads || 0) + eligibleLeadIds.length,
    skipped: Math.max(0, requested - eligibleLeadIds.length),
    remaining_pending: Number(counts.pending_leads || 0),
    lead_ids: eligibleLeadIds,
    reason,
  };
}

async function getRequests(actor, userId) {
  await assertProfileAccess(actor, userId);
  const user = await getSanitizedUser(userId);
  if (profileTypeFor(user) === 'rm') {
    const { rows } = await query(`
      SELECT lr.id, 'member' AS request_type, lr.quantity AS requested_quantity,
             lr.approved_quantity, COALESCE(lr.fulfilled_quantity, lr.leads_assigned, 0) AS fulfilled_quantity,
             GREATEST(COALESCE(lr.approved_quantity, lr.quantity) - COALESCE(lr.fulfilled_quantity, lr.leads_assigned, 0), 0) AS remaining_quantity,
             lr.status, lr.created_at AS requested_at, lr.approved_by, lr.approved_at,
             lr.note, lr.admin_notes
        FROM lead_requests lr
        JOIN users u ON u.id = lr.user_id
       WHERE u.report_to_id = $1
      UNION ALL
      SELECT id, 'rm' AS request_type, quantity AS requested_quantity,
             quantity AS approved_quantity, fulfilled_count AS fulfilled_quantity,
             GREATEST(quantity - fulfilled_count, 0) AS remaining_quantity,
             status, created_at AS requested_at, NULL::uuid AS approved_by,
             NULL::timestamptz AS approved_at, note, NULL::text AS admin_notes
        FROM rm_lead_requests
       WHERE rm_id = $1
       ORDER BY requested_at DESC
       LIMIT 100
    `, [userId]);
    return rows;
  }
  const { rows } = await query(`
    SELECT id, 'member' AS request_type, quantity AS requested_quantity,
           approved_quantity, COALESCE(fulfilled_quantity, leads_assigned, 0) AS fulfilled_quantity,
           GREATEST(COALESCE(approved_quantity, quantity) - COALESCE(fulfilled_quantity, leads_assigned, 0), 0) AS remaining_quantity,
           status, created_at AS requested_at, approved_by, approved_at, note, admin_notes
      FROM lead_requests WHERE user_id = $1
    UNION ALL
    SELECT id, 'rm' AS request_type, quantity AS requested_quantity,
           quantity AS approved_quantity, fulfilled_count AS fulfilled_quantity,
           GREATEST(quantity - fulfilled_count, 0) AS remaining_quantity,
           status, created_at AS requested_at, NULL::uuid AS approved_by, NULL::timestamptz AS approved_at, note, NULL::text AS admin_notes
      FROM rm_lead_requests WHERE rm_id = $1
    UNION ALL
    SELECT id, 'partner' AS request_type, quantity AS requested_quantity,
           quantity AS approved_quantity, leads_assigned AS fulfilled_quantity,
           GREATEST(quantity - leads_assigned, 0) AS remaining_quantity,
           status, created_at AS requested_at, resolved_by AS approved_by, resolved_at AS approved_at, note, resolve_note AS admin_notes
      FROM partner_lead_requests WHERE partner_id = $1
    ORDER BY requested_at DESC
    LIMIT 100
  `, [userId]);
  return rows;
}

async function getAssignmentHistory(actor, userId, opts = {}) {
  await assertProfileAccess(actor, userId);
  const user = await getSanitizedUser(userId);
  const profileType = profileTypeFor(user);
  const params = [userId];
  let scopeSql = `(COALESCE(la.assigned_to_user_id, la.user_id) = $1 OR la.previous_user_id = $1)`;
  if (profileType === 'admin') {
    scopeSql = `COALESCE(la.assigned_by_user_id, la.assigned_by) = $1`;
  } else if (profileType === 'rm') {
    scopeSql = `(
      COALESCE(la.assigned_to_user_id, la.user_id) IN (SELECT id FROM users WHERE report_to_id = $1)
      OR la.previous_user_id IN (SELECT id FROM users WHERE report_to_id = $1)
      OR COALESCE(la.assigned_by_user_id, la.assigned_by) = $1
    )`;
  }
  const where = [scopeSql];
  if (opts.direction === 'in') where.push(`COALESCE(la.assigned_to_user_id, la.user_id) = $1`);
  if (opts.direction === 'out') where.push(`la.previous_user_id = $1`);
  if (opts.type && opts.type !== 'all') {
    params.push(opts.type);
    where.push(`COALESCE(la.assignment_type, la.reason) = $${params.length}`);
  }
  if (opts.date_from) {
    params.push(opts.date_from);
    where.push(`COALESCE(la.created_at, la.assigned_at) >= $${params.length}`);
  }
  if (opts.date_to) {
    params.push(opts.date_to);
    where.push(`COALESCE(la.created_at, la.assigned_at) <= $${params.length}`);
  }
  if (opts.search) {
    params.push(`%${String(opts.search).trim()}%`);
    where.push(`(l.full_name ILIKE $${params.length} OR l.phone ILIKE $${params.length} OR l.campaign_name ILIKE $${params.length})`);
  }
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(opts.page_size || '50', 10)));
  const page = Math.max(1, Number.parseInt(opts.page || '1', 10));
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(`
    SELECT la.id, la.lead_id, l.full_name AS lead_name, l.campaign_name, l.source, l.category, l.category_source,
           l.meta_form_id, mf.form_name,
           COALESCE(la.assignment_type, la.reason) AS assignment_type,
           prev.full_name AS previous_user,
           assigned.full_name AS assigned_to,
           byu.full_name AS assigned_by,
           la.reason,
           COALESCE(la.created_at, la.assigned_at) AS created_at
      FROM lead_assignments la
      LEFT JOIN leads l ON l.id = la.lead_id
      LEFT JOIN meta_forms mf ON mf.form_id = l.meta_form_id
      LEFT JOIN users prev ON prev.id = la.previous_user_id
      LEFT JOIN users assigned ON assigned.id = COALESCE(la.assigned_to_user_id, la.user_id)
      LEFT JOIN users byu ON byu.id = COALESCE(la.assigned_by_user_id, la.assigned_by)
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(la.created_at, la.assigned_at) DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);
  return rows;
}

async function getActivity(actor, userId) {
  await assertProfileAccess(actor, userId);
  const user = await getSanitizedUser(userId);
  const profileType = profileTypeFor(user);
  if (profileType === 'admin') {
    return safeQuery(`
      SELECT 'activity_log' AS source, entity, entity_id, action, metadata, created_at
        FROM activity_logs
       WHERE user_id = $1
      UNION ALL
      SELECT 'audit_log' AS source, entity, entity_id::text, action, metadata, created_at
        FROM audit_logs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100
    `, [userId]);
  }
  const userScope = profileType === 'rm'
    ? `(user_id = $1 OR user_id IN (SELECT id FROM users WHERE report_to_id = $1))`
    : 'user_id = $1';
  const { rows } = await query(`
    SELECT 'activity_log' AS source, entity, entity_id, action, metadata, created_at
      FROM activity_logs
     WHERE ${userScope}
    UNION ALL
    SELECT 'lead_remark' AS source, 'lead' AS entity, lead_id::text AS entity_id,
           COALESCE(call_status::text, 'remark') AS action,
           jsonb_build_object('remark', remark) AS metadata,
           created_at
      FROM lead_remarks
     WHERE ${userScope}
    UNION ALL
    SELECT 'chat_message' AS source, 'chat' AS entity, conversation_id::text AS entity_id,
           message_type AS action,
           jsonb_build_object('body', LEFT(body, 160)) AS metadata,
           created_at
      FROM chat_messages
     WHERE ${userScope.replaceAll('user_id', 'sender_id')}
     ORDER BY created_at DESC
     LIMIT 100
  `, [userId]).catch(async () => {
    const fallback = await query(`
      SELECT 'lead_remark' AS source, 'lead' AS entity, lead_id::text AS entity_id,
             COALESCE(call_status::text, 'remark') AS action,
             jsonb_build_object('remark', remark) AS metadata,
             created_at
        FROM lead_remarks
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100
    `, [userId]);
    return fallback;
  });
  return rows;
}

async function getEmailHistory(actor, userId, opts = {}) {
  await assertProfileAccess(actor, userId);
  const limit = Math.min(100, Math.max(1, Number.parseInt(opts.limit || '50', 10)));
  return safeQuery(`
    SELECT id, email_to, email_type, provider, status, error_message, created_at, sent_at, metadata
      FROM email_delivery_logs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2
  `, [userId, limit]);
}

async function getSecurity(actor, userId) {
  await assertProfileAccess(actor, userId);
  const [summary = {}, sessions] = await Promise.all([
    safeQuery(`
      SELECT COUNT(*)::int AS total_sessions,
             COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > NOW())::int AS active_sessions,
             MAX(created_at) AS last_session_created_at,
             MAX(COALESCE(last_activity_at, created_at)) AS last_activity_at
        FROM auth_sessions
       WHERE user_id = $1
    `, [userId], [{}]).then(rows => rows[0] || {}),
    safeQuery(`
      SELECT id, user_agent, ip_address::text, created_at, expires_at, revoked_at,
             COALESCE(last_activity_at, created_at) AS last_activity_at
        FROM auth_sessions
       WHERE user_id = $1
       ORDER BY COALESCE(last_activity_at, created_at) DESC
       LIMIT 20
    `, [userId]),
  ]);
  return { summary, sessions };
}

async function forceLogoutSessions(actor, userId) {
  if (!actor || !ADMIN_ROLES.has(actor.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Only administrators can revoke user sessions');
  }
  await getSanitizedUser(userId);
  const result = await query(
    `UPDATE auth_sessions
        SET revoked_at = NOW()
      WHERE user_id = $1
        AND revoked_at IS NULL`,
    [userId],
  );
  await safeQuery(`
    INSERT INTO activity_logs(user_id, user_name, user_role, entity, entity_id, action, metadata)
    VALUES($1, $2, $3, 'user', $4, 'force_logout_sessions', $5::jsonb)
  `, [
    actor.id,
    actor.full_name || actor.name || null,
    actor.role,
    userId,
    JSON.stringify({ target_user_id: userId, revoked_sessions: result.rowCount || 0 }),
  ]);
  return { revoked_sessions: result.rowCount || 0 };
}

async function updateProfile(actor, userId, body) {
  await assertProfileAccess(actor, userId, { edit: true });
  assertCpIdNotEditable(body);
  if (body.role === 'partner') throw new AppError(400, 'PARTNER_ROLE_DEPRECATED', 'Partner users are now members.');
  const { rows: [current] } = await query(
    `SELECT role, report_to_id, team_name
       FROM users
      WHERE id = $1 AND deleted_at IS NULL AND COALESCE(is_hidden, FALSE) = FALSE`,
    [userId],
  );
  if (!current) throw new AppError(404, 'NOT_FOUND', 'User not found');
  const nextRole = Object.prototype.hasOwnProperty.call(body, 'role') ? normalizeRole(body.role) : null;
  const effectiveRole = nextRole || normalizeRole(current.role);
  const effectiveReportTo = Object.prototype.hasOwnProperty.call(body, 'report_to_id') ? body.report_to_id : current.report_to_id;
  let rmForMember = null;
  if (effectiveRole === 'rm' && !String(Object.prototype.hasOwnProperty.call(body, 'team_name') ? body.team_name : current.team_name || '').trim()) {
    throw new AppError(400, 'TEAM_NAME_REQUIRED', 'RM must have a team name.');
  }
  if (effectiveRole === 'member') {
    if (!effectiveReportTo) throw new AppError(400, 'REPORTING_RM_REQUIRED', 'Member must report to an RM.');
    const { rows: [rm] } = await query(
      `SELECT id, team_name FROM users
        WHERE id = $1 AND role = 'rm' AND status = 'active' AND deleted_at IS NULL`,
      [effectiveReportTo],
    );
    if (!rm) throw new AppError(400, 'INVALID_REPORTING_RM', 'Member must report to an active RM.');
    rmForMember = rm;
  }
  const requestedAvailabilityChange = Object.prototype.hasOwnProperty.call(body, 'is_available')
    ? body.is_available
    : undefined;
  const allowed = ['full_name', 'email', 'phone', 'role', 'report_to_id', 'team_name'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      let value = body[key] || null;
      if (key === 'email' && value) value = String(value).trim().toLowerCase();
      if (key === 'role' && value) value = normalizeRole(value);
      if (key === 'report_to_id' && effectiveRole === 'rm') value = null;
      if (key === 'report_to_id' && effectiveRole === 'member') value = rmForMember.id;
      if (key === 'team_name' && effectiveRole === 'member') value = rmForMember.team_name || null;
      params.push(value);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (effectiveRole === 'rm' && !Object.prototype.hasOwnProperty.call(body, 'report_to_id')) {
    params.push(null);
    sets.push(`report_to_id = $${params.length}`);
  }
  if (effectiveRole === 'member' && !Object.prototype.hasOwnProperty.call(body, 'team_name')) {
    params.push(rmForMember.team_name || null);
    sets.push(`team_name = $${params.length}`);
  }
  if (sets.length) {
    params.push(userId);
    const { rows: [updated] } = await query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length}
          AND deleted_at IS NULL
          AND COALESCE(is_hidden, FALSE) = FALSE
          AND COALESCE(is_protected, FALSE) = FALSE
        RETURNING id`,
      params,
    );
    if (!updated) throw new AppError(404, 'NOT_FOUND', 'User not found or protected');
  }
  if (requestedAvailabilityChange !== undefined && ['rm', 'member', 'partner'].includes(effectiveRole)) {
    await updateSingleLeadAvailability({
      actor,
      userId,
      isAvailable: requestedAvailabilityChange,
      reason: null,
    });
  }
  return getProfile(actor, userId);
}

module.exports = {
  getProfile,
  getPerformance,
  getUserLeads,
  getDailyLeadMonitoringSummary,
  takeBackPendingLeads,
  getRequests,
  getAssignmentHistory,
  getActivity,
  getEmailHistory,
  getSecurity,
  forceLogoutSessions,
  updateProfile,
};
