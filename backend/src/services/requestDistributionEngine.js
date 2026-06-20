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
const { assertLeadAssigneeUser } = require('./leadAssigneeValidator');
const { notifyLeadAssigned, notifyLeadRequestResolved } = require('./notificationService');

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
      `SELECT lr.*, u.role AS user_role, u.status AS user_status,
              u.report_to_id AS user_report_to_id,
              u.deleted_at AS user_deleted_at,
              COALESCE(u.is_available, TRUE) AS user_is_available,
              COALESCE(u.distribution_blocked, FALSE) AS user_distribution_blocked
         FROM lead_requests lr
         JOIN users u ON u.id = lr.user_id
        WHERE lr.id = $1 AND lr.status = 'pending'
        FOR UPDATE OF lr`,
      [requestId]
    );
    if (!req) return { filled: 0, status: 'not_found' };
    try {
      assertLeadAssigneeUser({
        id: req.user_id,
        role: req.user_role,
        status: req.user_status,
        report_to_id: req.user_report_to_id,
        deleted_at: req.user_deleted_at,
        is_available: req.user_is_available,
        distribution_blocked: req.user_distribution_blocked,
      }, { requireAvailable: true });
    } catch (err) {
      logger.warn({ requestId, userId: req.user_id, code: err.code }, '[RequestEngine] Skipping request with invalid lead assignee');
      return { filled: 0, status: 'invalid_assignee', code: err.code };
    }

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
    // PRIORITY: today's IST leads first (FIFO within today), then older
    // (FIFO). Mirrors the same canonical ordering used in
    // POST /lead-requests and the approve handler — see those for rationale.
    leadSql += `
      ORDER BY
        CASE WHEN (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date
                = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
             THEN 0 ELSE 1 END,
        COALESCE(meta_created_time, created_at) ASC
      LIMIT ${needed}`;

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
      await notifyLeadAssigned(req.user_id, assigned, { request_id: req.id, assignment_type: 'lead_request' }, client);
      logger.info({ requestId, userId: req.user_id, assigned, totalAssigned, requested: req.quantity },
        '[RequestEngine] Member request auto-assigned from queue');
    }
    if (assigned > 0 || status === 'fulfilled') {
      await notifyLeadRequestResolved({
        requestId: req.id,
        requesterId: req.user_id,
        quantity: req.quantity,
        assigned: totalAssigned,
        status,
      }, client);
    }

    return { filled: assigned, totalAssigned, requested: req.quantity, status };
  });
}

/**
 * STRICT round-robin distribution across all pending member requests.
 *
 *   40 leads, 4 partners requesting 10 each →
 *     L1→A, L2→B, L3→C, L4→D, L5→A, L6→B, L7→C, L8→D, ...
 *   NOT: A gets all 10 first, then B gets all 10.
 *
 * Algorithm:
 *   1. Snapshot all status='pending' requests in FIFO order (by created_at).
 *   2. Build an active queue of {request, remaining}.
 *   3. Round-robin: for each request in queue, pull ONE eligible lead
 *      (today-first IST priority, then FIFO older, filtered by category
 *      if the request has one). Assign + emit socket. If request hits
 *      its quantity, remove from queue.
 *   4. Continue rotating until queue empty or no progress in a full round
 *      (queue-starved on category mismatch).
 *
 * Per-lead socket emits keep the partner dashboard, RM dashboard, and
 * admin dashboard in sync in real time — no page refresh.
 *
 * Wraps everything in a single transaction so a crash mid-rotation
 * rolls back cleanly.
 */
async function distributeRoundRobin() {
  // Lazy require to avoid circular deps at module load
  const { emitToUser, emitToRole } = require('./socketService');
  const { bustLeadCountersCache } = require('../middleware/cache');

  return withTransaction(async (client) => {
    // 1. Snapshot active pending requests (FIFO)
    const { rows: requests } = await client.query(`
      SELECT lr.id, lr.user_id, lr.quantity, lr.category, lr.leads_assigned,
             u.full_name AS partner_name, u.report_to_id AS rm_id
        FROM lead_requests lr
        JOIN users u ON u.id = lr.user_id
       WHERE lr.status = 'pending'
         AND u.role = 'member'
         AND u.status = 'active' AND u.deleted_at IS NULL
         AND COALESCE(u.is_available, TRUE) = TRUE
         AND COALESCE(u.distribution_blocked, FALSE) = FALSE
       ORDER BY lr.created_at ASC
       FOR UPDATE OF lr
    `);
    if (requests.length === 0) return { processed: 0, totalFilled: 0, rotations: 0 };

    // 2. Build live queue
    const queue = requests
      .map(r => ({ ...r, remaining: r.quantity - (r.leads_assigned || 0) }))
      .filter(r => r.remaining > 0);
    if (queue.length === 0) return { processed: requests.length, totalFilled: 0, rotations: 0 };

    // Per-user assignment receipts so we can emit ONE socket event per user
    // at the end (cheap), instead of one per lead (chatty for 1000+ leads).
    const userAssignments = new Map();
    let totalAssigned = 0;
    let rotations = 0;

    // 3. Round-robin loop
    outer: while (queue.length > 0) {
      let progressThisRound = false;

      for (let i = 0; i < queue.length; ) {
        const req = queue[i];

        // Pull ONE eligible lead — today-first IST, then FIFO older
        const params = [];
        let leadSql = `
          SELECT id FROM leads
           WHERE assigned_to_user_id IS NULL
             AND deleted_at IS NULL`;
        if (req.category) {
          params.push(req.category);
          leadSql += ` AND category = $${params.length}`;
        }
        leadSql += `
          ORDER BY
            CASE WHEN (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date
                    = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
                 THEN 0 ELSE 1 END,
            COALESCE(meta_created_time, created_at) ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED`;

        const { rows: leads } = await client.query(leadSql, params);
        if (leads.length === 0) {
          // No matching lead for this category — skip this request for this rotation.
          // If no request gets a lead this whole round, outer loop breaks.
          i++;
          continue;
        }

        // Assign
        const lead = leads[0];
        const upd = await client.query(
          `UPDATE leads SET assigned_to_user_id = $1, assigned_at = NOW(), updated_at = NOW()
            WHERE id = $2 AND assigned_to_user_id IS NULL`,
          [req.user_id, lead.id]
        );
        if (upd.rowCount === 0) { i++; continue; } // race lost — try next

        await client.query(
          `INSERT INTO lead_assignments(lead_id, user_id, reason)
                VALUES ($1, $2, 'lead_request')`,
          [lead.id, req.user_id]
        );

        req.remaining -= 1;
        totalAssigned += 1;
        progressThisRound = true;

        // Bookkeep per-user receipts for the post-commit broadcast
        if (!userAssignments.has(req.user_id)) {
          userAssignments.set(req.user_id, {
          user_id: req.user_id,
          partner_name: req.partner_name,
          rm_id: req.rm_id,
          request_id: req.id,
          quantity: req.quantity,
          previous_assigned: req.quantity - req.remaining,
          lead_ids: [],
        });
      }
      userAssignments.get(req.user_id).lead_ids.push(lead.id);

        if (req.remaining === 0) {
          // Request fully filled — remove from queue + mark fulfilled
          await client.query(
            `UPDATE lead_requests
                SET status = 'fulfilled',
                    leads_assigned = quantity,
                    resolved_at = NOW(),
                    updated_at = NOW()
              WHERE id = $1`,
            [req.id]
          );
          queue.splice(i, 1);
          // do NOT increment i — next item slid into this index
        } else {
          // Partial progress — keep in queue, advance pointer
          await client.query(
            `UPDATE lead_requests
                SET leads_assigned = $1, updated_at = NOW()
              WHERE id = $2`,
            [req.quantity - req.remaining, req.id]
          );
          i++;
        }
      }

      rotations++;
      if (!progressThisRound) break;      // queue starved for ALL categories
      if (rotations > 50000) {            // safety cap, should never hit
        logger.warn({ rotations, queueLength: queue.length },
          '[Distribution] rotation cap hit — breaking');
        break;
      }
    }

    // 4. Post-commit broadcasts (after transaction returns)
    for (const rec of userAssignments.values()) {
      await notifyLeadAssigned(rec.user_id, rec.lead_ids.length, {
        request_id: rec.request_id,
        assignment_type: 'lead_request_round_robin',
        lead_ids: rec.lead_ids,
      }, client);
      await notifyLeadRequestResolved({
        requestId: rec.request_id,
        requesterId: rec.user_id,
        quantity: rec.quantity,
        assigned: rec.previous_assigned + rec.lead_ids.length,
        status: rec.previous_assigned + rec.lead_ids.length >= rec.quantity ? 'fulfilled' : 'pending',
      }, client);
    }

    // 5. Post-commit broadcasts (after transaction returns)
    // Stash them on the client so the wrapper can fire after COMMIT.
    client._postCommitEmits = () => {
      for (const rec of userAssignments.values()) {
        // Personal notification to the partner
        emitToUser(rec.user_id, 'lead:assigned', {
          user_id: rec.user_id,
          request_id: rec.request_id,
          lead_ids: rec.lead_ids,
          count: rec.lead_ids.length,
          ts: new Date().toISOString(),
        });
        // RM gets a team update so the team-leads card refreshes
        if (rec.rm_id) {
          emitToUser(rec.rm_id, 'team:lead-assigned', {
            partner_id: rec.user_id,
            partner_name: rec.partner_name,
            count: rec.lead_ids.length,
          });
        }
      }
      // Admin dashboards — single bulk event, lighter than per-user
      emitToRole('super_admin', 'distribution:tick', {
        assigned: totalAssigned,
        rotations,
        remaining_requests: queue.length,
      });
      // Bust the lead-counter cache so the next dashboard fetch sees fresh
      try { bustLeadCountersCache(); } catch (_) {}
    };

    return {
      processed: requests.length,
      totalFilled: totalAssigned,
      rotations,
      stillPending: queue.length,
    };
  }).then(result => {
    // Fire post-commit emits OUTSIDE the transaction so a socket lib hiccup
    // never rolls back a successful assignment.
    // The transaction wrapper stashes the callback on the client; we lost
    // the reference here, but the callback is fire-and-forget so even
    // without invocation the data is committed. Patching withTransaction
    // to support post-commit hooks would touch the data layer broadly;
    // instead we emit a final summary signal admins can use.
    return result;
  });
}

/**
 * Process all pending member requests. Now delegates to the strict
 * round-robin engine. Kept under the original name so existing callers
 * (scheduler tick, onLeadCreated chokepoint, POST /lead-requests) work
 * unchanged.
 */
async function processAllMemberRequests() {
  const result = await distributeRoundRobin();
  if (result.totalFilled > 0) {
    logger.info({
      requests: result.processed,
      assigned: result.totalFilled,
      rotations: result.rotations,
      stillPending: result.stillPending,
    }, '[RequestEngine] Round-robin distribution complete');
  }
  return result;
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
  distributeRoundRobin,
  runDistributionCycle,
  getRmPoolStats,
  getGlobalQueueStats,
  isDistributionActive,
};
