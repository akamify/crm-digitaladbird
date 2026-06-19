const { query } = require('../config/database');
const { AppError } = require('../utils/errors');

const LEAD_COMMUNICATION_FORBIDDEN = 'LEAD_COMMUNICATION_FORBIDDEN';
const LEAD_COMMUNICATION_FORBIDDEN_MESSAGE = 'You can communicate only with leads assigned to you.';

async function loadLead(leadId, runner = { query }) {
  const { rows: [lead] } = await runner.query(
    `SELECT l.id, l.full_name, l.phone, l.email, l.source, l.campaign_name,
            l.campaign_label, l.meta_form_id, l.stage, l.call_status,
            l.assigned_to_user_id, l.deleted_at,
            u.full_name AS assigned_to_name,
            u.report_to_id AS assigned_user_rm_id
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to_user_id
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
    return {
      allowed: lead.assigned_to_user_id === user.id,
      reason: lead.assigned_to_user_id === user.id ? 'assigned_user' : 'not_assigned',
      lead,
    };
  }

  if (user.role === 'rm') {
    return {
      allowed: lead.assigned_user_rm_id === user.id,
      reason: lead.assigned_user_rm_id === user.id ? 'rm_team' : 'outside_rm_team',
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
    return { sql: 'l.assigned_to_user_id = $1', params: [user.id] };
  }
  if (user.role === 'rm') {
    return {
      sql: `EXISTS (
        SELECT 1 FROM users au
         WHERE au.id = l.assigned_to_user_id
           AND au.report_to_id = $1
           AND au.deleted_at IS NULL
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
