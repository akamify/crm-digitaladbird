const { query } = require('../config/database');
const {
  RETRYABLE_CONTACT_ISSUES, TERMINAL_LEAD_QUALITY_ISSUES, CONTACTED_STATUSES,
  PROGRESSION_STATUSES, UNWORKED_SLA_HOURS, CALL_ISSUE_LABELS, sqlArray, calculateQuality,
} = require('../constants/counselorReportOptions');

const IST = 'Asia/Kolkata';
const RETRYABLE_SQL = sqlArray(RETRYABLE_CONTACT_ISSUES);
const TERMINAL_SQL = sqlArray(TERMINAL_LEAD_QUALITY_ISSUES);
const CONTACTED_SQL = sqlArray(CONTACTED_STATUSES);
const PROGRESSION_SQL = sqlArray(PROGRESSION_STATUSES);

function dateBounds(input = {}) {
  const from = String(input.from || '').trim() || null;
  const to = String(input.to || '').trim() || null;
  return { from, to };
}

function addLeadFilters(input, params, alias = 'l') {
  const clauses = [`${alias}.deleted_at IS NULL`];
  const add = (value, sql) => { if (value) { params.push(value); clauses.push(sql(params.length)); } };
  add(input.source, n => `${alias}.source::text = $${n}`);
  add(input.category, n => `${alias}.category = $${n}`);
  add(input.stage, n => `${alias}.stage::text = $${n}`);
  add(input.campaign, n => `(${alias}.campaign_name ILIKE '%' || $${n} || '%' OR ${alias}.campaign_label ILIKE '%' || $${n} || '%')`);
  return clauses.join(' AND ');
}

function buildQuery(input = {}) {
  const params = [];
  const { from, to } = dateBounds(input);
  if (from) params.push(from);
  const fromIndex = from ? params.length : null;
  if (to) params.push(to);
  const toIndex = to ? params.length : null;
  const leadFilters = addLeadFilters(input, params, 'l');
  // The cohort reads from the ownership CTE, not lead_assignments directly.
  const cohortDate = [fromIndex && `o.ownership_start >= $${fromIndex}::timestamptz`, toIndex && `o.ownership_start < ($${toIndex}::date + INTERVAL '1 day')`].filter(Boolean).join(' AND ') || 'TRUE';
  const currentDate = [fromIndex && `l.assigned_at >= $${fromIndex}::timestamptz`, toIndex && `l.assigned_at < ($${toIndex}::date + INTERVAL '1 day')`].filter(Boolean).join(' AND ') || 'TRUE';
  const userFilters = [];
  if (input.counselor || input.counselor_id) { params.push(input.counselor || input.counselor_id); userFilters.push(`u.id = $${params.length}::uuid`); }
  if (input.rm || input.rm_id) { params.push(input.rm || input.rm_id); userFilters.push(`u.report_to_id = $${params.length}::uuid`); }
  if (input.team) { params.push(input.team); userFilters.push(`u.team_name = $${params.length}`); }

  return {
    params,
    sql: `
      WITH ownership AS (
        SELECT a.lead_id, COALESCE(a.assigned_to_user_id, a.user_id) AS counselor_id,
               a.assigned_at AS ownership_start,
               COALESCE(a.unassigned_at, LEAD(a.assigned_at) OVER (PARTITION BY a.lead_id ORDER BY a.assigned_at, a.id), 'infinity'::timestamptz) AS ownership_end
          FROM lead_assignments a
         WHERE COALESCE(a.assigned_to_user_id, a.user_id) IS NOT NULL
      ), cohort AS (
        SELECT DISTINCT ON (o.counselor_id, o.lead_id)
               o.lead_id, o.counselor_id, o.ownership_start, o.ownership_end
          FROM ownership o JOIN leads l ON l.id = o.lead_id
         WHERE ${cohortDate} AND ${leadFilters}
         ORDER BY o.counselor_id, o.lead_id, o.ownership_start DESC
      ), attributed AS (
        SELECT c.*,
          EXISTS (SELECT 1 FROM lead_remarks r WHERE r.lead_id = c.lead_id AND r.user_id = c.counselor_id AND r.created_at >= c.ownership_start AND r.created_at < c.ownership_end) OR
          EXISTS (SELECT 1 FROM lead_workflow_history h WHERE h.lead_id = c.lead_id AND h.user_id = c.counselor_id AND h.created_at >= c.ownership_start AND h.created_at < c.ownership_end) OR
          EXISTS (SELECT 1 FROM lead_call_logs cl WHERE cl.lead_id = c.lead_id AND cl.user_id = c.counselor_id AND cl.created_at >= c.ownership_start AND cl.created_at < c.ownership_end) OR
          EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = c.lead_id AND COALESCE(ca.completed_by_user_id, ca.responsible_user_id) = c.counselor_id AND COALESCE(ca.attempted_at, ca.created_at) >= c.ownership_start AND COALESCE(ca.attempted_at, ca.created_at) < c.ownership_end) OR
          EXISTS (SELECT 1 FROM customer_notes pm WHERE pm.lead_id = c.lead_id AND pm.note_kind = 'personal_meeting' AND pm.deleted_at IS NULL AND pm.counselor_user_id = c.counselor_id AND pm.created_at >= c.ownership_start AND pm.created_at < c.ownership_end) AS worked,
          EXISTS (SELECT 1 FROM lead_remarks r WHERE r.lead_id = c.lead_id AND r.user_id = c.counselor_id AND r.created_at >= c.ownership_start AND r.created_at < c.ownership_end AND r.call_status::text = ANY(${CONTACTED_SQL})) OR
          EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = c.lead_id AND ca.completed_by_user_id = c.counselor_id AND ca.attempted_at >= c.ownership_start AND ca.attempted_at < c.ownership_end AND ca.outcome = 'call_received') AS contacted,
          EXISTS (SELECT 1 FROM lead_remarks r WHERE r.lead_id = c.lead_id AND r.user_id = c.counselor_id AND r.created_at >= c.ownership_start AND r.created_at < c.ownership_end AND r.call_status::text = ANY(${PROGRESSION_SQL})) OR
          EXISTS (SELECT 1 FROM customer_notes pm WHERE pm.lead_id = c.lead_id AND pm.note_kind = 'personal_meeting' AND pm.deleted_at IS NULL AND pm.counselor_user_id = c.counselor_id AND pm.created_at >= c.ownership_start AND pm.created_at < c.ownership_end) AS progressed,
          EXISTS (SELECT 1 FROM lead_remarks r WHERE r.lead_id = c.lead_id AND r.user_id = c.counselor_id AND r.created_at >= c.ownership_start AND r.created_at < c.ownership_end AND r.call_status::text = ANY(${TERMINAL_SQL})) AS terminal_quality_attributed,
          EXISTS (SELECT 1 FROM customer_notes pm WHERE pm.lead_id = c.lead_id AND pm.note_kind = 'personal_meeting' AND pm.deleted_at IS NULL AND pm.counselor_user_id = c.counselor_id AND pm.created_at >= c.ownership_start AND pm.created_at < c.ownership_end) AS personal_meeting
        FROM cohort c
      ), current_portfolio AS (
        SELECT l.id AS lead_id, l.assigned_to_user_id AS counselor_id, l.call_status::text AS current_status,
               l.assigned_at, l.next_followup_at,
               EXISTS (SELECT 1 FROM lead_workflow wf WHERE wf.lead_id = l.id AND COALESCE(wf.remark_status::text, '') = ANY(${CONTACTED_SQL})) OR
               EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.status = 'completed' AND ca.outcome = 'call_received') AS has_contact,
               EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.status = 'scheduled' AND ca.scheduled_at <= NOW()) AS due_attempt,
               EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.status = 'scheduled' AND ca.scheduled_at > NOW()) AS upcoming_attempt,
               EXISTS (SELECT 1 FROM customer_notes pm WHERE pm.lead_id = l.id AND pm.note_kind = 'personal_meeting' AND pm.deleted_at IS NULL AND pm.next_meeting_at <= NOW()) AS due_meeting
          FROM leads l WHERE ${leadFilters} AND ${currentDate} AND l.assigned_to_user_id IS NOT NULL
      ), current_classified AS (
        SELECT cp.*, CASE WHEN cp.current_status = 'converted' THEN 'converted' WHEN cp.has_contact THEN 'contacted' WHEN cp.current_status = ANY(${TERMINAL_SQL}) THEN 'terminal_lead_quality_issue' WHEN cp.current_status = ANY(${RETRYABLE_SQL}) THEN 'retryable_contact_issue' WHEN cp.current_status = 'not_called' THEN 'unworked' ELSE 'other' END AS contact_state
          FROM current_portfolio cp
      ), execution_metrics AS (
        SELECT counselor_id,
          COUNT(DISTINCT lead_id)::int AS total_received,
          COUNT(DISTINCT lead_id) FILTER (WHERE worked)::int AS worked,
          COUNT(DISTINCT lead_id) FILTER (WHERE NOT worked AND ownership_start <= NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.needs_action}))::int AS aged_unworked,
          COUNT(DISTINCT lead_id) FILTER (WHERE worked AND contacted)::int AS attributed_contacted,
          COUNT(DISTINCT lead_id) FILTER (WHERE progressed)::int AS progressed,
          COUNT(DISTINCT lead_id) FILTER (WHERE NOT terminal_quality_attributed)::int AS contactable_received,
          COUNT(DISTINCT lead_id) FILTER (WHERE ownership_start <= NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.needs_action}))::int AS execution_eligible,
          COUNT(DISTINCT lead_id) FILTER (WHERE ownership_start > NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.needs_action}))::int AS new_unworked,
          COUNT(DISTINCT lead_id) FILTER (WHERE personal_meeting)::int AS personal_meetings
        FROM attributed GROUP BY counselor_id
      ), attempt_metrics AS (
        SELECT a.counselor_id,
          COUNT(*) FILTER (WHERE ca.status = 'completed')::int AS completed_attempts,
          COUNT(*) FILTER (WHERE ca.status = 'completed' AND COALESCE(ca.delay_minutes, 0) <= 0)::int AS on_time_attempts,
          COUNT(*) FILTER (WHERE ca.status = 'scheduled' AND ca.scheduled_at <= NOW() AND a.ownership_end = 'infinity'::timestamptz)::int AS overdue_attempts,
          COALESCE(ROUND(AVG(ca.delay_minutes) FILTER (WHERE ca.status = 'completed'), 1), 0)::numeric AS average_delay_minutes
        FROM attributed a JOIN lead_call_attempts ca ON ca.lead_id = a.lead_id
          AND COALESCE(ca.completed_by_user_id, ca.responsible_user_id) = a.counselor_id
          AND COALESCE(ca.attempted_at, ca.scheduled_at, ca.created_at) >= a.ownership_start
          AND COALESCE(ca.attempted_at, ca.scheduled_at, ca.created_at) < a.ownership_end
        GROUP BY a.counselor_id
      ), portfolio_metrics AS (
        SELECT counselor_id,
          COUNT(*)::int AS current_assigned,
          COUNT(*) FILTER (WHERE contact_state IN ('contacted', 'converted'))::int AS current_contacted,
          COUNT(*) FILTER (WHERE contact_state = 'converted')::int AS converted,
          COUNT(*) FILTER (WHERE contact_state = 'retryable_contact_issue')::int AS unresolved_call_issues,
          COUNT(*) FILTER (WHERE contact_state = 'terminal_lead_quality_issue')::int AS terminal_lead_quality_issues,
          COUNT(*) FILTER (WHERE (contact_state = 'unworked' AND assigned_at <= NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.needs_action})) OR contact_state = 'retryable_contact_issue' OR due_attempt OR next_followup_at <= NOW() OR due_meeting)::int AS actionable_pending,
          COUNT(*) FILTER (WHERE upcoming_attempt)::int AS upcoming_calls,
          COUNT(*) FILTER (WHERE contact_state = 'unworked' AND assigned_at <= NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.critical}))::int AS critical_unworked,
          COUNT(*) FILTER (WHERE contact_state = 'unworked' AND assigned_at <= NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.delayed}) AND assigned_at > NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.critical}))::int AS delayed_unworked,
          COUNT(*) FILTER (WHERE contact_state = 'unworked' AND assigned_at <= NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.needs_action}) AND assigned_at > NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.delayed}))::int AS needs_action_unworked,
          COUNT(*) FILTER (WHERE contact_state = 'unworked' AND assigned_at > NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.needs_action}))::int AS new_unworked
        FROM current_classified GROUP BY counselor_id
      )
      SELECT u.id, u.full_name, u.team_name, u.report_to_id, rm.full_name AS rm_name,
        COALESCE(em.total_received, 0) AS total_received, COALESCE(pm.current_assigned, 0) AS current_assigned,
        COALESCE(em.worked, 0) AS worked, COALESCE(em.aged_unworked, 0) AS unworked,
        COALESCE(em.attributed_contacted, 0) AS attributed_contacted, COALESCE(em.contactable_received, 0) AS contactable_received,
        COALESCE(em.execution_eligible, 0) AS execution_eligible, COALESCE(em.progressed, 0) AS progressed,
        COALESCE(pm.current_contacted, 0) AS current_contacted, COALESCE(pm.converted, 0) AS converted,
        COALESCE(pm.unresolved_call_issues, 0) AS unresolved_call_issues, COALESCE(pm.terminal_lead_quality_issues, 0) AS terminal_lead_quality_issues,
        COALESCE(pm.actionable_pending, 0) AS actionable_pending, COALESCE(pm.upcoming_calls, 0) AS upcoming_calls,
        COALESCE(pm.new_unworked, 0) AS new_unworked, COALESCE(pm.needs_action_unworked, 0) AS needs_action_unworked,
        COALESCE(pm.delayed_unworked, 0) AS delayed_unworked, COALESCE(pm.critical_unworked, 0) AS critical_unworked,
        COALESCE(am.completed_attempts, 0) AS completed_attempts, COALESCE(am.on_time_attempts, 0) AS on_time_attempts,
        COALESCE(am.overdue_attempts, 0) AS overdue_attempts, COALESCE(am.average_delay_minutes, 0) AS average_delay_minutes,
        COALESCE(em.personal_meetings, 0) AS personal_meetings
      FROM users u LEFT JOIN users rm ON rm.id = u.report_to_id
      LEFT JOIN execution_metrics em ON em.counselor_id = u.id
      LEFT JOIN portfolio_metrics pm ON pm.counselor_id = u.id
      LEFT JOIN attempt_metrics am ON am.counselor_id = u.id
      WHERE u.deleted_at IS NULL AND u.role::text IN ('member', 'partner') AND COALESCE(u.status::text, 'active') = 'active' ${userFilters.length ? `AND ${userFilters.join(' AND ')}` : ''}
      ORDER BY u.full_name`
  };
}

async function getCounselorRows(input = {}) {
  const { sql, params } = buildQuery(input);
  const { rows } = await query(sql, params);
  const issueBreakdowns = await getIssueBreakdowns(input);
  return rows.map(row => {
    const numeric = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, /^-?\d+(\.\d+)?$/.test(String(value)) ? Number(value) : value]));
    const quality = calculateQuality(numeric);
    const rate = (numerator, denominator) => ({
      numerator: Number(numerator || 0),
      denominator: Number(denominator || 0),
      value: denominator ? Number((numerator / denominator * 100).toFixed(1)) : 0,
    });
    return {
      ...numeric, quality, call_issues: issueBreakdowns.get(numeric.id) || { unresolved_total: 0, retryable_total: 0, terminal_quality_total: 0, buckets: {} },
      raw_contact_rate: rate(numeric.attributed_contacted, numeric.total_received),
      actionable_contact_rate: rate(numeric.attributed_contacted, numeric.contactable_received),
      work_coverage_rate: rate(numeric.worked, numeric.execution_eligible),
      followup_discipline_rate: rate(numeric.on_time_attempts, numeric.completed_attempts),
      progression_rate: rate(numeric.progressed, numeric.attributed_contacted),
      call_issue_rate: rate(numeric.unresolved_call_issues, numeric.current_assigned),
    };
  });
}

async function getIssueBreakdowns(input = {}) {
  const params = [];
  const { from, to } = dateBounds(input);
  if (from) params.push(from);
  const fromIndex = from ? params.length : null;
  if (to) params.push(to);
  const toIndex = to ? params.length : null;
  const scope = addLeadFilters(input, params, 'l');
  const dates = [fromIndex && `l.assigned_at >= $${fromIndex}::timestamptz`, toIndex && `l.assigned_at < ($${toIndex}::date + INTERVAL '1 day')`].filter(Boolean).join(' AND ') || 'TRUE';
  const userFilters = [];
  if (input.counselor || input.counselor_id) { params.push(input.counselor || input.counselor_id); userFilters.push(`l.assigned_to_user_id = $${params.length}::uuid`); }
  if (input.rm || input.rm_id) { params.push(input.rm || input.rm_id); userFilters.push(`u.report_to_id = $${params.length}::uuid`); }
  if (input.team) { params.push(input.team); userFilters.push(`u.team_name = $${params.length}`); }
  const effective = `CASE WHEN l.call_status::text = 'converted' THEN 'converted' WHEN EXISTS (SELECT 1 FROM lead_workflow wf WHERE wf.lead_id = l.id AND COALESCE(wf.remark_status::text, '') = ANY(${CONTACTED_SQL})) OR EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.status = 'completed' AND ca.outcome = 'call_received') THEN 'communication_completed' ELSE l.call_status::text END`;
  const { rows } = await query(`SELECT l.assigned_to_user_id AS counselor_id, ${effective} AS issue_type, COUNT(DISTINCT l.id)::int AS count FROM leads l JOIN users u ON u.id = l.assigned_to_user_id WHERE ${scope} AND ${dates} AND l.assigned_to_user_id IS NOT NULL ${userFilters.length ? `AND ${userFilters.join(' AND ')}` : ''} GROUP BY l.assigned_to_user_id, ${effective}`, params);
  const output = new Map();
  for (const row of rows) {
    if (![...RETRYABLE_CONTACT_ISSUES, ...TERMINAL_LEAD_QUALITY_ISSUES].includes(row.issue_type)) continue;
    const item = output.get(row.counselor_id) || { unresolved_total: 0, retryable_total: 0, terminal_quality_total: 0, buckets: {} };
    const bucket = row.issue_type === 'in' ? 'invalid_number' : row.issue_type;
    item.buckets[bucket] = Number(row.count);
    item.unresolved_total += Number(row.count);
    if (RETRYABLE_CONTACT_ISSUES.includes(row.issue_type)) item.retryable_total += Number(row.count); else item.terminal_quality_total += Number(row.count);
    output.set(row.counselor_id, item);
  }
  return output;
}

async function summary(input) {
  const rows = await getCounselorRows(input);
  const totals = rows.reduce((result, row) => {
    for (const key of ['total_received', 'current_assigned', 'worked', 'unworked', 'actionable_pending', 'current_contacted', 'unresolved_call_issues', 'terminal_lead_quality_issues', 'converted', 'personal_meetings', 'overdue_attempts']) result[key] += Number(row[key] || 0);
    return result;
  }, { total_received: 0, current_assigned: 0, worked: 0, unworked: 0, actionable_pending: 0, current_contacted: 0, unresolved_call_issues: 0, terminal_lead_quality_issues: 0, converted: 0, personal_meetings: 0, overdue_attempts: 0 });
  return { total_counselors: rows.length, ...totals };
}

async function teams(input) {
  const rows = await getCounselorRows(input);
  const groups = new Map();
  for (const row of rows) {
    const key = row.report_to_id || 'unassigned';
    const item = groups.get(key) || { rm_id: row.report_to_id, rm_name: row.rm_name || 'No RM assigned', team_name: row.team_name || 'Unassigned', members: 0 };
    item.members += 1;
    for (const metric of ['total_received', 'current_assigned', 'worked', 'unworked', 'attributed_contacted', 'contactable_received', 'execution_eligible', 'progressed', 'converted', 'unresolved_call_issues', 'terminal_lead_quality_issues', 'actionable_pending', 'personal_meetings', 'completed_attempts', 'on_time_attempts', 'overdue_attempts']) item[metric] = (item[metric] || 0) + Number(row[metric] || 0);
    groups.set(key, item);
  }
  return [...groups.values()].map(item => ({ ...item, quality: calculateQuality(item), aggregation_label: 'Current Team Aggregation' }));
}

async function filters() {
  const { rows } = await query(`SELECT id, full_name, role::text AS role, report_to_id, team_name FROM users WHERE deleted_at IS NULL AND role::text IN ('member', 'partner', 'rm') ORDER BY full_name`);
  return { users: rows, call_issues: RETRYABLE_CONTACT_ISSUES.map(key => ({ key, label: CALL_ISSUE_LABELS[key] })) };
}

async function drilldown(input = {}) {
  const counselorId = String(input.counselor_id || '').trim();
  if (!counselorId) return { rows: [], total: 0 };
  const page = Math.max(1, Number(input.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(input.page_size || 25)));
  const params = [counselorId];
  const { from, to } = dateBounds(input);
  const dates = [];
  if (from) { params.push(from); dates.push(`l.assigned_at >= $${params.length}::timestamptz`); }
  if (to) { params.push(to); dates.push(`l.assigned_at < ($${params.length}::date + INTERVAL '1 day')`); }
  const scope = addLeadFilters(input, params, 'l');
  const metric = String(input.metric || '').trim();
  const effective = `CASE WHEN EXISTS (SELECT 1 FROM lead_workflow wf WHERE wf.lead_id = l.id AND COALESCE(wf.remark_status::text, '') = ANY(${CONTACTED_SQL})) OR EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.status = 'completed' AND ca.outcome = 'call_received') THEN 'communication_completed' ELSE l.call_status::text END`;
  const requestedIssue = String(input.call_issue_type || input.issue_type || '').trim().toLowerCase();
  const metricClause = {
    call_issue: `${effective} = ANY(${RETRYABLE_SQL})`,
    unresolved_call_issue: `${effective} = ANY(${RETRYABLE_SQL})`,
    terminal_quality: `${effective} = ANY(${TERMINAL_SQL})`,
    overdue: `EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.status = 'scheduled' AND ca.scheduled_at <= NOW())`,
    pending: `(${effective} = ANY(${RETRYABLE_SQL}) OR l.next_followup_at <= NOW() OR EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.status = 'scheduled' AND ca.scheduled_at <= NOW()))`,
  }[metric] || 'TRUE';
  const normalizedIssue = requestedIssue === 'invalid_number' ? 'in' : requestedIssue;
  const issueClause = !normalizedIssue ? 'TRUE' : ([...RETRYABLE_CONTACT_ISSUES, ...TERMINAL_LEAD_QUALITY_ISSUES].includes(normalizedIssue) ? `${effective} = '${normalizedIssue}'` : 'FALSE');
  const where = [`l.assigned_to_user_id = $1::uuid`, scope, ...dates, metricClause, issueClause].join(' AND ');
  const { rows: [count] } = await query(`SELECT COUNT(*)::int AS total FROM leads l WHERE ${where}`, params);
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(`SELECT l.id, l.full_name, l.phone, l.source, l.campaign_name, l.campaign_label, l.assigned_at, l.call_status::text AS call_status, l.next_followup_at, ${effective} AS effective_status,
    (SELECT MAX(created_at) FROM lead_remarks lr WHERE lr.lead_id = l.id) AS last_action_at,
    (SELECT MIN(scheduled_at) FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.status = 'scheduled') AS next_attempt_at
    FROM leads l WHERE ${where} ORDER BY l.assigned_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { rows, total: Number(count.total), page, page_size: pageSize };
}

module.exports = { getCounselorRows, summary, teams, filters, drilldown, _buildQuery: buildQuery };
