const config = require('../config/env');
const { verifySignature, ingestLeadgenEvent } = require('../services/metaService');
const { AppError, asyncHandler } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * GET /webhooks/meta — Meta verify handshake.
 * Meta hits this with hub.mode, hub.verify_token, hub.challenge.
 */
exports.verify = (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === config.meta.verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
};

/**
 * POST /webhooks/meta — leadgen events.
 * Body MUST be passed as raw buffer to the signature check (configured in app.js).
 */
exports.receive = asyncHandler(async (req, res) => {
  const sig = req.headers['x-hub-signature-256'];
  const raw = req.rawBody;
  const rawBytes = raw?.length || 0;
  logger.info({ step: '1.received', bytes: rawBytes, sig_present: !!sig, ua: req.headers['user-agent'] }, '[meta-webhook]');

  if (!verifySignature(raw, sig)) {
    logger.warn({ step: '2.signature.failed', sig }, '[meta-webhook] HMAC mismatch — check META_APP_SECRET matches the Meta app secret');
    throw new AppError(401, 'BAD_SIGNATURE', 'Invalid signature');
  }
  logger.info({ step: '2.signature.ok' }, '[meta-webhook]');

  const body = JSON.parse(raw.toString('utf8'));
  if (body.object !== 'page') {
    logger.info({ step: '3.skip_non_page', object: body.object }, '[meta-webhook]');
    return res.sendStatus(200);
  }

  const entries = body.entry || [];
  const totalChanges = entries.reduce((n, e) => n + (e.changes?.length || 0), 0);
  logger.info({ step: '3.parsed', entries: entries.length, total_changes: totalChanges }, '[meta-webhook]');

  // ack ASAP, process in background
  res.sendStatus(200);

  for (const entry of entries) {
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen') {
        logger.info({ step: '4.skip_non_leadgen', field: change.field }, '[meta-webhook]');
        continue;
      }
      const v = change.value || {};
      logger.info({ step: '4.leadgen.dispatch', leadgen_id: v.leadgen_id, page_id: v.page_id, form_id: v.form_id, created_time: v.created_time }, '[meta-webhook]');
      try {
        const result = await ingestLeadgenEvent({
          leadgen_id:   v.leadgen_id,
          page_id:      v.page_id,
          form_id:      v.form_id,
          created_time: v.created_time,
        });
        logger.info({ step: '5.ingest.done', leadgen_id: v.leadgen_id, ...result }, '[meta-webhook]');
      } catch (err) {
        logger.error({ step: '5.ingest.failed', leadgen_id: v.leadgen_id, err: err.message, stack: err.stack, v }, '[meta-webhook] ingestLeadgenEvent threw');
      }
    }
  }
});
