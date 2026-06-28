const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler, AppError } = require('../utils/errors');
const { query } = require('../config/database');
const assignment = require('../services/leadAssignmentEngine');
const scheduler = require('../services/distributionScheduler');
const { logActivity } = require('../utils/auditLog');

const MANAGERS = ['super_admin', 'admin', 'rm'];
const ADMINS = ['super_admin', 'admin'];

function leadIdsFromBody(body) {
  return body.leadIds || body.lead_ids || [];
}

function memberIdFromBody(body) {
  return body.memberId || body.member_id || body.user_id || body.newMemberId || body.new_member_id;
}

router.get('/admin/assignment/overview', authenticate, requireRole(...ADMINS), asyncHandler(async (_req, res) => {
  const data = await assignment.getAssignmentOverview();
  res.json({ success: true, data });
}));

router.get('/admin/assignment/settings', authenticate, requireRole(...ADMINS), asyncHandler(async (_req, res) => {
  const settings = await assignment.getAssignmentSettings();
  res.json({ success: true, data: settings });
}));

router.patch('/admin/assignment/settings', authenticate, requireRole(...ADMINS), asyncHandler(async (req, res) => {
  const before = await assignment.getAssignmentSettings();
  const map = {
    autoAssignEnabled: ['auto_assign_enabled', 'auto_distribution_enabled'],
    assignStartHour: ['assign_start_hour', 'distribution_start_hour'],
    assignEndHour: ['assign_end_hour', 'distribution_end_hour'],
    timezone: ['assignment_timezone', 'distribution_timezone'],
    autoReassignEnabled: ['auto_reassign_enabled'],
    reassignAfterHours: ['reassign_after_hours'],
    reassignToHighPerformers: ['reassign_to_high_performers'],
    autoAssignApprovedRequests: ['auto_assign_approved_requests'],
    assignmentTickLimit: ['assignment_tick_limit'],
    requestFulfillmentLimit: ['request_fulfillment_limit'],
    reassignmentTickLimit: ['reassignment_tick_limit'],
    scheduledAssignmentTime: ['scheduled_assignment_time'],
    scheduledTimezone: ['scheduled_timezone', 'assignment_timezone', 'distribution_timezone'],
    maxLeadsPerScheduledRun: ['max_leads_per_scheduled_run', 'assignment_tick_limit'],
  };

  const updated = [];
  for (const [field, keys] of Object.entries(map)) {
    if (req.body[field] === undefined) continue;
    let value = req.body[field];
    if (typeof value === 'boolean') value = value ? 'true' : 'false';
    value = String(value);
    for (const key of keys) {
      await query(
        `INSERT INTO distribution_settings(key, value, updated_by, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value,
                 updated_by = EXCLUDED.updated_by,
                 updated_at = NOW()`,
        [key, value, req.user.id],
      );
    }
    updated.push(field);
  }

  await logActivity(req, {
    entity: 'distribution_settings',
    action: 'updated',
    metadata: { updated, values: req.body },
  });

  let approvedRequestFulfillment = null;
  if (
    req.body.autoAssignApprovedRequests === true
    && before.autoAssignApprovedRequests !== true
  ) {
    const latest = await assignment.getAssignmentSettings();
    approvedRequestFulfillment = await assignment.runApprovedRequestFulfillment({
      limit: Number(latest.requestFulfillmentLimit || latest.assignmentTickLimit || 100),
      actor: req.user,
      bypassEnabled: true,
    });
  }

  const settings = await assignment.getAssignmentSettings();
  res.json({ success: true, data: { ...settings, approvedRequestFulfillment } });
}));

async function runBulkAssignment(req, res, type) {
  const leadIds = leadIdsFromBody(req.body);
  const memberId = memberIdFromBody(req.body);
  const reason = req.body.reason || (type === 'manual_reassign' ? 'manual reassignment' : 'manual assignment');
  if (!Array.isArray(leadIds) || leadIds.length === 0) throw new AppError(400, 'INVALID', 'leadIds array required');
  if (!memberId) throw new AppError(400, 'INVALID', 'memberId required');

  const result = await assignment.assignLeadsBulk({
    leadIds,
    memberId,
    assignedBy: req.user.id,
    actor: req.user,
    assignmentType: type,
    reason,
  });

  await logActivity(req, {
    entity: 'lead',
    entity_id: leadIds[0],
    action: type,
    metadata: { leadIds: leadIds.slice(0, 20), count: leadIds.length, assigned: result.assigned, failed: result.failed, memberId, reason },
  });

  res.json({ success: true, data: result });
}

router.post('/admin/leads/assign', authenticate, requireRole(...MANAGERS), asyncHandler((req, res) => (
  runBulkAssignment(req, res, 'manual')
)));
router.post('/admin/leads/bulk-assign', authenticate, requireRole(...MANAGERS), asyncHandler((req, res) => (
  runBulkAssignment(req, res, 'manual')
)));
router.post('/admin/leads/reassign', authenticate, requireRole(...MANAGERS), asyncHandler((req, res) => (
  runBulkAssignment(req, res, 'manual_reassign')
)));
router.post('/admin/leads/bulk-reassign', authenticate, requireRole(...MANAGERS), asyncHandler((req, res) => (
  runBulkAssignment(req, res, 'manual_reassign')
)));

router.post('/lead-requests/:id/approve', authenticate, requireRole(...ADMINS), asyncHandler(async (req, res) => {
  const { rows: [request] } = await query(
    `SELECT quantity, requested_quantity FROM lead_requests WHERE id = $1`,
    [req.params.id],
  );
  if (!request) throw new AppError(404, 'NOT_FOUND', 'Request not found');

  const result = await assignment.approveLeadRequest({
    requestId: req.params.id,
    approvedQuantity: req.body.approvedQuantity || req.body.approved_quantity || request.requested_quantity || request.quantity,
    adminNotes: req.body.adminNotes || req.body.admin_notes || req.body.note || null,
    actor: req.user,
  });
  const thisRequest = result.fulfillment?.requests?.find(r => r.requestId === req.params.id);
  const assignedNow = thisRequest?.assigned || 0;
  const fulfilled = Number(result.request.fulfilled_quantity || result.request.leads_assigned || 0);
  const approved = Number(result.request.approved_quantity || 0);

  await logActivity(req, {
    entity: 'lead_request',
    entity_id: req.params.id,
    action: result.request.status === 'fulfilled' ? 'fulfilled' : 'approved',
    metadata: { approved_quantity: approved, assigned_now: assignedNow, fulfilled_quantity: fulfilled },
  });

  res.json({
    success: true,
    data: {
      approved: true,
      leads_assigned: result.request.leads_assigned,
      fulfilled_quantity: fulfilled,
      requested: result.request.requested_quantity || result.request.quantity,
      approved_quantity: approved,
      assigned_now: assignedNow,
      remaining: Math.max(0, approved - fulfilled),
      status: result.request.status,
      partial: result.request.status === 'approved' || result.request.status === 'partially_fulfilled',
    },
  });
}));

router.post('/admin/distribution/run-now', authenticate, requireRole(...ADMINS), asyncHandler(async (req, res) => {
  const result = await scheduler.runScheduledDistribution({ actor: req.user, manual: true });
  await logActivity(req, {
    entity: 'lead',
    action: 'distribution_run_now',
    metadata: result,
  });
  res.json({ success: true, data: result });
}));

router.post('/admin/reassignment/run-now', authenticate, requireRole(...ADMINS), asyncHandler(async (req, res) => {
  const settings = await assignment.getAssignmentSettings();
  const result = await assignment.runAutoReassignment({
    limit: Number(req.body?.limit || settings.reassignmentTickLimit),
    actor: req.user,
    bypassWindow: true,
  });
  await logActivity(req, {
    entity: 'lead',
    action: 'reassignment_run_now',
    metadata: result,
  });
  res.json({ success: true, data: result });
}));

module.exports = router;
