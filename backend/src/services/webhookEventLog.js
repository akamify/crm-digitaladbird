/**
 * Webhook event logger.
 *
 * Records EVERY POST /webhooks/meta into the webhook_events table — even
 * the failed-signature ones, even the empty-body ones. This is the
 * permanent audit trail an operator opens when they ask "is Meta even
 * reaching us right now?"
 *
 * Best-effort: a DB error inserting the audit row must NEVER cause the
 * webhook response itself to fail (Meta would just retry and the lead
 * would re-process, causing duplicate work). All failures are
 * console-logged and swallowed.
 *
 * Designed to be called from the existing metaController.receive handler
 * at TWO points:
 *   - immediately on receipt (record the inbound attempt)
 *   - after processing (update with results)
 *
 * Returns a record handle that the caller updates via finishWebhookEvent().
 */
const crypto = require('crypto');
const { query } = require('../config/database');
const logger = require('../utils/logger');

async function recordWebhookReceived({
  endpoint, method, remoteIp, userAgent, signatureValid,
  bodySize, eventType, rawBody,
}) {
  try {
    const { rows: [r] } = await query(
      `INSERT INTO webhook_events
         (endpoint, method, remote_ip, user_agent, signature_valid,
          body_size, event_type, raw_body)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        endpoint, method, remoteIp || null, userAgent || null,
        signatureValid, bodySize || 0, eventType || null,
        rawBody ? rawBody.slice(0, 8192) : null,
      ]
    );
    return r.id;
  } catch (err) {
    logger.warn({ err: err.message }, '[webhookEventLog] insert failed (non-fatal)');
    return null;
  }
}

async function finishWebhookEvent(id, {
  pageId, formId, leadCount, leadsCreated, leadsDup, leadsError,
  statusCode, processingMs, errorSummary,
}) {
  if (!id) return;
  try {
    await query(
      `UPDATE webhook_events SET
         page_id        = COALESCE($1, page_id),
         form_id        = COALESCE($2, form_id),
         lead_count     = COALESCE($3, lead_count),
         leads_created  = COALESCE($4, leads_created),
         leads_dup      = COALESCE($5, leads_dup),
         leads_error    = COALESCE($6, leads_error),
         status_code    = $7,
         processing_ms  = $8,
         error_summary  = $9
       WHERE id = $10`,
      [
        pageId || null, formId || null,
        leadCount, leadsCreated, leadsDup, leadsError,
        statusCode, processingMs,
        errorSummary ? errorSummary.slice(0, 2000) : null,
        id,
      ]
    );
  } catch (err) {
    logger.warn({ err: err.message }, '[webhookEventLog] update failed (non-fatal)');
  }
}

module.exports = { recordWebhookReceived, finishWebhookEvent };
