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
 */
async function findExistingByContact({ phone, email }) {
  if (phone) {
    const { rows } = await query(
      `SELECT id FROM leads WHERE phone = $1 AND deleted_at IS NULL LIMIT 1`,
      [phone],
    );
    if (rows[0]) return { id: rows[0].id, reason: 'phone' };
  }
  if (email) {
    const { rows } = await query(
      `SELECT id FROM leads WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
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

  Promise.resolve()
    .then(async () => {
      const summary = await loadLeadSummary(leadId);
      if (!summary) return;

      try { broadcastNewLead({ ...summary, _source: source }); }
      catch (err) { logger.warn({ err: err.message, leadId }, '[Lead] broadcast failed'); }

      try { await sheetsSvc.appendLead(leadId); }
      catch (err) { logger.warn({ err: err.message, leadId }, '[Lead] sheet append failed'); }
    })
    .catch(err => logger.error({ err: err.message, leadId }, '[Lead] onLeadCreated side-effects failed'));
}

module.exports = { onLeadCreated, findExistingByContact, loadLeadSummary };
