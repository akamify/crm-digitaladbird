/**
 * Meta periodic lead-pull job.
 *
 * Fallback against missed webhooks: every 60s, pull leads from all registered
 * Meta forms that were created after the last successful run. Anything new is
 * ingested through the standard `ingestGraphLead` pipeline (which now broadcasts
 * `lead:new` + appends to Google Sheet), so missed-webhook leads light up the
 * UI exactly the same as live webhook leads.
 *
 * Pull window: start ~10 minutes back on first boot to catch anything we
 * missed during downtime, then incrementally move forward.
 */
const { query } = require('../config/database');
const logger    = require('../utils/logger');
const metaSync  = require('../services/metaSyncService');

const INTERVAL_MS = 60_000;
const FIRST_RUN_LOOKBACK_MS = 10 * 60_000;

let _running = false;
let _lastSyncAt = new Date(Date.now() - FIRST_RUN_LOOKBACK_MS);

async function tick() {
  if (_running) return;
  _running = true;
  try {
    // Anyforms registered in the CRM at all?
    const { rows: forms } = await query(`SELECT form_id FROM meta_forms WHERE is_active = TRUE`);
    if (!forms.length) return;

    const since = _lastSyncAt.toISOString();
    const sinceWindowStart = new Date();
    let totalCreated = 0, totalDup = 0;
    for (const f of forms) {
      try {
        const r = await metaSync.syncFormLeads(f.form_id, { since, limit: 100 });
        totalCreated += r.created || 0;
        totalDup     += r.duplicate || 0;
      } catch (err) {
        // Token expired / form removed — log once and skip, don't kill the job
        const msg = err.response?.data?.error?.message || err.message;
        logger.debug({ form_id: f.form_id, err: msg }, '[MetaPull] form sync skipped');
      }
    }
    if (totalCreated > 0) {
      logger.info({ since, totalCreated, totalDup, forms: forms.length }, '[MetaPull] pulled new leads');
    }
    // Move the window forward so the next tick doesn't re-scan the same range.
    _lastSyncAt = sinceWindowStart;
  } catch (err) {
    logger.error({ err: err.message }, '[MetaPull] tick failed');
  } finally {
    _running = false;
  }
}

function startMetaPullJob() {
  logger.info('[MetaPull] Periodic Meta lead pull started (every 60s, catches missed webhooks)');
  // Wait a beat after boot so the rest of the app is fully up.
  setTimeout(() => tick().catch(() => {}), 30_000);
  return setInterval(() => tick().catch(() => {}), INTERVAL_MS);
}

module.exports = { startMetaPullJob };
