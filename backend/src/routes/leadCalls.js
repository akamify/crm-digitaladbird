const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../utils/errors');
const leadCalls = require('../services/leadCallService');

router.get('/leads/:leadId/calls', authenticate, asyncHandler(async (req, res) => {
  const rows = await leadCalls.listLeadCalls({ leadId: req.params.leadId, user: req.user });
  res.json({ success: true, data: rows });
}));

router.post('/leads/:leadId/calls/start', authenticate, asyncHandler(async (req, res) => {
  const result = await leadCalls.startLeadCall({ leadId: req.params.leadId, user: req.user });
  res.status(201).json({ success: true, data: result });
}));

router.post('/leads/:leadId/calls/log', authenticate, asyncHandler(async (req, res) => {
  const result = await leadCalls.logLeadCall({ leadId: req.params.leadId, user: req.user, input: req.body || {} });
  res.status(201).json({
    success: true,
    data: result,
    lead: result.lead,
    updated_lead: result.updated_lead,
    message: result.message || 'Call log added and lead call status updated.',
  });
}));

router.post('/calls/provider/webhook', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { received: true } });
}));

module.exports = router;
