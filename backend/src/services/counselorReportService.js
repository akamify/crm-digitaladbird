const { query } = require('../config/database');
const { GRACE_MINUTES: ATTEMPT_GRACE_MINUTES } = require('./leadCallAttemptService');
const {
  RETRYABLE_CONTACT_ISSUES, TERMINAL_LEAD_QUALITY_ISSUES, CONTACTED_STATUSES,
  PROGRESSION_STATUSES, UNWORKED_SLA_HOURS, CALL_ISSUE_LABELS, sqlArray, calculateQuality,
} = require('../constants/counselorReportOptions');
const { activeSequenceIssueSql } = require('../utils/leadCallIssueMetrics');

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
  const ownershipDate = alias => [fromIndex && `${alias}.ownership_start >= $${fromIndex}::timestamptz`, toIndex && `${alias}.ownership_start < ($${toIndex}::date + INTERVAL '1 day')`].filter(Boolean).join(' AND ') || 'TRUE';
  const cohortDate = ownershipDate('o');
  const currentDate = [fromIndex && `l.assigned_at >= $${fromIndex}::timestamptz`, toIndex && `l.assigned_at < ($${toIndex}::date + INTERVAL '1 day')`].filter(Boolean).join(' AND ') || 'TRUE';
  // Compliance is attributed by the time an attempt became due, not by its later completion time.
  const attemptDate = [fromIndex && `ca.scheduled_at >= $${fromIndex}::timestamptz`, toIndex && `ca.scheduled_at < ($${toIndex}::date + INTERVAL '1 day')`].filter(Boolean).join(' AND ') || 'TRUE';
  // A current unresolved issue with a retry in the selected period must remain visible,
  // even when the original lead assignment predates that period.
  const currentPortfolioDate = `(${currentDate} OR EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ${attemptDate}))`;
  const userFilters = [];
  if (input.counselor || input.counselor_id) { params.push(input.counselor || input.counselor_id); userFilters.push(`u.id = $${params.length}::uuid`); }
  if (input.rm || input.rm_id) { params.push(input.rm || input.rm_id); userFilters.push(`u.report_to_id = $${params.length}::uuid`); }
  if (input.team) { params.push(input.team); userFilters.push(`u.team_name = $${params.length}`); }

  return {
    params,
    sql: `
      WITH eligible_leads AS MATERIALIZED (
        SELECT l.id
          FROM leads l
         WHERE ${leadFilters}
      ), ownership AS MATERIALIZED (
        SELECT a.lead_id, COALESCE(a.assigned_to_user_id, a.user_id) AS counselor_id,
               a.assigned_at AS ownership_start,
               COALESCE(a.unassigned_at, LEAD(a.assigned_at) OVER (PARTITION BY a.lead_id ORDER BY a.assigned_at, a.id), 'infinity'::timestamptz) AS ownership_end
          FROM lead_assignments a
          JOIN eligible_leads el ON el.id = a.lead_id
          WHERE COALESCE(a.assigned_to_user_id, a.user_id) IS NOT NULL
      ), cohort AS MATERIALIZED (
        SELECT DISTINCT ON (o.counselor_id, o.lead_id)
               o.lead_id, o.counselor_id, o.ownership_start, o.ownership_end
          FROM ownership o
         WHERE ${cohortDate}
         ORDER BY o.counselor_id, o.lead_id, o.ownership_start DESC
      ), attributed AS MATERIALIZED (
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
      ), reassigned_out_metrics AS (
        SELECT ro.counselor_id, COUNT(DISTINCT ro.lead_id)::int AS reassigned_out
          FROM ownership ro
         WHERE ${ownershipDate('ro')}
           AND EXISTS (
             SELECT 1 FROM ownership next_owner
              WHERE next_owner.lead_id = ro.lead_id
                AND next_owner.counselor_id <> ro.counselor_id
                AND next_owner.ownership_start >= ro.ownership_end
           )
         GROUP BY ro.counselor_id
      ), current_portfolio AS (
        SELECT l.id AS lead_id, l.assigned_to_user_id AS counselor_id,
               active_seq.active_sequence_issue,
               COALESCE(active_seq.active_sequence_issue, l.call_status::text) AS current_status,
               l.assigned_at, l.next_followup_at,
               EXISTS (SELECT 1 FROM lead_workflow wf WHERE wf.lead_id = l.id AND COALESCE(wf.remark_status::text, '') = ANY(${CONTACTED_SQL})) OR
               EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.status = 'completed' AND ca.outcome = 'call_received') AS has_contact,
               EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.status = 'scheduled' AND ca.scheduled_at <= NOW()) AS due_attempt,
               EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.status = 'scheduled' AND ca.scheduled_at > NOW()) AS upcoming_attempt,
               EXISTS (SELECT 1 FROM customer_notes pm WHERE pm.lead_id = l.id AND pm.note_kind = 'personal_meeting' AND pm.deleted_at IS NULL AND pm.next_meeting_at <= NOW()) AS due_meeting
          FROM eligible_leads el
          JOIN leads l ON l.id = el.id
          LEFT JOIN LATERAL (
            SELECT ${activeSequenceIssueSql('l')} AS active_sequence_issue
          ) active_seq ON TRUE
         WHERE ${currentPortfolioDate} AND l.assigned_to_user_id IS NOT NULL
      ), current_classified AS (
        SELECT cp.*, CASE WHEN cp.active_sequence_issue = ANY(${RETRYABLE_SQL}) THEN 'retryable_contact_issue' WHEN cp.current_status = 'converted' THEN 'converted' WHEN cp.has_contact THEN 'contacted' WHEN cp.current_status = ANY(${TERMINAL_SQL}) THEN 'terminal_lead_quality_issue' WHEN cp.current_status = ANY(${RETRYABLE_SQL}) THEN 'retryable_contact_issue' WHEN cp.current_status = 'not_called' THEN 'unworked' ELSE 'other' END AS contact_state
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
      ), attempt_compliance_metrics AS (
        SELECT o.counselor_id,
          COUNT(*) FILTER (WHERE ca.status = 'completed' AND ca.scheduled_at <= NOW())::int AS attempt_completed_count,
          COUNT(*) FILTER (WHERE (ca.status = 'missed' OR (ca.status = 'scheduled' AND ca.scheduled_at <= NOW() - make_interval(mins => ${ATTEMPT_GRACE_MINUTES}))) )::int AS attempt_missed_count,
          COUNT(*) FILTER (WHERE ca.status = 'scheduled' AND ca.scheduled_at > NOW())::int AS attempt_upcoming_count
        FROM ownership o
        JOIN lead_call_attempts ca ON ca.lead_id = o.lead_id
          AND ca.scheduled_at >= o.ownership_start AND ca.scheduled_at < o.ownership_end
        JOIN eligible_leads el ON el.id = ca.lead_id
        WHERE ${attemptDate} AND ca.attempt_number > 1 AND ca.status IN ('scheduled', 'completed', 'missed')
        GROUP BY o.counselor_id
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
        COALESCE(rom.reassigned_out, 0) AS reassigned_out,
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
        COALESCE(acm.attempt_completed_count, 0) AS attempt_completed_count,
        COALESCE(acm.attempt_missed_count, 0) AS attempt_missed_count,
        COALESCE(acm.attempt_upcoming_count, 0) AS attempt_upcoming_count,
        COALESCE(em.personal_meetings, 0) AS personal_meetings
      FROM users u LEFT JOIN users rm ON rm.id = u.report_to_id
      LEFT JOIN execution_metrics em ON em.counselor_id = u.id
      LEFT JOIN reassigned_out_metrics rom ON rom.counselor_id = u.id
      LEFT JOIN portfolio_metrics pm ON pm.counselor_id = u.id
      LEFT JOIN attempt_metrics am ON am.counselor_id = u.id
      LEFT JOIN attempt_compliance_metrics acm ON acm.counselor_id = u.id
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
    const attemptDueCount = numeric.attempt_completed_count + numeric.attempt_missed_count;
    return {
      ...numeric, quality, call_issues: issueBreakdowns.get(numeric.id) || { unresolved_total: 0, retryable_total: 0, terminal_quality_total: 0, buckets: {}, retryable_buckets: {}, terminal_quality_buckets: {} },
      attempt_due_count: attemptDueCount,
      attempt_compliance_pct: attemptDueCount ? Number((numeric.attempt_completed_count / attemptDueCount * 100).toFixed(1)) : null,
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
  const attemptDates = [fromIndex && `ca.scheduled_at >= $${fromIndex}::timestamptz`, toIndex && `ca.scheduled_at < ($${toIndex}::date + INTERVAL '1 day')`].filter(Boolean).join(' AND ') || 'TRUE';
  const currentPortfolioDate = `(${dates} OR EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ${attemptDates}))`;
  const userFilters = [];
  if (input.counselor || input.counselor_id) { params.push(input.counselor || input.counselor_id); userFilters.push(`l.assigned_to_user_id = $${params.length}::uuid`); }
  if (input.rm || input.rm_id) { params.push(input.rm || input.rm_id); userFilters.push(`u.report_to_id = $${params.length}::uuid`); }
  if (input.team) { params.push(input.team); userFilters.push(`u.team_name = $${params.length}`); }
  const activeIssue = 'active_seq.active_sequence_issue';
  const effective = `CASE WHEN l.call_status::text = 'converted' THEN 'converted' WHEN ${activeIssue} = ANY(${RETRYABLE_SQL}) THEN ${activeIssue} WHEN EXISTS (SELECT 1 FROM lead_workflow wf WHERE wf.lead_id = l.id AND COALESCE(wf.remark_status::text, '') = ANY(${CONTACTED_SQL})) OR EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.status = 'completed' AND ca.outcome = 'call_received') THEN 'communication_completed' ELSE l.call_status::text END`;
  const { rows } = await query(`
    WITH eligible_leads AS MATERIALIZED (
      SELECT l.id
        FROM leads l
       WHERE ${scope}
    )
    SELECT l.assigned_to_user_id AS counselor_id, ${effective} AS issue_type, COUNT(DISTINCT l.id)::int AS count
      FROM eligible_leads el
      JOIN leads l ON l.id = el.id
      JOIN users u ON u.id = l.assigned_to_user_id
      LEFT JOIN LATERAL (
        SELECT ${activeSequenceIssueSql('l')} AS active_sequence_issue
      ) active_seq ON TRUE
     WHERE ${currentPortfolioDate} AND l.assigned_to_user_id IS NOT NULL ${userFilters.length ? `AND ${userFilters.join(' AND ')}` : ''}
     GROUP BY l.assigned_to_user_id, ${effective}`, params);
  const output = new Map();
  for (const row of rows) {
    if (![...RETRYABLE_CONTACT_ISSUES, ...TERMINAL_LEAD_QUALITY_ISSUES].includes(row.issue_type)) continue;
    const item = output.get(row.counselor_id) || { unresolved_total: 0, retryable_total: 0, terminal_quality_total: 0, buckets: {}, retryable_buckets: {}, terminal_quality_buckets: {} };
    const bucket = row.issue_type === 'in' ? 'invalid_number' : row.issue_type;
    item.buckets[bucket] = Number(row.count);
    item.unresolved_total += Number(row.count);
    if (RETRYABLE_CONTACT_ISSUES.includes(row.issue_type)) {
      item.retryable_total += Number(row.count);
      item.retryable_buckets[bucket] = Number(row.count);
    } else {
      item.terminal_quality_total += Number(row.count);
      item.terminal_quality_buckets[bucket] = Number(row.count);
    }
    output.set(row.counselor_id, item);
  }
  return output;
}

async function summary(input) {
  const rows = await getCounselorRows(input);
  const totals = rows.reduce((result, row) => {
    for (const key of ['total_received', 'current_assigned', 'reassigned_out', 'worked', 'unworked', 'actionable_pending', 'current_contacted', 'unresolved_call_issues', 'terminal_lead_quality_issues', 'converted', 'personal_meetings', 'overdue_attempts']) result[key] += Number(row[key] || 0);
    return result;
  }, { total_received: 0, current_assigned: 0, reassigned_out: 0, worked: 0, unworked: 0, actionable_pending: 0, current_contacted: 0, unresolved_call_issues: 0, terminal_lead_quality_issues: 0, converted: 0, personal_meetings: 0, overdue_attempts: 0 });
  return { total_counselors: rows.length, ...totals };
}

async function teams(input) {
  const rows = await getCounselorRows(input);
  const groups = new Map();
  for (const row of rows) {
    const key = row.report_to_id || 'unassigned';
    const item = groups.get(key) || { rm_id: row.report_to_id, rm_name: row.rm_name || 'No RM assigned', team_name: row.team_name || 'Unassigned', members: 0 };
    item.members += 1;
    for (const metric of ['total_received', 'current_assigned', 'worked', 'unworked', 'attributed_contacted', 'contactable_received', 'execution_eligible', 'progressed', 'converted', 'unresolved_call_issues', 'terminal_lead_quality_issues', 'actionable_pending', 'personal_meetings', 'completed_attempts', 'on_time_attempts', 'overdue_attempts', 'attempt_completed_count', 'attempt_missed_count', 'attempt_upcoming_count']) item[metric] = (item[metric] || 0) + Number(row[metric] || 0);
    groups.set(key, item);
  }
  return [...groups.values()].map(item => {
    const attempt_due_count = item.attempt_completed_count + item.attempt_missed_count;
    return { ...item, attempt_due_count, attempt_compliance_pct: attempt_due_count ? Number((item.attempt_completed_count / attempt_due_count * 100).toFixed(1)) : null, quality: calculateQuality(item), aggregation_label: 'Current Team Aggregation' };
  });
}

async function filters() {
  const { rows } = await query(`SELECT id, full_name, role::text AS role, report_to_id, team_name FROM users WHERE deleted_at IS NULL AND role::text IN ('member', 'partner', 'rm') ORDER BY full_name`);
  return { users: rows, call_issues: RETRYABLE_CONTACT_ISSUES.map(key => ({ key, label: CALL_ISSUE_LABELS[key] })) };
}

async function drilldown(input = {}) {
  const counselorId = String(input.counselor_id || '').trim();
  if (!counselorId) return { rows: [], total: 0 };
  if (String(input.metric || '').trim() === 'attempt_compliance') return drilldownAttemptCompliance(input, counselorId);
  const page = Math.max(1, Number(input.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(input.page_size || 25)));
  const params = [counselorId];
  const { from, to } = dateBounds(input);
  if (from) params.push(from);
  const fromIndex = from ? params.length : null;
  if (to) params.push(to);
  const toIndex = to ? params.length : null;
  const scope = addLeadFilters(input, params, 'l');
  const metric = String(input.metric || '').trim();
  const cohortDate = [fromIndex && `o.ownership_start >= $${fromIndex}::timestamptz`, toIndex && `o.ownership_start < ($${toIndex}::date + INTERVAL '1 day')`].filter(Boolean).join(' AND ') || 'TRUE';
  const reassignedDate = [fromIndex && `ro.ownership_start >= $${fromIndex}::timestamptz`, toIndex && `ro.ownership_start < ($${toIndex}::date + INTERVAL '1 day')`].filter(Boolean).join(' AND ') || 'TRUE';
  const currentDate = [fromIndex && `l.assigned_at >= $${fromIndex}::timestamptz`, toIndex && `l.assigned_at < ($${toIndex}::date + INTERVAL '1 day')`].filter(Boolean).join(' AND ') || 'TRUE';
  const attemptDate = [fromIndex && `ca.scheduled_at >= $${fromIndex}::timestamptz`, toIndex && `ca.scheduled_at < ($${toIndex}::date + INTERVAL '1 day')`].filter(Boolean).join(' AND ') || 'TRUE';
  const currentPortfolioDate = `(${currentDate} OR EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ${attemptDate}))`;
  const userFilters = [];
  if (input.rm || input.rm_id) { params.push(input.rm || input.rm_id); userFilters.push(`u.report_to_id = $${params.length}::uuid`); }
  if (input.team) { params.push(input.team); userFilters.push(`u.team_name = $${params.length}`); }
  const userScope = userFilters.length ? `AND ${userFilters.join(' AND ')}` : '';
  const requestedIssue = String(input.call_issue_type || input.issue_type || '').trim().toLowerCase();
  const normalizedIssue = requestedIssue === 'invalid_number' ? 'in' : requestedIssue;
  const validIssue = [...RETRYABLE_CONTACT_ISSUES, ...TERMINAL_LEAD_QUALITY_ISSUES].includes(normalizedIssue);
  const attributedMetric = {
    worked: `a.worked`,
    unworked: `NOT a.worked AND a.ownership_start <= NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.needs_action})`,
    personal_meeting_leads: `a.personal_meeting`,
  }[metric];
  const currentMetric = {
    contacted: `cc.contact_state IN ('contacted', 'converted')`,
    converted: `cc.contact_state = 'converted'`,
    call_issue: `cc.contact_state = 'retryable_contact_issue'`,
    unresolved_call_issue: `cc.contact_state = 'retryable_contact_issue'`,
    terminal_quality: `cc.contact_state = 'terminal_lead_quality_issue'`,
    overdue: `cc.due_attempt`,
    pending: `((cc.contact_state = 'unworked' AND cc.assigned_at <= NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.needs_action})) OR cc.contact_state = 'retryable_contact_issue' OR cc.due_attempt OR cc.next_followup_at <= NOW() OR cc.due_meeting)`,
  }[metric];
  const currentMetricClause = normalizedIssue ? `cc.contact_state IN ('retryable_contact_issue', 'terminal_lead_quality_issue')` : currentMetric;
  const issueStatusClause = requestedIssue === 'invalid_number' ? `cc.current_status IN ('in', 'invalid_number')` : `cc.current_status = '${normalizedIssue}'`;
  const issueClause = normalizedIssue ? (validIssue ? `${issueStatusClause} AND cc.contact_state IN ('retryable_contact_issue', 'terminal_lead_quality_issue')` : 'FALSE') : 'TRUE';
  const candidateSql = metric === 'reassigned_out'
    ? `SELECT ro.lead_id, ro.assigned_at, 'Reassigned to another counselor' AS metric_reason, NULL::text AS aging_state, ro.reassigned_at, ro.reassigned_to_user_id FROM reassigned_out ro JOIN users u ON u.id = $1::uuid WHERE TRUE ${userScope}`
    : attributedMetric
      ? `SELECT a.lead_id, a.ownership_start AS assigned_at, CASE WHEN '${metric}' = 'worked' THEN 'Qualifying counselor action' WHEN '${metric}' = 'unworked' THEN 'No qualifying action' ELSE 'Personal Meeting recorded' END AS metric_reason, CASE WHEN '${metric}' = 'unworked' THEN CASE WHEN a.ownership_start <= NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.critical}) THEN 'Critical' WHEN a.ownership_start <= NOW() - make_interval(hours => ${UNWORKED_SLA_HOURS.delayed}) THEN 'Delayed' ELSE 'Needs Action' END END AS aging_state, NULL::timestamptz AS reassigned_at, NULL::uuid AS reassigned_to_user_id FROM attributed a JOIN users u ON u.id = a.counselor_id WHERE a.counselor_id = $1::uuid AND ${attributedMetric} ${userScope}`
      : `SELECT cc.lead_id, cc.assigned_at, CASE WHEN '${metric}' = 'contacted' THEN 'Successfully contacted' WHEN '${metric}' = 'converted' THEN 'Converted' WHEN '${metric}' = 'overdue' THEN 'Call attempt overdue' WHEN '${metric}' = 'pending' THEN 'Action required' ELSE COALESCE(cc.current_status, 'Call issue') END AS metric_reason, NULL::text AS aging_state, NULL::timestamptz AS reassigned_at, NULL::uuid AS reassigned_to_user_id FROM current_classified cc JOIN users u ON u.id = cc.counselor_id WHERE cc.counselor_id = $1::uuid AND ${currentMetricClause || 'FALSE'} AND ${issueClause} ${userScope}`;
  const cte = `WITH ownership AS (
      SELECT a.lead_id, COALESCE(a.assigned_to_user_id, a.user_id) AS counselor_id, a.assigned_at AS ownership_start,
        COALESCE(a.unassigned_at, LEAD(a.assigned_at) OVER (PARTITION BY a.lead_id ORDER BY a.assigned_at, a.id), 'infinity'::timestamptz) AS ownership_end
      FROM lead_assignments a WHERE COALESCE(a.assigned_to_user_id, a.user_id) IS NOT NULL
    ), cohort AS (
      SELECT DISTINCT ON (o.counselor_id, o.lead_id) o.lead_id, o.counselor_id, o.ownership_start, o.ownership_end
      FROM ownership o JOIN leads l ON l.id = o.lead_id WHERE ${cohortDate} AND ${scope}
      ORDER BY o.counselor_id, o.lead_id, o.ownership_start DESC
    ), attributed AS (
      SELECT c.*, EXISTS (SELECT 1 FROM lead_remarks r WHERE r.lead_id = c.lead_id AND r.user_id = c.counselor_id AND r.created_at >= c.ownership_start AND r.created_at < c.ownership_end) OR EXISTS (SELECT 1 FROM lead_workflow_history h WHERE h.lead_id = c.lead_id AND h.user_id = c.counselor_id AND h.created_at >= c.ownership_start AND h.created_at < c.ownership_end) OR EXISTS (SELECT 1 FROM lead_call_logs cl WHERE cl.lead_id = c.lead_id AND cl.user_id = c.counselor_id AND cl.created_at >= c.ownership_start AND cl.created_at < c.ownership_end) OR EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = c.lead_id AND COALESCE(ca.completed_by_user_id, ca.responsible_user_id) = c.counselor_id AND COALESCE(ca.attempted_at, ca.created_at) >= c.ownership_start AND COALESCE(ca.attempted_at, ca.created_at) < c.ownership_end) OR EXISTS (SELECT 1 FROM customer_notes pm WHERE pm.lead_id = c.lead_id AND pm.note_kind = 'personal_meeting' AND pm.deleted_at IS NULL AND pm.counselor_user_id = c.counselor_id AND pm.created_at >= c.ownership_start AND pm.created_at < c.ownership_end) AS worked,
        EXISTS (SELECT 1 FROM customer_notes pm WHERE pm.lead_id = c.lead_id AND pm.note_kind = 'personal_meeting' AND pm.deleted_at IS NULL AND pm.counselor_user_id = c.counselor_id AND pm.created_at >= c.ownership_start AND pm.created_at < c.ownership_end) AS personal_meeting
      FROM cohort c
    ), current_portfolio AS (
      SELECT l.id AS lead_id, l.assigned_to_user_id AS counselor_id, ${activeSequenceIssueSql('l')} AS active_sequence_issue, COALESCE(${activeSequenceIssueSql('l')}, l.call_status::text) AS current_status, l.assigned_at, l.next_followup_at,
        EXISTS (SELECT 1 FROM lead_workflow wf WHERE wf.lead_id = l.id AND COALESCE(wf.remark_status::text, '') = ANY(${CONTACTED_SQL})) OR EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.status = 'completed' AND ca.outcome = 'call_received') AS has_contact,
        EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.status = 'scheduled' AND ca.scheduled_at <= NOW()) AS due_attempt,
        EXISTS (SELECT 1 FROM customer_notes pm WHERE pm.lead_id = l.id AND pm.note_kind = 'personal_meeting' AND pm.deleted_at IS NULL AND pm.next_meeting_at <= NOW()) AS due_meeting
      FROM leads l WHERE ${scope} AND ${currentPortfolioDate} AND l.assigned_to_user_id IS NOT NULL
    ), current_classified AS (
      SELECT cp.*, CASE WHEN cp.active_sequence_issue = ANY(${RETRYABLE_SQL}) THEN 'retryable_contact_issue' WHEN cp.current_status = 'converted' THEN 'converted' WHEN cp.has_contact THEN 'contacted' WHEN cp.current_status = ANY(${TERMINAL_SQL}) THEN 'terminal_lead_quality_issue' WHEN cp.current_status = ANY(${RETRYABLE_SQL}) THEN 'retryable_contact_issue' WHEN cp.current_status = 'not_called' THEN 'unworked' ELSE 'other' END AS contact_state FROM current_portfolio cp
    ), reassigned_out AS (
      SELECT DISTINCT ON (ro.lead_id)
        ro.lead_id, ro.ownership_start AS assigned_at,
        next_owner.ownership_start AS reassigned_at,
        next_owner.counselor_id AS reassigned_to_user_id
      FROM ownership ro
      JOIN leads l ON l.id = ro.lead_id
      JOIN LATERAL (
        SELECT next_assignment.ownership_start, next_assignment.counselor_id
        FROM ownership next_assignment
        WHERE next_assignment.lead_id = ro.lead_id
          AND next_assignment.counselor_id <> ro.counselor_id
          AND next_assignment.ownership_start >= ro.ownership_end
        ORDER BY next_assignment.ownership_start ASC
        LIMIT 1
      ) next_owner ON TRUE
      WHERE ro.counselor_id = $1::uuid AND ${reassignedDate} AND ${scope}
      ORDER BY ro.lead_id, ro.ownership_start DESC
    ), candidates AS (${candidateSql})`;
  const { rows: [count] } = await query(`${cte} SELECT COUNT(DISTINCT lead_id)::int AS total FROM candidates`, params);
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(`${cte} SELECT DISTINCT ON (c.lead_id) l.id, l.full_name, l.phone, l.source, l.campaign_name, l.campaign_label, c.assigned_at, c.reassigned_at, reassigned_to.full_name AS reassigned_to_name, l.call_status::text AS call_status, l.next_followup_at, c.metric_reason, c.aging_state,
    CASE WHEN l.call_status::text = 'converted' THEN 'converted' WHEN EXISTS (SELECT 1 FROM lead_workflow wf WHERE wf.lead_id = l.id AND COALESCE(wf.remark_status::text, '') = ANY(${CONTACTED_SQL})) OR EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.status = 'completed' AND ca.outcome = 'call_received') THEN 'communication_completed' ELSE l.call_status::text END AS effective_status,
    (SELECT MAX(created_at) FROM lead_remarks lr WHERE lr.lead_id = l.id) AS last_action_at,
    (SELECT MIN(scheduled_at) FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.status = 'scheduled') AS next_attempt_at
    FROM candidates c JOIN leads l ON l.id = c.lead_id LEFT JOIN users reassigned_to ON reassigned_to.id = c.reassigned_to_user_id ORDER BY c.lead_id, c.assigned_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  if (metric === 'call_issue' || metric === 'unresolved_call_issue') {
    const leadIds = rows.map(row => row.id);
    if (leadIds.length) {
      // One active sequence per lead is enforced by migration 069; this remains a single batch query per drawer page.
      const { rows: attemptRows } = await query(`
        SELECT ca.lead_id, ca.attempt_number, GREATEST(ca.attempt_number - 1, 0) AS retry_number, ca.status, ca.trigger_reason, ca.scheduled_at, ca.attempted_at, ca.outcome,
          ca.responsible_user_id, ca.completed_by_user_id, ca.is_final_attempt,
          CASE
            WHEN ca.attempt_number = 1 THEN 'initial_issue'
            WHEN ca.status = 'completed' THEN 'completed'
            WHEN ca.status = 'cancelled' THEN 'not_required'
            WHEN ca.status = 'missed' OR (ca.status = 'scheduled' AND ca.scheduled_at <= NOW() - make_interval(mins => ${ATTEMPT_GRACE_MINUTES})) THEN 'missed'
            WHEN ca.status = 'scheduled' THEN 'upcoming'
            ELSE 'not_required'
          END AS attempt_state,
          CASE
            WHEN ca.status = 'scheduled' AND ca.scheduled_at <= NOW() - make_interval(mins => ${ATTEMPT_GRACE_MINUTES})
              THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - ca.scheduled_at)) / 60))::int
            WHEN ca.status = 'missed'
              THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - ca.scheduled_at)) / 60))::int
            ELSE NULL
          END AS overdue_by_minutes,
          CASE
            WHEN ca.status = 'scheduled' AND ca.scheduled_at > NOW()
              THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (ca.scheduled_at - NOW())) / 60))::int
            ELSE NULL
          END AS available_in_minutes
        FROM lead_call_attempts ca
        JOIN lead_call_attempt_sequences seq ON seq.id = ca.sequence_id AND seq.status = 'active'
        WHERE ca.lead_id = ANY($1::uuid[])
        ORDER BY ca.lead_id, ca.attempt_number ASC, ca.created_at ASC
      `, [leadIds]);
      const attemptsByLead = new Map();
      for (const attempt of attemptRows) {
        const list = attemptsByLead.get(attempt.lead_id) || [];
        list.push({
          ...attempt,
          attributed_to_counselor: (attempt.completed_by_user_id || attempt.responsible_user_id) === counselorId,
        });
        attemptsByLead.set(attempt.lead_id, list);
      }
      for (const row of rows) {
        const attempts = attemptsByLead.get(row.id) || [];
        row.attempts = attempts;
        row.attempt_tracking = attempts.length > 0 ? 'tracked' : 'none';
      }
    }
  }
  return { rows, total: Number(count.total), page, page_size: pageSize };
}

async function drilldownAttemptCompliance(input, counselorId) {
  const page = Math.max(1, Number(input.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(input.page_size || 25)));
  const params = [counselorId];
  const { from, to } = dateBounds(input);
  if (from) params.push(from);
  const fromIndex = from ? params.length : null;
  if (to) params.push(to);
  const toIndex = to ? params.length : null;
  const scope = addLeadFilters(input, params, 'l');
  const dates = [fromIndex && `ca.scheduled_at >= $${fromIndex}::timestamptz`, toIndex && `ca.scheduled_at < ($${toIndex}::date + INTERVAL '1 day')`].filter(Boolean).join(' AND ') || 'TRUE';
  const status = String(input.attempt_status || 'all_due').trim();
  const number = Number(input.attempt_number || 0);
  const statusClause = {
    all_due: `(ca.status = 'completed' AND ca.scheduled_at <= NOW()) OR ca.status = 'missed' OR (ca.status = 'scheduled' AND ca.scheduled_at <= NOW() - make_interval(mins => ${ATTEMPT_GRACE_MINUTES}))`,
    completed: `ca.status = 'completed' AND ca.scheduled_at <= NOW()`,
    missed: `ca.status = 'missed' OR (ca.status = 'scheduled' AND ca.scheduled_at <= NOW() - make_interval(mins => ${ATTEMPT_GRACE_MINUTES}))`,
    upcoming: `ca.status = 'scheduled' AND ca.scheduled_at > NOW()`,
  }[status] || 'FALSE';
  const attemptNumberClause = number > 0 ? `AND ca.attempt_number = ${Math.floor(number)}` : '';
  const cte = `WITH ownership AS (
    SELECT a.lead_id, COALESCE(a.assigned_to_user_id, a.user_id) AS counselor_id, a.assigned_at AS ownership_start,
      COALESCE(a.unassigned_at, LEAD(a.assigned_at) OVER (PARTITION BY a.lead_id ORDER BY a.assigned_at, a.id), 'infinity'::timestamptz) AS ownership_end
    FROM lead_assignments a WHERE COALESCE(a.assigned_to_user_id, a.user_id) IS NOT NULL
  ), attempts AS (
    SELECT ca.id, ca.sequence_id, ca.lead_id, ca.attempt_number, ca.attempt_number - 1 AS retry_number, ca.trigger_reason AS issue_at_retry, ca.trigger_reason, ca.outcome, ca.status, ca.scheduled_at, ca.attempted_at, ca.delay_minutes,
      ca.responsible_user_id, ca.completed_by_user_id, ca.is_final_attempt, seq.status AS sequence_status,
      l.full_name, l.phone, l.call_status::text AS call_status
    FROM ownership o JOIN lead_call_attempts ca ON ca.lead_id = o.lead_id AND ca.scheduled_at >= o.ownership_start AND ca.scheduled_at < o.ownership_end
    JOIN lead_call_attempt_sequences seq ON seq.id = ca.sequence_id
    JOIN leads l ON l.id = ca.lead_id
    WHERE o.counselor_id = $1::uuid AND ${scope} AND ${dates} AND ca.attempt_number > 1 AND ca.status IN ('scheduled', 'completed', 'missed')
  ), progression_leads AS (
    SELECT DISTINCT ON (lead_id, sequence_id) lead_id, sequence_id, full_name, phone, call_status, sequence_status
      FROM attempts
     ORDER BY lead_id, sequence_id
  ), progression_attempts AS (
    SELECT ca.id, ca.sequence_id, ca.lead_id, ca.attempt_number, ca.attempt_number - 1 AS retry_number,
      ca.trigger_reason AS issue_at_retry, ca.trigger_reason, ca.outcome, ca.status, ca.scheduled_at, ca.attempted_at,
      ca.delay_minutes, ca.responsible_user_id, ca.completed_by_user_id, ca.is_final_attempt, seq.status AS sequence_status,
      CASE
        WHEN ca.attempt_number = 1 THEN 'initial_issue'
        WHEN ca.status = 'completed' THEN 'completed'
        WHEN ca.status = 'cancelled' OR seq.status <> 'active' THEN 'not_required'
        WHEN ca.status = 'missed' OR (ca.status = 'scheduled' AND ca.scheduled_at <= NOW() - make_interval(mins => ${ATTEMPT_GRACE_MINUTES})) THEN 'missed'
        WHEN ca.status = 'scheduled' THEN 'upcoming'
        ELSE 'not_required'
      END AS attempt_state,
      CASE
        WHEN ca.status = 'scheduled' AND ca.scheduled_at <= NOW() - make_interval(mins => ${ATTEMPT_GRACE_MINUTES})
          THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - ca.scheduled_at)) / 60))::int
        WHEN ca.status = 'missed'
          THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - ca.scheduled_at)) / 60))::int
        ELSE NULL
      END AS overdue_by_minutes,
      CASE
        WHEN ca.status = 'scheduled' AND ca.scheduled_at > NOW()
          THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (ca.scheduled_at - NOW())) / 60))::int
        ELSE NULL
      END AS available_in_minutes
    FROM progression_leads pl
    JOIN lead_call_attempts ca ON ca.sequence_id = pl.sequence_id
    JOIN lead_call_attempt_sequences seq ON seq.id = ca.sequence_id
  )`;
  const { rows: totalsRows } = await query(`${cte} SELECT
    COUNT(*) FILTER (WHERE (status = 'completed' AND scheduled_at <= NOW()) OR status = 'missed' OR (status = 'scheduled' AND scheduled_at <= NOW() - make_interval(mins => ${ATTEMPT_GRACE_MINUTES})))::int AS due_count,
    COUNT(*) FILTER (WHERE status = 'completed' AND scheduled_at <= NOW())::int AS completed_count,
    COUNT(*) FILTER (WHERE status = 'missed' OR (status = 'scheduled' AND scheduled_at <= NOW() - make_interval(mins => ${ATTEMPT_GRACE_MINUTES})))::int AS missed_count,
    COUNT(*) FILTER (WHERE status = 'scheduled' AND scheduled_at > NOW())::int AS upcoming_count,
    COALESCE((
      SELECT jsonb_object_agg(number_counts.attempt_number, number_counts.count)
      FROM (
        SELECT attempt_number, COUNT(*)::int AS count
        FROM attempts
        GROUP BY attempt_number
      ) number_counts
    ), '{}'::jsonb) AS attempt_numbers
    FROM attempts`, params);
  const totals = totalsRows[0] || {};
  const baseParams = [...params];
  const { rows: [count] } = await query(`${cte} SELECT COUNT(*)::int AS total FROM attempts ca WHERE ${statusClause} ${attemptNumberClause}`, params);
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(`${cte} SELECT *, CASE WHEN status = 'completed' THEN 'Completed' WHEN status = 'missed' OR (status = 'scheduled' AND scheduled_at <= NOW() - make_interval(mins => ${ATTEMPT_GRACE_MINUTES})) THEN 'Missed' ELSE 'Upcoming' END AS attempt_state
    FROM attempts ca WHERE ${statusClause} ${attemptNumberClause} ORDER BY scheduled_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const progressionStatusClause = {
    all_due: `(p.status = 'completed' AND p.scheduled_at <= NOW()) OR p.status = 'missed' OR (p.status = 'scheduled' AND p.scheduled_at <= NOW() - make_interval(mins => ${ATTEMPT_GRACE_MINUTES}))`,
    completed: `p.status = 'completed' AND p.scheduled_at <= NOW()`,
    missed: `p.status = 'missed' OR (p.status = 'scheduled' AND p.scheduled_at <= NOW() - make_interval(mins => ${ATTEMPT_GRACE_MINUTES}))`,
    upcoming: `p.status = 'scheduled' AND p.scheduled_at > NOW()`,
  }[status] || 'FALSE';
  const progressionResult = await query(`${cte}
    SELECT pl.lead_id, pl.full_name, pl.phone, pl.call_status,
      CASE WHEN pl.sequence_status = 'active' THEN GREATEST(0, 4 - MAX(pa.attempt_number)) ELSE 0 END::int AS remaining_retry_slots,
      COUNT(*) FILTER (WHERE pa.attempt_number > 1 AND pa.attempt_state = 'upcoming')::int AS remaining_retry_count,
      jsonb_agg(jsonb_build_object(
        'id', pa.id,
        'attempt_number', pa.attempt_number,
        'retry_number', pa.retry_number,
        'issue_at_retry', pa.issue_at_retry,
        'trigger_reason', pa.trigger_reason,
        'outcome', pa.outcome,
        'status', pa.status,
        'attempt_state', pa.attempt_state,
        'scheduled_at', pa.scheduled_at,
        'attempted_at', pa.attempted_at,
        'delay_minutes', pa.delay_minutes,
        'overdue_by_minutes', pa.overdue_by_minutes,
        'available_in_minutes', pa.available_in_minutes,
        'is_final_attempt', pa.is_final_attempt,
        'attributed_to_counselor', COALESCE(pa.completed_by_user_id, pa.responsible_user_id) = $1::uuid
      ) ORDER BY pa.attempt_number ASC) AS attempts
    FROM progression_leads pl
    JOIN progression_attempts pa ON pa.lead_id = pl.lead_id AND pa.sequence_id = pl.sequence_id
    WHERE EXISTS (SELECT 1 FROM attempts p WHERE p.lead_id = pl.lead_id AND p.sequence_id = pl.sequence_id AND ${progressionStatusClause})
    GROUP BY pl.lead_id, pl.full_name, pl.phone, pl.call_status, pl.sequence_status
    ORDER BY pl.full_name ASC`, baseParams);
  const progressionRows = progressionResult?.rows || [];
  return {
    rows,
    progression_rows: progressionRows,
    progression_total: progressionRows.length,
    total: Number(count.total),
    page,
    page_size: pageSize,
    totals: { due_count: Number(totals.due_count || 0), completed_count: Number(totals.completed_count || 0), missed_count: Number(totals.missed_count || 0), upcoming_count: Number(totals.upcoming_count || 0) },
  };
}

module.exports = { getCounselorRows, summary, teams, filters, drilldown, _buildQuery: buildQuery };
