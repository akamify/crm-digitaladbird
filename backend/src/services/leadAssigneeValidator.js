const { AppError } = require('../utils/errors');

const VALID_LEAD_ASSIGNEE_ROLES = ['member', 'partner'];
const INVALID_LEAD_ASSIGNEE_ROLE = 'INVALID_LEAD_ASSIGNEE_ROLE';
const INVALID_LEAD_ASSIGNEE = 'INVALID_LEAD_ASSIGNEE';
const INVALID_LEAD_ASSIGNEE_MESSAGE =
  'Leads can only be assigned to members or partners. RM users cannot receive direct lead assignments.';
const INVALID_LEAD_ASSIGNEE_AVAILABILITY_MESSAGE =
  'Leads can only be assigned to available members or partners.';
const RM_UNAVAILABLE_MESSAGE =
  'Your reporting RM is unavailable for lead assignment.';

function isValidLeadAssigneeRole(role) {
  return VALID_LEAD_ASSIGNEE_ROLES.includes(String(role || '').toLowerCase());
}

function isEffectivelyAvailable(user) {
  const assignmentStatus = String(user?.lead_assignment_status || '').trim().toLowerCase();
  if (assignmentStatus) {
    return user.lead_assignment_enabled !== false && assignmentStatus === 'available';
  }
  return user?.is_available !== false;
}

function isReportingRmAvailable(user) {
  const assignmentStatus = String(user?.rm_lead_assignment_status || '').trim().toLowerCase();
  if (assignmentStatus) {
    return user.rm_lead_assignment_enabled !== false && assignmentStatus === 'available';
  }
  return user?.rm_is_available !== false;
}

function availabilityDetails(user, reason) {
  return {
    reason,
    user_id: user?.id || null,
    user_role: user?.role || null,
    user_status: user?.status || null,
    is_available: user?.is_available ?? null,
    distribution_blocked: user?.distribution_blocked ?? null,
    rm_is_available: user?.rm_is_available ?? null,
    rm_lead_assignment_enabled: user?.rm_lead_assignment_enabled ?? null,
    rm_lead_assignment_status: user?.rm_lead_assignment_status ?? null,
  };
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
    throw new AppError(422, INVALID_LEAD_ASSIGNEE, INVALID_LEAD_ASSIGNEE_AVAILABILITY_MESSAGE, availabilityDetails(user, 'distribution_blocked'));
  }
  if (requireAvailable && !isEffectivelyAvailable(user)) {
    throw new AppError(422, INVALID_LEAD_ASSIGNEE, INVALID_LEAD_ASSIGNEE_AVAILABILITY_MESSAGE, availabilityDetails(user, 'user_unavailable'));
  }
  if (!isEffectivelyAvailable(user)) {
    throw new AppError(422, INVALID_LEAD_ASSIGNEE, INVALID_LEAD_ASSIGNEE_AVAILABILITY_MESSAGE, availabilityDetails(user, 'user_unavailable'));
  }
  if (!isReportingRmAvailable(user)) {
    throw new AppError(422, 'REPORTING_RM_UNAVAILABLE', RM_UNAVAILABLE_MESSAGE, availabilityDetails(user, 'reporting_rm_unavailable'));
  }
  if (actor?.role === 'rm' && user.report_to_id !== actor.id) {
    throw new AppError(403, 'FORBIDDEN', 'RM can only assign leads to users in their team');
  }
  return user;
}

async function validateLeadAssignee(runner, userId, options = {}) {
  const { rows: [user] } = await runner.query(
    `SELECT u.id, u.full_name, u.role, u.status, u.report_to_id, u.deleted_at,
            COALESCE(u.is_available, TRUE) AS is_available,
            COALESCE(u.distribution_blocked, FALSE) AS distribution_blocked,
            COALESCE(u.lead_assignment_enabled, TRUE) AS lead_assignment_enabled,
            COALESCE(u.lead_assignment_status, 'available') AS lead_assignment_status,
            COALESCE(rm.is_available, TRUE) AS rm_is_available,
            COALESCE(rm.lead_assignment_enabled, TRUE) AS rm_lead_assignment_enabled,
            COALESCE(rm.lead_assignment_status, 'available') AS rm_lead_assignment_status
       FROM users u
       LEFT JOIN users rm ON rm.id = u.report_to_id AND rm.role = 'rm' AND rm.deleted_at IS NULL
      WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId],
  );
  return assertLeadAssigneeUser(user, options);
}

module.exports = {
  VALID_LEAD_ASSIGNEE_ROLES,
  INVALID_LEAD_ASSIGNEE_ROLE,
  INVALID_LEAD_ASSIGNEE,
  INVALID_LEAD_ASSIGNEE_MESSAGE,
  isValidLeadAssigneeRole,
  assertLeadAssigneeUser,
  validateLeadAssignee,
};
