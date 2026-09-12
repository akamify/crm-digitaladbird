const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/errors');
const lifecycle = require('../services/lifecycleService');

const router = express.Router();
const workspaceRoles = requireRole('super_admin', 'admin', 'rm', 'member', 'partner');

router.get('/counselor-workspace/summary', authenticate, workspaceRoles, asyncHandler(async (req, res) => {
  const data = await lifecycle.workspace(req.user, req.query, false);
  res.json({ success: true, data });
}));

router.get('/counselor-workspace/leads', authenticate, workspaceRoles, asyncHandler(async (req, res) => {
  const data = await lifecycle.workspace(req.user, req.query, true);
  res.json({ success: true, data });
}));

router.get('/leads/:id/lifecycle', authenticate, workspaceRoles, asyncHandler(async (req, res) => {
  const data = await lifecycle.getLifecycle(req.user, req.params.id);
  res.json({ success: true, data });
}));

router.post('/leads/:id/lifecycle/events', authenticate, workspaceRoles, asyncHandler(async (req, res) => {
  const data = await lifecycle.recordEvent(req.user, req.params.id, req.body || {});
  res.status(data.duplicate ? 200 : 201).json({ success: true, data });
}));

router.post('/leads/:id/actions/:actionId/complete', authenticate, workspaceRoles, asyncHandler(async (req, res) => {
  const data = await lifecycle.completeAction(req.user, req.params.id, req.params.actionId, req.body || {});
  res.json({ success: true, data });
}));

router.post('/leads/:id/lifecycle/close', authenticate, workspaceRoles, asyncHandler(async (req, res) => {
  const data = await lifecycle.closeLifecycle(req.user, req.params.id, req.body || {});
  res.json({ success: true, data });
}));

router.post('/leads/:id/lifecycle/reopen', authenticate, requireRole('super_admin', 'admin', 'rm'), asyncHandler(async (req, res) => {
  const data = await lifecycle.reopenLifecycle(req.user, req.params.id, req.body || {});
  res.json({ success: true, data });
}));

router.get('/workflow-settings', authenticate, workspaceRoles, asyncHandler(async (req, res) => {
  const settings = await lifecycle.getSettings();
  res.json({
    success: true,
    data: {
      enabled: lifecycle.isEnabledFor(settings, req.user),
      globally_enabled: settings.enabled,
      pilot_user_ids: settings.pilotUserIds,
      settings: lifecycle.publicSettings(settings),
    },
  });
}));

router.patch('/workflow-settings', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const settings = await lifecycle.updateSettings(req.user, req.body || {});
  res.json({ success: true, data: { globally_enabled: settings.enabled, pilot_user_ids: settings.pilotUserIds, settings: lifecycle.publicSettings(settings) } });
}));

module.exports = router;
