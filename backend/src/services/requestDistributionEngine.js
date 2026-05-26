/**
 * Request-Based Lead Distribution Engine
 *
 * Workflow:
 *   Global Queue  ──(RM request)──>  RM Pool  ──(Member request)──>  Member
 *
 * 1. RMs request N leads from the global queue (unassigned leads).
 *    Engine moves leads into the RM's pool (pool_rm_id = RM, assigned_to_user_id = NULL).
 *
 * 2. Members (freshers/veterans/traders/partners) request leads from their RM.
 *    Engine moves leads from RM pool to the member (assigned_to_user_id = member).
 *
 * 3. During ACTIVE hours (8 AM – 7 PM IST), the engine runs continuously
 *    every 30 seconds, auto-fulfilling pending requests.
 *
 * 4. During STORAGE mode (7 PM – 8 AM IST), incoming leads are only stored.
 *    No assignments happen. Requests accumulate for morning fulfillment.
 */
const { query, withTransaction } = require('../config/database');
const logger = require('../utils/logger');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Check if distribution is active (avoids circular import with distributionScheduler). */
async function isDistributionActive() {
  try {
    const { rows: [enabled] } = await query(`SELECT value FROM distribution_settings WHERE key = 'auto_distribution_enabled'`);
    if ((enabled?.value || 'true') !== 'true') return false;
    const { rows: [start] } = await query(`SELECT value FROM distribution_settings WHERE key = 'distribution_start_hour'`);
    const { rows: [end] } = await query(`SELECT value FROM distribution_settings WHERE key = 'distribution_end_hour'`);
    const startHour = parseInt(start?.value || '8', 10);
    const endHour = parseInt(end?.value || '19', 10);
    const ist = new Date(Date.now() + IST_OFFSET_MS);
    const hour = ist.getUTCHours();
    return hour >= startHour && hour < endHour;
  } catch {
    return false;
  }
}

// ─── RM Request: Pull leads from global queue into RM pool ────────────

/**
 * Fulfill a single RM request by pulling leads from the global queue.
 * Returns { filled, remaining }.
 */
async function fulfillRmRequest(requestId) {
  return withTransaction(async (client) => {
    // Lock the request row
    const { rows: [req] } = await client.query(
      `SELECT * FROM rm_lead_requests WHERE id = $1 AND status IN ('pending', 'partial') FOR UPDATE`,
      [requestId]
    );
    if (!req) return { filled: 0, remaining: 0, status: 'not_found' };

    const needed = req.quantity - req.fulfilled_count;
    if (needed <= 0) {
      await client.query(
        `UPDATE rm_lead_requests SET status = 'fulfilled' WHERE id = $1`,
        [requestId]
      );
      return { filled: 0, remaining: 0, status: 'fulfilled' };
    }

    // Find unassigned leads from global queue (not in any RM pool)
    let leadSql = `
      SELECT id FROM leads
       WHERE assigned_to_user_id IS NULL
         AND pool_rm_id IS NULL
         AND deleted_at IS NULL
    `;
    const params = [];
    if (req.category) {
      params.push(req.category);
      leadSql += ` AND category = $${params.length}`;
    }
    leadSql += ` ORDER BY created_at ASC LIMIT ${needed}`;

    const { rows: leads } = await client.query(leadSql, params);

    let filled = 0;
    for (const lead of leads) {
      await client.query(
        `UPDATE leads SET pool_rm_id = $1, pool_assigned_at = NOW(), updated_at = NOW()
          WHERE id = $2 AND pool_rm_id IS NULL AND assigned_to_user_id IS NULL`,
        [req.rm_id, lead.id]
      );
      // Record in lead_assignments
      await client.query(
        `INSERT INTO lead_assignments(lead_id, user_id, reason)
           VALUES ($1, $2, 'rm_pool')`,
        [lead.id, req.rm_id]
      );
      filled++;
    }

    const newFulfilled = req.fulfilled_count + filled;
    const remaining = req.quantity - newFulfilled;
    const newStatus = remaining <= 0 ? 'fulfilled' : (filled > 0 ? 'partial' : 'pending');

    await client.query(
      `UPDATE rm_lead_requests SET fulfilled_count = $1, status = $2 WHERE id = $3`,
      [newFulfilled, newStatus, requestId]
    );

    if (filled > 0) {
      logger.info({ requestId, rmId: req.rm_id, filled, remaining, status: newStatus },
        '[RequestEngine] RM request fulfilled');
    }

    return { filled, remaining, status: newStatus };
  });
}

/**
 * Process all pending/partial RM requests. Called by scheduler.
 */
async function processAllRmRequests() {
  const { rows: requests } = await query(
    `SELECT id, rm_id, quantity, fulfilled_count, category
       FROM rm_lead_requests
      WHERE status IN ('pending', 'partial')
      ORDER BY created_at ASC`
  );

  if (requests.length === 0) return { processed: 0, totalFilled: 0 };

  let totalFilled = 0;
  for (const req of requests) {
    try {
      const result = await fulfillRmRequest(req.id);
      totalFilled += result.filled;
    } catch (err) {
      logger.error({ requestId: req.id, err: err.message }, '[RequestEngine] Failed to fulfill RM request');
    }
  }

  if (totalFilled > 0) {
    logger.info({ requests: requests.length, totalFilled }, '[RequestEngine] RM requests processed');
  }

  return { processed: requests.length, totalFilled };
}

// ─── Member Request: Pull leads from global queue to member ───────────

/**
 * Fulfill a member's lead request directly from the global queue.
 * Members request → system auto-assigns matching leads. No RM approval needed.
 */
async function fulfillMemberRequest(requestId) {
  return withTransaction(async (client) => {
    // Lock the request
    const { rows: [req] } = await client.query(
      `SELECT lr.*
         FROM lead_requests lr
        WHERE lr.id = $1 AND lr.status = 'pending'
        FOR UPDATE OF lr`,
      [requestId]
    );
    if (!req) return { filled: 0, status: 'not_found' };

    const needed = req.quantity - (req.leads_assigned || 0);
    if (needed <= 0) {
      await client.query(`UPDATE lead_requests SET status = 'fulfilled' WHERE id = $1`, [requestId]);
      return { filled: 0, status: 'fulfilled' };
    }

    // Find leads from global queue (unassigned)
    let leadSql = `
      SELECT id FROM leads
       WHERE assigned_to_user_id IS NULL
         AND deleted_at IS NULL
    `;
    const params = [];
    if (req.category) {
      params.push(req.category);
      leadSql += ` AND category = $${params.length}`;
    }
    leadSql += ` ORDER BY created_at ASC LIMIT ${needed}`;

    const { rows: leads } = await client.query(leadSql, params);

    let assigned = 0;
    for (const lead of leads) {
      const res = await client.query(
        `UPDATE leads SET assigned_to_user_id = $1, assigned_at = NOW(), updated_at = NOW()
          WHERE id = $2 AND assigned_to_user_id IS NULL`,
        [req.user_id, lead.id]
      );
      if (res.rowCount > 0) {
        await client.query(
          `INSERT INTO lead_assignments(lead_id, user_id, reason) VALUES ($1, $2, 'lead_request')`,
          [lead.id, req.user_id]
        );
        assigned++;
      }
    }

    const totalAssigned = (req.leads_assigned || 0) + assigned;
    const status = totalAssigned >= req.quantity ? 'fulfilled' : (assigned > 0 ? 'pending' : 'pending');
    const resolvedAt = status === 'fulfilled' ? new Date() : null;
    await client.query(
      `UPDATE lead_requests SET status = $1, leads_assigned = $2,
              resolved_at = COALESCE($3, resolved_at),
              updated_at = NOW()
        WHERE id = $4`,
      [status, totalAssigned, resolvedAt, requestId]
    );

    if (assigned > 0) {
      logger.info({ requestId, userId: req.user_id, assigned, totalAssigned, requested: req.quantity },
        '[RequestEngine] Member request auto-assigned from queue');
    }

    return { filled: assigned, totalAssigned, requested: req.quantity, status };
  });
}

/**
 * Process all pending member requests. Called by scheduler.
 */
async function processAllMemberRequests() {
  const { rows: requests } = await query(
    `SELECT lr.id, lr.user_id, lr.quantity, lr.category, u.report_to_id AS rm_id
       FROM lead_requests lr
       JOIN users u ON u.id = lr.user_id
      WHERE lr.status = 'pending'
      ORDER BY lr.created_at ASC`
  );

  if (requests.length === 0) return { processed: 0, totalFilled: 0 };

  let totalFilled = 0;
  for (const req of requests) {
    try {
      const result = await fulfillMemberRequest(req.id);
      totalFilled += result.filled;
    } catch (err) {
      logger.error({ requestId: req.id, err: err.message }, '[RequestEngine] Failed to fulfill member request');
    }
  }

  if (totalFilled > 0) {
    logger.info({ requests: requests.length, totalFilled }, '[RequestEngine] Member requests processed');
  }

  return { processed: requests.length, totalFilled };
}

// ─── Combined Engine Tick ─────────────────────────────────────────────

/**
 * Run one distribution cycle:
 *   1. Fill pending member requests from global queue
 *   2. Fill any RM pool requests (if used via admin)
 *
 * Only runs during active distribution hours (8 AM – 7 PM IST).
 */
async function runDistributionCycle() {
  const active = await isDistributionActive();
  if (!active) return { active: false, member: null };

  const member = await processAllMemberRequests();

  return { active: true, member };
}

// ─── RM Pool Stats ────────────────────────────────────────────────────

/**
 * Get RM pool statistics for a specific RM.
 */
async function getRmPoolStats(rmId) {
  const { rows: [stats] } = await query(`
    SELECT
      (SELECT COUNT(*) FROM leads WHERE pool_rm_id = $1 AND assigned_to_user_id IS NULL AND deleted_at IS NULL) AS pool_count,
      (SELECT COUNT(*) FROM leads WHERE pool_rm_id = $1 AND assigned_to_user_id IS NOT NULL AND deleted_at IS NULL) AS assigned_count,
      (SELECT COUNT(*) FROM rm_lead_requests WHERE rm_id = $1 AND status IN ('pending', 'partial')) AS pending_requests,
      (SELECT SUM(quantity - fulfilled_count) FROM rm_lead_requests WHERE rm_id = $1 AND status IN ('pending', 'partial')) AS pending_quantity
  `, [rmId]);

  return {
    pool_count: parseInt(stats.pool_count, 10),
    assigned_count: parseInt(stats.assigned_count, 10),
    pending_requests: parseInt(stats.pending_requests, 10),
    pending_quantity: parseInt(stats.pending_quantity || '0', 10),
  };
}

/**
 * Get global queue stats.
 */
async function getGlobalQueueStats() {
  const { rows: [stats] } = await query(`
    SELECT
      COUNT(*) FILTER (WHERE pool_rm_id IS NULL AND assigned_to_user_id IS NULL) AS global_queue,
      COUNT(*) FILTER (WHERE pool_rm_id IS NOT NULL AND assigned_to_user_id IS NULL) AS in_rm_pools,
      COUNT(*) FILTER (WHERE assigned_to_user_id IS NOT NULL) AS assigned_to_members
    FROM leads
    WHERE deleted_at IS NULL
  `);

  return {
    global_queue: parseInt(stats.global_queue, 10),
    in_rm_pools: parseInt(stats.in_rm_pools, 10),
    assigned_to_members: parseInt(stats.assigned_to_members, 10),
  };
}

module.exports = {
  fulfillRmRequest,
  processAllRmRequests,
  fulfillMemberRequest,
  processAllMemberRequests,
  runDistributionCycle,
  getRmPoolStats,
  getGlobalQueueStats,
};
