/**
 * Auto Lead Distribution Scheduler
 *
 * Rules:
 *  - Facebook / Meta leads arrive 24×7 and are stored safely in PostgreSQL.
 *  - Distribution ONLY happens between START_HOUR and END_HOUR in IST (default 08:00–22:00).
 *  - At START_HOUR every morning, all queued (unassigned) leads are distributed in bulk.
 *  - During active hours, new leads are distributed immediately (called by metaService).
 *  - Outside active hours, leads sit in the queue — no loss possible.
 *  - Super Admin can toggle auto_distribution_enabled on/off via API at any time.
 *
 * IST = UTC + 5 hours 30 minutes
 */
const { query } = require('../config/database');
const { assignLead, checkPendingBlocking } = require('./leadDistributionService');
const { runDistributionCycle } = require('./requestDistributionEngine');
const assignmentEngine = require('./leadAssignmentEngine');
const logger = require('../utils/logger');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30

/** Returns the current time object in IST. */
function nowIST() {
  const utc  = Date.now();
  const ist  = new Date(utc + IST_OFFSET_MS);
  return { hour: ist.getUTCHours(), minute: ist.getUTCMinutes(), date: ist };
}

/** Read a setting from the DB (with in-memory fallback). */
async function getSetting(key, fallback) {
  try {
    const { rows } = await query(
      `SELECT value FROM distribution_settings WHERE key = $1`, [key]
    );
    return rows[0]?.value ?? fallback;
  } catch {
    return fallback;
  }
}

/** Returns true if auto-distribution is currently active (enabled + within hours). */
async function isDistributionActive() {
  const enabled = await getSetting('auto_distribution_enabled', 'false');
  if (enabled !== 'true') return false;

  const startHour = parseInt(await getSetting('distribution_start_hour', '8'),  10);
  const endHour   = parseInt(await getSetting('distribution_end_hour',   '22'), 10);
  const { hour }  = nowIST();

  return hour >= startHour && hour < endHour;
}

/**
 * Distribute all queued leads (unassigned, non-deleted, created before now).
 * Called at morning startup (8:00 AM IST) and on-demand by admin.
 */
async function distributeQueue() {
  const { rows } = await query(
    `SELECT id FROM leads
      WHERE assigned_to_user_id IS NULL
        AND deleted_at IS NULL
      ORDER BY created_at ASC`
  );

  if (rows.length === 0) {
    logger.info('[Scheduler] No queued leads to distribute.');
    return { distributed: 0 };
  }

  logger.info(`[Scheduler] Distributing ${rows.length} queued lead(s)...`);
  let success = 0;
  let skipped = 0;

  for (const { id } of rows) {
    try {
      const result = await assignLead(id);
      if (result.userId) success++;
      else skipped++;
    } catch (err) {
      logger.error({ err, leadId: id }, '[Scheduler] Failed to assign lead');
      skipped++;
    }
  }

  logger.info(`[Scheduler] Queue distribution done. Assigned: ${success}, Skipped: ${skipped}`);

  // After distribution, check if any members need to be blocked for pending work overload
  try {
    const blocked = await checkPendingBlocking();
    if (blocked > 0) logger.info(`[Scheduler] ${blocked} member(s) blocked for pending work overload`);
  } catch (err) {
    logger.error({ err }, '[Scheduler] Failed to check pending blocking');
  }

  return { distributed: success, skipped };
}

/** Tick — called every minute by the interval. */
let lastDistributionDay = -1;

async function tick() {
  try {
    const enabled = await getSetting('auto_distribution_enabled', 'false');
    if (enabled !== 'true') return;

    const startHour = parseInt(await getSetting('distribution_start_hour', '8'), 10);
    const { hour, minute, date } = nowIST();
    const today = date.getUTCDate();

    // Trigger morning queue distribution exactly at startHour:00
    if (hour === startHour && minute === 0 && today !== lastDistributionDay) {
      lastDistributionDay = today;
      logger.info(`[Scheduler] ${startHour}:00 IST — starting morning lead distribution`);
      await distributeQueue();
    }

    // Continuous request fulfillment during active hours
    // Runs every tick (60s) — fills RM requests from global queue,
    // then fills member requests from RM pools.
    const active = await isDistributionActive();
    if (active) {
      try {
        const settings = await assignmentEngine.getAssignmentSettings();
        const request = await assignmentEngine.runApprovedRequestFulfillment({ limit: settings.requestFulfillmentLimit });
        const auto = await assignmentEngine.runAutoAssignment({ limit: settings.assignmentTickLimit, reason: 'scheduler_tick' });
        let reassignment = null;
        if (settings.autoReassignEnabled) {
          reassignment = await assignmentEngine.runAutoReassignment({ limit: settings.reassignmentTickLimit });
        }
        if ((request.assigned || 0) > 0 || (auto.assigned || 0) > 0 || (reassignment?.reassigned || 0) > 0) {
          logger.info({
            request_assigned: request.assigned || 0,
            auto_assigned: auto.assigned || 0,
            reassigned: reassignment?.reassigned || 0,
          }, '[Scheduler] Assignment engine tick complete');
        }
      } catch (err) {
        logger.error({ err }, '[Scheduler] Assignment engine tick error');
        try {
          await runDistributionCycle();
        } catch (fallbackErr) {
          logger.error({ err: fallbackErr }, '[Scheduler] Request distribution fallback error');
        }
      }
    }
  } catch (err) {
    logger.error({ err }, '[Scheduler] Tick error');
  }
}

/** Start the background scheduler. Returns the timer handle for clean shutdown. */
function startDistributionScheduler() {
  logger.info('[Scheduler] Auto distribution scheduler started (checks every 60s, IST window)');
  const timer = setInterval(tick, 60_000);
  timer.unref(); // don't block process exit
  return timer;
}

module.exports = { startDistributionScheduler, distributeQueue, isDistributionActive, getSetting };
