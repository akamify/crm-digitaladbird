const { AppError } = require('../utils/errors');

const VALID_LEAD_ASSIGNEE_ROLES = ['member'];
const INVALID_LEAD_ASSIGNEE_ROLE = 'INVALID_LEAD_ASSIGNEE_ROLE';
const INVALID_LEAD_ASSIGNEE_MESSAGE =
  'Leads can only be assigned to members. RM users cannot receive direct lead assignments.';

function isValidLeadAssigneeRole(role) {
  return VALID_LEAD_ASSIGNEE_ROLES.includes(String(role || '').toLowerCase());
}

function assertLeadAssigneeUser(user, options = {}) {
  const { actor = null, requireAvailable = false } = options;
  if (!user || user.deleted_at) {
    throw new AppError(404, 'ASSIGNEE_NOT_FOUND', 'Target assignee not found');
  }
  if (!isValidLeadAssigneeRole(user.role)) {
    throw new AppError(422, INVALID_LEAD_ASSIGNEE_ROLE, INVALID_LEAD_ASSIGNEE_MESSAGE);
  }
  if (user.status !== 'active') {
    throw new AppError(422, 'INVALID_LEAD_ASSIGNEE_STATUS', 'Target assignee is not active');
  }
  if (user.distribution_blocked === true) {
    throw new AppError(422, 'INVALID_LEAD_ASSIGNEE_STATUS', 'Target assignee is blocked from lead distribution');
  }
  if (requireAvailable && user.is_available === false) {
    throw new AppError(422, 'INVALID_LEAD_ASSIGNEE_STATUS', 'Target assignee is not available for lead assignment');
  }
  if (actor?.role === 'rm' && user.report_to_id !== actor.id) {
    throw new AppError(403, 'FORBIDDEN', 'RM can only assign leads to users in their team');
  }
  return user;
}

async function validateLeadAssignee(runner, userId, options = {}) {
  const { rows: [user] } = await runner.query(
    `SELECT id, full_name, role, status, report_to_id, deleted_at,
            COALESCE(is_available, TRUE) AS is_available,
            COALESCE(distribution_blocked, FALSE) AS distribution_blocked
       FROM users
      WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  return assertLeadAssigneeUser(user, options);
}

module.exports = {
  VALID_LEAD_ASSIGNEE_ROLES,
  INVALID_LEAD_ASSIGNEE_ROLE,
  INVALID_LEAD_ASSIGNEE_MESSAGE,
  isValidLeadAssigneeRole,
  assertLeadAssigneeUser,
  validateLeadAssignee,
};
