/**
 * Lead Distribution Engine
 *
 * Decides which member a new lead should be assigned to, based on the active
 * distribution_rule for the lead's form (or the default rule).
 *
 * Strategies:
 *   - round_robin    : cycle through eligible members alphabetically by id
 *   - weighted       : weight by users.distribution_weight (more weight => more leads)
 *   - priority_queue : fewest current-day-pending wins (load balancing)
 *   - manual         : do not auto-assign (returns null)
 *
 * Race-safety: the rule's rr_state row is locked with SELECT ... FOR UPDATE
 * inside a transaction; eligible members are filtered by daily_lead_cap.
 */
const { withTransaction, query } = require('../config/database');
const logger = require('../utils/logger');
const { validateLeadAssignee } = require('./leadAssigneeValidator');
const { notifyLeadAssigned } = require('./notificationService');
const { getAssignmentSettings, isInsideAssignmentWindow } = require('./leadAssignmentEngine');

const FALLBACK_RULE_NAME = '__default__';

async function getActiveRule(client, formId) {
  // form-specific rule first, then null-form default
  const { rows } = await client.query(
    `SELECT * FROM distribution_rules
      WHERE is_active = TRUE AND (form_id = $1 OR form_id IS NULL)
      ORDER BY (form_id IS NULL) ASC, priority ASC
      LIMIT 1`,
    [formId || null]
  );
  return rows[0] || null;
}

async function getEligibleMembers(client, rule) {
  // Members who:
  //   - role = member
  //   - status = active AND is_available = true
  //   - NOT distribution_blocked (pending-work blocking)
  //   - belong to rule.eligible_user_ids if specified
  //   - have not exceeded daily_lead_cap today
  const params = [];
  let where = `u.role IN ('member', 'partner') AND u.status = 'active' AND u.is_available = TRUE
               AND u.distribution_blocked = FALSE AND u.deleted_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM users rm
                  WHERE rm.id = u.report_to_id
                    AND rm.role = 'rm'
                    AND (
                      rm.status <> 'active'
                      OR rm.deleted_at IS NOT NULL
                      OR COALESCE(rm.is_available, TRUE) = FALSE
                    )
               )`;

  if (rule.eligible_user_ids && rule.eligible_user_ids.length > 0) {
    params.push(rule.eligible_user_ids);
    where += ` AND u.id = ANY($${params.length}::uuid[])`;
  }

  const sql = `
    WITH today_counts AS (
      SELECT assigned_to_user_id, COUNT(*) AS cnt
        FROM leads
       WHERE assigned_at >= CURRENT_DATE
         AND deleted_at IS NULL
       GROUP BY assigned_to_user_id
    )
    SELECT u.id, u.full_name, u.distribution_weight, u.daily_lead_cap,
           COALESCE(tc.cnt, 0) AS today_count,
           (SELECT COUNT(*) FROM leads l
              WHERE l.assigned_to_user_id = u.id AND l.is_pending = TRUE AND l.deleted_at IS NULL
           ) AS pending_count
      FROM users u
      LEFT JOIN today_counts tc ON tc.assigned_to_user_id = u.id
     WHERE ${where}
       AND COALESCE(tc.cnt, 0) < u.daily_lead_cap
     ORDER BY u.id ASC
  `;
  const { rows } = await client.query(sql, params);
  return rows;
}

/**
 * Check all members for pending-work overload and auto-block.
 * Called by the scheduler after each distribution cycle.
 */
async function checkPendingBlocking() {
  const { rows: [setting] } = await query(
    `SELECT value FROM distribution_settings WHERE key = 'pending_block_threshold'`
  ).catch(() => ({ rows: [{ value: '3' }] }));
  const threshold = parseInt(setting?.value || '3', 10);

  // Find members exceeding pending threshold
  const { rows: overloaded } = await query(`
    SELECT u.id, u.full_name,
           COUNT(l.id) AS pending_count,
           (SELECT COUNT(*) FROM leads l2
              WHERE l2.assigned_to_user_id = u.id AND l2.deleted_at IS NULL) AS total_assigned,
           (SELECT COUNT(*) FROM leads l3
              WHERE l3.assigned_to_user_id = u.id AND l3.deleted_at IS NULL
                AND l3.call_status <> 'not_called') AS worked_count
      FROM users u
      JOIN leads l ON l.assigned_to_user_id = u.id
        AND l.is_pending = TRUE AND l.deleted_at IS NULL
     WHERE u.role = 'member' AND u.status = 'active'
       AND u.distribution_blocked = FALSE AND u.deleted_at IS NULL
     GROUP BY u.id HAVING COUNT(l.id) >= $1
  `, [threshold]);

  for (const u of overloaded) {
    await query(
      `UPDATE users SET distribution_blocked = TRUE,
                        distribution_blocked_reason = $1,
                        distribution_blocked_at = NOW()
         WHERE id = $2`,
      [`${u.pending_count} pending leads (threshold: ${threshold})`, u.id]
    );
    // Create approval request
    await query(
      `INSERT INTO distribution_approvals (user_id, pending_count, total_assigned, worked_count)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
      [u.id, u.pending_count, u.total_assigned, u.worked_count]
    );
    logger.info({ userId: u.id, name: u.full_name, pending: u.pending_count },
      '[Distribution] Member blocked — pending work exceeds threshold');
  }

  return overloaded.length;
}

module.exports.checkPendingBlocking = checkPendingBlocking;

async function pickRoundRobin(client, rule, members) {
  // load (and lock) the rr_state row for this rule
  await client.query(
    `INSERT INTO rr_state(rule_id) VALUES ($1) ON CONFLICT (rule_id) DO NOTHING`,
    [rule.id]
  );
  const { rows: [state] } = await client.query(
    `SELECT * FROM rr_state WHERE rule_id = $1 FOR UPDATE`,
    [rule.id]
  );

  let idx = 0;
  if (state.last_user_id) {
    const lastIdx = members.findIndex(m => m.id === state.last_user_id);
    idx = lastIdx === -1 ? 0 : (lastIdx + 1) % members.length;
  }
  const pick = members[idx];

  await client.query(
    `UPDATE rr_state SET last_user_id = $1, updated_at = NOW() WHERE rule_id = $2`,
    [pick.id, rule.id]
  );
  return pick;
}

function pickWeighted(members) {
  const totalWeight = members.reduce((s, m) => s + Math.max(1, m.distribution_weight), 0);
  let r = Math.random() * totalWeight;
  for (const m of members) {
    r -= Math.max(1, m.distribution_weight);
    if (r <= 0) return m;
  }
  return members[members.length - 1];
}

function pickPriorityQueue(members) {
  // pick the member with fewest pending leads; tiebreak by today_count
  return [...members].sort(
    (a, b) => (a.pending_count - b.pending_count) || (a.today_count - b.today_count)
  )[0];
}

/**
 * Assign one lead. Mutates the leads row inside the same transaction.
 * Returns { userId, ruleId, strategy } or { reason } if not assigned.
 */
async function assignLead(leadId) {
  return withTransaction(async (client) => {
    const settings = await getAssignmentSettings(client);
    if (!settings.autoAssignEnabled) {
      return { success: true, skipped: true, reason: 'AUTO_DISTRIBUTION_DISABLED', assigned: 0 };
    }
    if (!isInsideAssignmentWindow(new Date(), settings)) {
      return { success: true, skipped: true, reason: 'OUTSIDE_DISTRIBUTION_WINDOW', assigned: 0 };
    }

    const { rows: leadRows } = await client.query(
      `SELECT id, meta_form_id, assigned_to_user_id FROM leads WHERE id = $1 FOR UPDATE`,
      [leadId]
    );
    const lead = leadRows[0];
    if (!lead) return { reason: 'LEAD_NOT_FOUND' };
    if (lead.assigned_to_user_id) return { reason: 'ALREADY_ASSIGNED', userId: lead.assigned_to_user_id };

    const rule = await getActiveRule(client, lead.meta_form_id);
    if (!rule) {
      logger.warn({ leadId }, 'No active distribution rule found');
      return { reason: 'NO_RULE' };
    }

    if (rule.strategy !== 'round_robin') {
      return { reason: 'DISTRIBUTION_METHOD_DISABLED', ruleId: rule.id, strategy: rule.strategy };
    }

    const members = await getEligibleMembers(client, rule);
    if (members.length === 0) {
      logger.warn({ leadId, ruleId: rule.id }, 'No eligible members for distribution');
      return { reason: 'NO_ELIGIBLE_MEMBERS', ruleId: rule.id };
    }

    const pick = await pickRoundRobin(client, rule, members);

    await client.query(
      `UPDATE leads
          SET assigned_to_user_id = $1,
              assigned_at         = NOW(),
              assigned_by_rule_id = $2,
              stage               = CASE WHEN stage = 'new' THEN 'new' ELSE stage END,
              updated_at          = NOW()
        WHERE id = $3`,
      [pick.id, rule.id, leadId]
    );
    await client.query(
      `INSERT INTO lead_assignments(lead_id, user_id, rule_id, reason)
         VALUES ($1, $2, $3, 'auto')`,
      [leadId, pick.id, rule.id]
    );
    await notifyLeadAssigned({
      leadId,
      assignedToUserId: pick.id,
      assignmentSource: 'auto',
      metadata: { rule_id: rule.id, strategy: rule.strategy },
    }, client);

    logger.info({ leadId, userId: pick.id, ruleId: rule.id, strategy: rule.strategy }, 'Lead assigned');
    return { userId: pick.id, ruleId: rule.id, strategy: rule.strategy };
  });
}

/** Manual (re)assignment by an admin/RM */
async function reassignLead(leadId, toUserId, byUserId, reason = 'reassign') {
  return withTransaction(async (client) => {
    await validateLeadAssignee(client, toUserId);

    const { rows: [prev] } = await client.query(
      `SELECT assigned_to_user_id FROM leads WHERE id = $1 FOR UPDATE`,
      [leadId]
    );
    if (!prev) throw new Error('Lead not found');

    await client.query(
      `UPDATE lead_assignments SET unassigned_at = NOW()
        WHERE lead_id = $1 AND unassigned_at IS NULL`,
      [leadId]
    );
    await client.query(
      `UPDATE leads
          SET assigned_to_user_id = $1,
              assigned_at         = NOW(),
              locked_by_user_id   = NULL,
              locked_until        = NULL
        WHERE id = $2`,
      [toUserId, leadId]
    );
    await client.query(
      `INSERT INTO lead_assignments(lead_id, user_id, assigned_by, reason)
         VALUES ($1, $2, $3, $4)`,
      [leadId, toUserId, byUserId, reason]
    );
    if (prev.assigned_to_user_id !== toUserId) {
      await notifyLeadAssigned({
        leadId,
        assignedToUserId: toUserId,
        assignedBy: byUserId,
        assignmentSource: reason,
        metadata: { previous_user_id: prev.assigned_to_user_id || null },
      }, client);
    }
    return { previous: prev.assigned_to_user_id, current: toUserId };
  });
}

module.exports = { assignLead, reassignLead };
