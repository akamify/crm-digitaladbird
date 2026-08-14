const { query } = require('../config/database');
const { AppError } = require('../utils/errors');

const LEAD_COMMUNICATION_FORBIDDEN = 'LEAD_COMMUNICATION_FORBIDDEN';
const LEAD_COMMUNICATION_FORBIDDEN_MESSAGE = 'You can communicate only with leads assigned to you.';

async function loadLead(leadId, runner = { query }) {
  const { rows: [lead] } = await runner.query(
    `SELECT l.id, l.full_name, l.phone, l.email, l.source, l.campaign_name,
            l.campaign_label, l.meta_campaign_id, l.meta_form_id,
            l.category, l.category_source, l.stage, l.call_status,
            l.assigned_to_user_id, active_assignment.assigned_user_id AS active_assignment_user_id,
            l.pool_rm_id, l.deleted_at,
            u.full_name AS assigned_to_name,
            u.report_to_id AS assigned_user_rm_id,
            active_assignment_user.report_to_id AS active_assignment_user_rm_id
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to_user_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(la.assigned_to_user_id, la.user_id) AS assigned_user_id
           FROM lead_assignments la
          WHERE la.lead_id = l.id
            AND la.unassigned_at IS NULL
          ORDER BY la.assigned_at DESC, la.id DESC
          LIMIT 1
       ) active_assignment ON TRUE
       LEFT JOIN users active_assignment_user ON active_assignment_user.id = active_assignment.assigned_user_id
      WHERE l.id = $1 AND l.deleted_at IS NULL`,
    [leadId],
  );
  return lead || null;
}

async function getLeadByIdForCommunication(leadId, runner = { query }) {
  return loadLead(leadId, runner);
}

function forbidden() {
  return new AppError(403, LEAD_COMMUNICATION_FORBIDDEN, LEAD_COMMUNICATION_FORBIDDEN_MESSAGE);
}

async function canAccessLeadCommunication(user, leadId, runner = { query }) {
  if (!user || user.status === 'inactive' || user.status === 'blocked') {
    return { allowed: false, reason: 'inactive_user', lead: null };
  }

  const lead = await loadLead(leadId, runner);
  if (!lead) return { allowed: false, reason: 'lead_not_found', lead: null };

  if (user.role === 'super_admin' || user.role === 'admin') {
    return { allowed: true, reason: 'admin', lead };
  }

  if (user.role === 'member' || user.role === 'partner') {
    const isAssignedToUser = lead.assigned_to_user_id === user.id || lead.active_assignment_user_id === user.id;
    return {
      allowed: isAssignedToUser,
      reason: isAssignedToUser ? 'assigned_user' : 'not_assigned',
      lead,
    };
  }

  if (user.role === 'rm') {
    const isDirectlyAssignedToRm = lead.assigned_to_user_id === user.id || lead.active_assignment_user_id === user.id;
    const isAssignedInsideRmTeam = lead.assigned_user_rm_id === user.id || lead.active_assignment_user_rm_id === user.id;
    const isInRmPool = lead.pool_rm_id === user.id;
    return {
      allowed: isDirectlyAssignedToRm || isAssignedInsideRmTeam || isInRmPool,
      reason: isDirectlyAssignedToRm
        ? 'rm_direct_assignment'
        : isAssignedInsideRmTeam
          ? 'rm_team'
          : isInRmPool
            ? 'rm_pool'
            : 'outside_rm_team',
      lead,
    };
  }

  return { allowed: false, reason: 'unsupported_role', lead };
}

async function assertLeadCommunicationAccess(user, leadId, runner = { query }) {
  const result = await canAccessLeadCommunication(user, leadId, runner);
  if (!result.lead && result.reason === 'lead_not_found') {
    throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found');
  }
  if (!result.allowed) throw forbidden();
  return result.lead;
}

async function getLeadCommunicationScope(user) {
  if (!user) return { sql: 'FALSE', params: [] };
  if (user.role === 'super_admin' || user.role === 'admin') return { sql: 'TRUE', params: [] };
  if (user.role === 'member' || user.role === 'partner') {
    return {
      sql: `(
        l.assigned_to_user_id = $1
        OR EXISTS (
          SELECT 1
            FROM lead_assignments la_scope
           WHERE la_scope.lead_id = l.id
             AND COALESCE(la_scope.assigned_to_user_id, la_scope.user_id) = $1
             AND la_scope.unassigned_at IS NULL
        )
      )`,
      params: [user.id],
    };
  }
  if (user.role === 'rm') {
    return {
      sql: `(
        l.assigned_to_user_id = $1
        OR l.pool_rm_id = $1
        OR EXISTS (
          SELECT 1
            FROM lead_assignments la_scope
           WHERE la_scope.lead_id = l.id
             AND COALESCE(la_scope.assigned_to_user_id, la_scope.user_id) = $1
             AND la_scope.unassigned_at IS NULL
        )
        OR EXISTS (
          SELECT 1
            FROM users au
           WHERE au.id = l.assigned_to_user_id
             AND au.report_to_id = $1
             AND au.deleted_at IS NULL
        )
        OR EXISTS (
          SELECT 1
            FROM lead_assignments la_team_scope
            JOIN users au2 ON au2.id = COALESCE(la_team_scope.assigned_to_user_id, la_team_scope.user_id)
           WHERE la_team_scope.lead_id = l.id
             AND la_team_scope.unassigned_at IS NULL
             AND au2.report_to_id = $1
             AND au2.deleted_at IS NULL
        )
      )`,
      params: [user.id],
    };
  }
  return { sql: 'FALSE', params: [] };
}

const getLeadConversationScope = getLeadCommunicationScope;

module.exports = {
  LEAD_COMMUNICATION_FORBIDDEN,
  LEAD_COMMUNICATION_FORBIDDEN_MESSAGE,
  getLeadByIdForCommunication,
  canAccessLeadCommunication,
  assertLeadCommunicationAccess,
  getLeadCommunicationScope,
  getLeadConversationScope,
};
