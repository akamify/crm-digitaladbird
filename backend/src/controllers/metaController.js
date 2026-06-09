const config = require('../config/env');
const { verifySignature, ingestLeadgenEvent } = require('../services/metaService');
const { AppError, asyncHandler } = require('../utils/errors');
const { recordWebhookReceived, finishWebhookEvent } = require('../services/webhookEventLog');
const logger = require('../utils/logger');

/**
 * GET /webhooks/meta — Meta verify handshake.
 * Meta hits this with hub.mode, hub.verify_token, hub.challenge.
 * Records the handshake attempt to webhook_events for the audit trail.
 */
exports.verify = (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const ok = mode === 'subscribe' && token === config.meta.verifyToken;

  // Fire-and-forget audit entry (don't block the response)
  recordWebhookReceived({
    endpoint:        req.path,
    method:          'GET',
    remoteIp:        req.ip,
    userAgent:       req.headers['user-agent'],
    signatureValid:  ok,
    bodySize:        0,
    eventType:       'verify_handshake',
    rawBody:         JSON.stringify({ mode, challenge_present: !!challenge }),
  }).then(id => id && finishWebhookEvent(id, {
    statusCode:   ok ? 200 : 403,
    errorSummary: ok ? null : `verify_token mismatch (mode=${mode})`,
  }));

  if (ok) return res.status(200).send(challenge);
  return res.sendStatus(403);
};

/**
 * POST /webhooks/meta — leadgen events.
 * Body MUST be passed as raw buffer to the signature check (configured in app.js).
 * Every call is recorded to webhook_events for the permanent audit trail.
 */
exports.receive = asyncHandler(async (req, res) => {
  const t0 = Date.now();
  const sig = req.headers['x-hub-signature-256'];
  const raw = req.rawBody;
  const rawBytes = raw?.length || 0;
  logger.info({ step: '1.received', bytes: rawBytes, sig_present: !!sig, ua: req.headers['user-agent'] }, '[meta-webhook]');

  const sigOk = verifySignature(raw, sig);

  // Record the attempt early — even bad-signature attacks land here
  const auditId = await recordWebhookReceived({
    endpoint:        req.path,
    method:          'POST',
    remoteIp:        req.ip,
    userAgent:       req.headers['user-agent'],
    signatureValid:  sigOk,
    bodySize:        rawBytes,
    eventType:       'leadgen',
    rawBody:         raw ? raw.toString('utf8') : null,
  });

  if (!sigOk) {
    logger.warn({ step: '2.signature.failed', sig }, '[meta-webhook] HMAC mismatch — check META_APP_SECRET matches the Meta app secret');
    finishWebhookEvent(auditId, {
      statusCode: 401, processingMs: Date.now() - t0,
      errorSummary: 'BAD_SIGNATURE — X-Hub-Signature-256 mismatch. Verify META_APP_SECRET matches the Meta app secret.',
    });
    throw new AppError(401, 'BAD_SIGNATURE', 'Invalid signature');
  }
  logger.info({ step: '2.signature.ok' }, '[meta-webhook]');

  const body = JSON.parse(raw.toString('utf8'));
  if (body.object !== 'page') {
    logger.info({ step: '3.skip_non_page', object: body.object }, '[meta-webhook]');
    finishWebhookEvent(auditId, {
      statusCode: 200, processingMs: Date.now() - t0,
      errorSummary: `skipped: object=${body.object} (not 'page')`,
    });
    return res.sendStatus(200);
  }

  const entries = body.entry || [];
  const totalChanges = entries.reduce((n, e) => n + (e.changes?.length || 0), 0);
  const leadChanges = entries.flatMap(e => (e.changes || []).filter(c => c.field === 'leadgen'));
  const firstPageId = leadChanges[0]?.value?.page_id || entries[0]?.id || null;
  const firstFormId = leadChanges[0]?.value?.form_id || null;
  logger.info({ step: '3.parsed', entries: entries.length, total_changes: totalChanges }, '[meta-webhook]');

  // ack ASAP, process in background (Meta requires <20s)
  res.sendStatus(200);

  let created = 0, dup = 0, errored = 0;
  const errorMessages = [];

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
        if (result?.created) created++;
        else if (result?.duplicate) dup++;
        else errored++;
        logger.info({ step: '5.ingest.done', leadgen_id: v.leadgen_id, ...result }, '[meta-webhook]');
      } catch (err) {
        errored++;
        errorMessages.push(err.message.slice(0, 200));
        logger.error({ step: '5.ingest.failed', leadgen_id: v.leadgen_id, err: err.message, stack: err.stack, v }, '[meta-webhook] ingestLeadgenEvent threw');
      }
    }
  }

  finishWebhookEvent(auditId, {
    pageId:        firstPageId,
    formId:        firstFormId,
    leadCount:     leadChanges.length,
    leadsCreated:  created,
    leadsDup:      dup,
    leadsError:    errored,
    statusCode:    200,
    processingMs:  Date.now() - t0,
    errorSummary:  errorMessages.length ? errorMessages.join(' | ') : null,
  });
});
