const router = require('express').Router();
const { asyncHandler, AppError } = require('../utils/errors');
const waspClient = require('../services/wasp/waspChatClient');
const inbound = require('../services/wasp/waspInboundService');
const config = require('../config/env');
const logger = require('../utils/logger');

router.get('/integrations/wasp/webhook', (_req, res) => {
  res.json({
    success: true,
    provider: 'wasp',
    enabled: config.wasp.enabled,
    webhook_path: config.wasp.webhookPath,
  });
});

router.post('/integrations/wasp/webhook', asyncHandler(async (req, res) => {
  if (!config.wasp.enabled) {
    throw new AppError(503, 'WASP_CHAT_DISABLED', 'WaspAkamify chat is disabled.');
  }
  if (!waspClient.verifyWebhook(req)) {
    throw new AppError(401, 'WASP_WEBHOOK_UNAUTHORIZED', 'Invalid WaspAkamify webhook secret.');
  }
  try {
    const result = await inbound.handleInboundWaspMessage(req.body || {}, req.headers || {});
    res.json({ success: true, data: result });
  } catch (err) {
    logger.warn({ code: err.code || 'WASP_WEBHOOK_FAILED', message: err.message }, '[Wasp] webhook processing failed');
    throw err;
  }
}));

module.exports = router;
