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
  if (!verifySignature(raw, sig)) {
    logger.warn({ sig }, 'Meta webhook signature invalid');
    throw new AppError(401, 'BAD_SIGNATURE', 'Invalid signature');
  }

  const body = JSON.parse(raw.toString('utf8'));
  if (body.object !== 'page') return res.sendStatus(200); // ignore other objects

  // ack ASAP, process in background
  res.sendStatus(200);

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen') continue;
      const v = change.value || {};
      try {
        await ingestLeadgenEvent({
          leadgen_id:   v.leadgen_id,
          page_id:      v.page_id,
          form_id:      v.form_id,
          created_time: v.created_time,
        });
      } catch (err) {
        logger.error({ err, v }, 'Failed to ingest leadgen event');
      }
    }
  }
});
