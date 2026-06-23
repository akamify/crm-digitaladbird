/**
 * Single chokepoint for "a new lead just landed in the DB".
 *
 * Called by: Meta webhook, Meta periodic sync, Sheet → CRM import,
 *            and the manual create endpoint. Every path runs this so the
 *            same side-effects happen exactly once per lead:
 *
 *   1. Pull a thin display row from the leads table
 *   2. Broadcast `lead:new` to admin + RM + assignee rooms (Socket.IO)
 *   3. Append the new row to the active Google Sheet (best-effort, non-blocking)
 *
 * Distribution / RM assignment is NOT triggered here — callers handle that
 * themselves (different rules for webhook vs. import vs. manual).
 */
const { query } = require('../config/database');
const logger    = require('../utils/logger');
const { broadcastNewLead } = require('./socketService');

async function loadLeadSummary(leadId) {
  const { rows: [r] } = await query(
    `SELECT l.id, l.full_name, l.phone, l.email, l.source,
            l.campaign_name, l.ad_name, l.adset_name, l.meta_form_id, l.product_tag,
            l.category, l.category_source,
            l.assigned_to_user_id, u.full_name AS assigned_to_name,
            l.created_at
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to_user_id
      WHERE l.id = $1`,
    [leadId],
  );
  return r || null;
}

/**
 * Lookup an existing lead by phone or email so callers can skip duplicates
 * BEFORE running an INSERT. Returns { id, reason } or null. Phone-match is
 * exact; email-match is case-insensitive.
 *
 * The dedup window is controlled by LEAD_DEDUP_WINDOW_DAYS (default 30).
 * Anyone who last submitted more than that many days ago is treated as a
 * fresh lead — otherwise re-targeting campaigns silently lose every lead
 * whose phone already exists somewhere in the historical pool.
 * Set to 0 to disable the time window entirely (original behaviour).
 */
async function findExistingByContact({ phone, email }) {
  const windowDays = Number.parseInt(process.env.LEAD_DEDUP_WINDOW_DAYS || '30', 10);
  const windowClause = windowDays > 0
    ? ` AND created_at > NOW() - INTERVAL '${windowDays} days'`
    : '';
  if (phone) {
    const { rows } = await query(
      `SELECT id FROM leads WHERE phone = $1 AND deleted_at IS NULL${windowClause} ORDER BY created_at DESC LIMIT 1`,
      [phone],
    );
    if (rows[0]) return { id: rows[0].id, reason: 'phone' };
  }
  if (email) {
    const { rows } = await query(
      `SELECT id FROM leads WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL${windowClause} ORDER BY created_at DESC LIMIT 1`,
      [email],
    );
    if (rows[0]) return { id: rows[0].id, reason: 'email' };
  }
  return null;
}

/**
 * Call once after a successful INSERT. Fans out the side-effects without
 * blocking the caller — both the broadcast and the sheet append are fire &
 * forget. Errors are logged, never thrown back.
 */
function onLeadCreated(leadId, { source = 'unknown' } = {}) {
  if (!leadId) return;
  // Lazy require to avoid a circular dep with metaService (which requires
  // googleSheetsService which requires this file via socketService).
  const sheetsSvc = require('./googleSheetsService');
  const userSheetsSvc = require('./userGoogleSheetsService');
  const { bustLeadCountersCache } = require('../middleware/cache');

  // Server-side cache bust FIRST — before the socket emit. Reason: the
  // frontend reacts to lead:new by invalidating React Query and refetching.
  // If we emit socket → frontend refetches → backend serves stale cached
  // body, the dashboard would lag by up to 10-15 seconds. Busting the
  // cache synchronously here guarantees the next /admin/live-stats,
  // /reports/summary, /admin/leads/fresh etc. all hit a MISS and re-run
  // the SQL — so the new lead is reflected within the round-trip latency
  // of one HTTP request (well under 1 second).
  try {
    const dropped = bustLeadCountersCache();
    if (dropped > 0) {
      logger.debug({ leadId, cache_entries_dropped: dropped }, '[lead-fanout] lead-counter cache busted');
    }
  } catch (err) { logger.warn({ err: err.message }, '[lead-fanout] cache bust failed (non-fatal)'); }

  Promise.resolve()
    .then(async () => {
      const summary = await loadLeadSummary(leadId);
      if (!summary) {
        logger.warn({ leadId, source }, '[lead-fanout] summary missing — broadcast skipped');
        return;
      }

      try {
        broadcastNewLead({ ...summary, _source: source });
        logger.info({ leadId, source, assigned_to: summary.assigned_to_user_id, campaign: summary.campaign_name }, '[lead-fanout] socket emit lead:new');
      } catch (err) { logger.warn({ err: err.message, leadId }, '[lead-fanout] broadcast failed'); }

      try {
        await sheetsSvc.appendLead(leadId);
        logger.info({ leadId, source }, '[lead-fanout] sheet append ok');
      } catch (err) { logger.warn({ err: err.message, leadId }, '[lead-fanout] sheet append failed (non-fatal)'); }

      await userSheetsSvc.enqueueLeadSync(leadId, { eventType: 'lead_created', source });

      // If this lead is still unassigned AND auto-distribution is ON,
      // try to fulfill any pre-approved-but-pending lead requests immediately
      // so the partner sees the lead within ~1s instead of waiting for the
      // next scheduler tick. Non-fatal — distributor errors don't roll back
      // the insert.
      if (!summary.assigned_to_user_id) {
        try {
          const assignmentEngine = require('./leadAssignmentEngine');
          const scheduler = require('./distributionScheduler');
          if (await scheduler.isDistributionActive()) {
            const request = await assignmentEngine.runApprovedRequestFulfillment({ limit: 100 });
            const auto = await assignmentEngine.runAutoAssignment({ limit: 100, reason: `${source}_fanout` });
            if ((request.assigned || 0) > 0 || (auto.assigned || 0) > 0) {
              logger.info({ leadId, source, requestAssigned: request.assigned, autoAssigned: auto.assigned }, '[lead-fanout] assignment engine topped up on new lead');
            }
          }
        } catch (err) {
          logger.warn({ err: err.message, leadId }, '[lead-fanout] request top-up failed (non-fatal)');
        }
      }
    })
    .catch(err => logger.error({ err: err.message, leadId }, '[lead-fanout] side-effects failed'));
}

const notificationEvents = require('./notificationService');

module.exports = {
  onLeadCreated,
  findExistingByContact,
  loadLeadSummary,
  notifyLeadsAssigned: notificationEvents.notifyLeadsAssigned,
  notifyLeadsReassigned: notificationEvents.notifyLeadsReassigned,
  notifyLeadRequestCreated: notificationEvents.notifyLeadRequestCreated,
  notifyLeadRequestApproved: (input, runner) => notificationEvents.notifyLeadRequestResolved({ ...input, status: 'approved' }, runner),
  notifyLeadRequestRejected: (input, runner) => notificationEvents.notifyLeadRequestResolved({ ...input, status: 'rejected' }, runner),
  notifyPartnerRequestApproved: notificationEvents.notifyPartnerRequestApproved,
  notifyPartnerRequestRejected: notificationEvents.notifyPartnerRequestRejected,
};
