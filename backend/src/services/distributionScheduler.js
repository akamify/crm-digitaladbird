const { query, withTransaction } = require('../config/database');
const assignmentEngine = require('./leadAssignmentEngine');
const logger = require('../utils/logger');

const DEFAULT_TZ = 'Asia/Kolkata';

function asBool(value) {
  return String(value || '').toLowerCase() === 'true';
}

function normalizeTime(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return '';
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function istParts(date = new Date(), timezone = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || DEFAULT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value || '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hour}:${get('minute')}`,
  };
}

async function getSettings() {
  const { rows } = await query(`SELECT key, value FROM distribution_settings`);
  return Object.fromEntries(rows.map(row => [row.key, row.value]));
}

async function setSetting(key, value) {
  await query(
    `INSERT INTO distribution_settings(key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, String(value ?? '')],
  );
}

async function isDistributionActive() {
  const settings = await getSettings();
  return asBool(settings.auto_assign_enabled ?? settings.auto_distribution_enabled)
    && !!normalizeTime(settings.scheduled_assignment_time);
}

async function acquireRunLock() {
  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO distribution_settings(key, value, label)
         VALUES ('is_distribution_running', 'false', 'Distribution scheduler lock')
       ON CONFLICT (key) DO NOTHING`,
    );
    const { rows: [row] } = await client.query(
      `UPDATE distribution_settings
          SET value = 'true', updated_at = NOW()
        WHERE key = 'is_distribution_running'
          AND COALESCE(value, 'false') <> 'true'
        RETURNING value`,
    );
    return !!row;
  });
}

async function releaseRunLock({ status, error = '' } = {}) {
  await Promise.all([
    setSetting('is_distribution_running', 'false'),
    status ? setSetting('last_distribution_status', status) : Promise.resolve(),
    setSetting('last_distribution_error', error || ''),
  ]);
}

function ranToday(lastRunAt, timezone) {
  if (!lastRunAt) return false;
  const last = istParts(new Date(lastRunAt), timezone).dateKey;
  const now = istParts(new Date(), timezone).dateKey;
  return last === now;
}

function scheduledRunSignature(settings) {
  const enabled = asBool(settings.auto_assign_enabled ?? settings.auto_distribution_enabled);
  const scheduledTime = normalizeTime(settings.scheduled_assignment_time);
  const timezone = settings.scheduled_timezone || DEFAULT_TZ;
  const maxLeads = Math.max(1, Number.parseInt(settings.max_leads_per_scheduled_run || settings.assignment_tick_limit || '100', 10));
  return JSON.stringify({
    enabled,
    scheduledTime,
    timezone,
    maxLeads,
    method: 'rm_team_round_robin',
  });
}

async function shouldRunNow(settings) {
  const enabled = asBool(settings.auto_assign_enabled ?? settings.auto_distribution_enabled);
  const scheduledTime = normalizeTime(settings.scheduled_assignment_time);
  const timezone = settings.scheduled_timezone || DEFAULT_TZ;
  const signature = scheduledRunSignature(settings);
  if (!enabled || !scheduledTime) {
    logger.debug({ reason: enabled ? 'NO_SCHEDULED_TIME' : 'AUTO_DISTRIBUTION_DISABLED' }, '[Scheduler] scheduled distribution skipped');
    return { due: false, reason: enabled ? 'NO_SCHEDULED_TIME' : 'AUTO_DISTRIBUTION_DISABLED' };
  }
  const now = istParts(new Date(), timezone);
  if (now.time < scheduledTime) return { due: false, reason: 'WAITING_FOR_SCHEDULE' };
  if (ranToday(settings.last_scheduled_run_at, timezone)) {
    const lastSignature = String(settings.last_scheduled_run_signature || '');
    if (lastSignature === signature) {
      logger.info({ scheduledTime, timezone }, '[Scheduler] skipped: already ran today with same settings');
      return { due: false, reason: 'ALREADY_RAN_TODAY' };
    }
    logger.info({
      scheduledTime,
      timezone,
      previousSignature: lastSignature || null,
      currentSignature: signature,
    }, '[Scheduler] settings changed after today run; same-day scheduled rerun allowed');
  }
  return { due: true, timezone, scheduledTime, signature };
}

async function runScheduledDistribution({ actor = null, manual = false } = {}) {
  const settings = await getSettings();
  const timezone = settings.scheduled_timezone || DEFAULT_TZ;
  const due = manual ? { due: true, timezone } : await shouldRunNow(settings);
  if (!due.due) return { success: true, skipped: true, reason: due.reason, assigned: 0 };

  const locked = await acquireRunLock();
  if (!locked) {
    return { success: false, skipped: true, reason: 'DISTRIBUTION_ALREADY_RUNNING', assigned: 0 };
  }

  try {
    const limit = Math.max(1, Number.parseInt(settings.max_leads_per_scheduled_run || settings.assignment_tick_limit || '100', 10));
    logger.info({ manual, limit, scheduledTime: normalizeTime(settings.scheduled_assignment_time), timezone }, '[Scheduler] scheduled distribution starting');
    const result = await assignmentEngine.runAutoAssignment({
      limit,
      reason: manual ? 'manual_run_now' : 'scheduled_assignment',
      actor,
      bypassWindow: true,
      bypassEnabled: manual,
    });
    const assigned = Number(result.assigned || 0);
    const status = assigned > 0 ? `assigned:${assigned}` : 'completed_no_leads';
    await setSetting('last_scheduled_run_at', new Date().toISOString());
    if (!manual) {
      await setSetting('last_scheduled_run_signature', due.signature || scheduledRunSignature(settings));
    }
    await setSetting('next_scheduled_run_at', '');
    await releaseRunLock({ status });
    logger.info({ assigned, scanned: result.scanned || 0, manual }, '[Scheduler] scheduled distribution complete');
    return { success: true, assigned, scanned: result.scanned || 0, result };
  } catch (error) {
    const message = String(error?.message || 'Scheduled distribution failed').slice(0, 500);
    await releaseRunLock({ status: 'failed', error: message });
    logger.error({ err: error }, '[Scheduler] scheduled distribution failed');
    throw error;
  }
}

async function tick() {
  try {
    await runScheduledDistribution();
  } catch (error) {
    logger.error({ err: error }, '[Scheduler] Tick error');
  }
}

function startDistributionScheduler() {
  logger.info('[Scheduler] Scheduled lead assignment scheduler started (checks every 60s, IST)');
  const timer = setInterval(tick, 60_000);
  timer.unref();
  return timer;
}

module.exports = {
  startDistributionScheduler,
  distributeQueue: runScheduledDistribution,
  runScheduledDistribution,
  isDistributionActive,
  getSetting: async (key, fallback) => {
    const settings = await getSettings();
    return settings[key] ?? fallback;
  },
};
