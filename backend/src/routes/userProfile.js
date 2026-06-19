const express = require('express');
const { authenticate, invalidateUser } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/errors');
const userProfileService = require('../services/userProfileService');

const router = express.Router();

router.use('/admin/users', authenticate, requireRole('super_admin', 'admin', 'rm'));

router.get('/admin/users/:userId/profile', asyncHandler(async (req, res) => {
  const data = await userProfileService.getProfile(req.user, req.params.userId);
  res.json({ success: true, data });
}));

router.get('/admin/users/:userId/performance', asyncHandler(async (req, res) => {
  const data = await userProfileService.getPerformance(req.user, req.params.userId, req.query);
  res.json({ success: true, data });
}));

router.get('/admin/users/:userId/leads', asyncHandler(async (req, res) => {
  const data = await userProfileService.getUserLeads(req.user, req.params.userId, req.query);
  res.json({ success: true, data });
}));

router.get('/admin/users/:userId/requests', asyncHandler(async (req, res) => {
  const data = await userProfileService.getRequests(req.user, req.params.userId);
  res.json({ success: true, data });
}));

router.get('/admin/users/:userId/assignment-history', asyncHandler(async (req, res) => {
  const data = await userProfileService.getAssignmentHistory(req.user, req.params.userId);
  res.json({ success: true, data });
}));

router.get('/admin/users/:userId/activity', asyncHandler(async (req, res) => {
  const data = await userProfileService.getActivity(req.user, req.params.userId);
  res.json({ success: true, data });
}));

router.patch('/admin/users/:userId/profile', asyncHandler(async (req, res) => {
  const data = await userProfileService.updateProfile(req.user, req.params.userId, req.body || {});
  invalidateUser(req.params.userId);
  res.json({ success: true, data });
}));

module.exports = router;
