const { query } = require('../config/database');
const logger = require('../utils/logger');

function runnerQuery(runner, sql, params = []) {
  if (runner?.query) return runner.query(sql, params);
  return query(sql, params);
}

function emitNotification(userId, notification) {
  try {
    const { emitToUser } = require('./socketService');
    emitToUser(userId, 'notification:new', notification);
  } catch (_) {
    // Socket notifications are best-effort; database persistence is primary.
  }
}

async function notifyUser(userId, type, title, body, metadata = {}, runner = null) {
  if (!userId || !type || !title) return null;
  try {
    const { rows: [created] } = await runnerQuery(
      runner,
      `INSERT INTO user_notifications(user_id, type, title, body, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, type, title, body || null, JSON.stringify(metadata || {})],
    );
    emitNotification(userId, created || { user_id: userId, type, title, body, metadata });
    return created || null;
  } catch (err) {
    logger.warn({ err: err.message, userId, type }, '[Notification] user notification skipped');
    return null;
  }
}

async function notifyUsers(userIds, type, title, body, metadata = {}, runner = null) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean))];
  for (const userId of uniqueIds) {
    await notifyUser(userId, type, title, body, metadata, runner);
  }
}

async function notifyAdmins(type, title, body, metadata = {}, runner = null) {
  try {
    await runnerQuery(
      runner,
      `INSERT INTO admin_notifications(type, title, body, metadata)
       VALUES ($1, $2, $3, $4)`,
      [type, title, body || null, JSON.stringify(metadata || {})],
    );
  } catch (err) {
    logger.warn({ err: err.message, type }, '[Notification] admin notification skipped');
  }

  try {
    const { rows } = await runnerQuery(
      runner,
      `SELECT id FROM users
        WHERE role IN ('super_admin', 'admin')
          AND deleted_at IS NULL
          AND COALESCE(status, 'active') = 'active'`,
    );
    await notifyUsers(rows.map(r => r.id), type, title, body, metadata, runner);
  } catch (err) {
    logger.warn({ err: err.message, type }, '[Notification] admin user fanout skipped');
  }
}

async function fetchLeadForNotification(leadId, runner = null) {
  if (!leadId) return null;
  try {
    const { rows: [lead] } = await runnerQuery(
      runner,
      `SELECT l.id, l.full_name, l.phone, l.source, l.campaign_name,
              l.meta_campaign_id, l.campaign_label, l.meta_form_id,
              l.form_name, f.form_name AS meta_form_name
         FROM leads l
         LEFT JOIN meta_forms f ON f.form_id = l.meta_form_id
        WHERE l.id = $1
        LIMIT 1`,
      [leadId],
    );
    return lead || null;
  } catch (err) {
    logger.warn({ err: err.message, leadId }, '[Notification] lead lookup skipped');
    return null;
  }
}

async function isDirectLeadAssignee(userId, runner = null) {
  if (!userId) return false;
  try {
    const { rows: [user] } = await runnerQuery(
      runner,
      `SELECT role, status, deleted_at
         FROM users
        WHERE id = $1
        LIMIT 1`,
      [userId],
    );
    return !!user && ['member', 'partner'].includes(user.role) && user.status === 'active' && !user.deleted_at;
  } catch (err) {
    logger.warn({ err: err.message, userId }, '[Notification] assignee role check skipped');
    return false;
  }
}

function buildLeadAssignedMessage(lead) {
  const bits = [];
  if (lead?.full_name) bits.push(lead.full_name);
  if (lead?.phone) bits.push(lead.phone);
  if (lead?.campaign_name) bits.push(lead.campaign_name);
  if (lead?.meta_form_name || lead?.form_name) bits.push(lead.meta_form_name || lead.form_name);
  return bits.length
    ? `A new lead has been assigned to you: ${bits.join(' | ')}.`
    : 'A new lead has been assigned to you.';
}

async function notifyLeadAssignedDetailed(input, runner = null) {
  const assignedToUserId = input.assignedToUserId || input.userId;
  if (!(await isDirectLeadAssignee(assignedToUserId, runner))) return null;

  const lead = input.lead || await fetchLeadForNotification(input.leadId || input.lead_id, runner);
  const metadata = {
    lead_id: lead?.id || input.leadId || input.lead_id || null,
    lead_name: lead?.full_name || null,
    lead_phone: lead?.phone || null,
    campaign_name: lead?.campaign_name || lead?.campaign_label || null,
    source: lead?.source || input.assignmentSource || null,
    form_id: lead?.meta_form_id || null,
    form_name: lead?.meta_form_name || lead?.form_name || null,
    assigned_by: input.assignedBy || null,
    assignment_source: input.assignmentSource || null,
    ...(input.metadata || {}),
  };

  return notifyUser(
    assignedToUserId,
    'lead_assigned',
    'New lead assigned',
    buildLeadAssignedMessage(lead),
    metadata,
    runner,
  );
}

async function notifyLeadAssigned(userIdOrInput, count, metadata = {}, runner = null) {
  if (userIdOrInput && typeof userIdOrInput === 'object' && !Array.isArray(userIdOrInput)) {
    return notifyLeadAssignedDetailed(userIdOrInput, count || runner);
  }
  const userId = userIdOrInput;
  const safeCount = Number(count || 0);
  if (!safeCount) return;
  if (Array.isArray(metadata?.lead_ids) && metadata.lead_ids.length) {
    for (const leadId of metadata.lead_ids) {
      await notifyLeadAssignedDetailed({
        leadId,
        assignedToUserId: userId,
        assignedBy: metadata.assigned_by || metadata.assignedBy || null,
        assignmentSource: metadata.assignment_type || metadata.assignmentSource || null,
        metadata: { ...metadata, lead_id: leadId },
      }, runner);
    }
    return null;
  }
  if (safeCount === 1 && metadata?.lead_id) {
    return notifyLeadAssignedDetailed({
      leadId: metadata.lead_id,
      assignedToUserId: userId,
      assignedBy: metadata.assigned_by || metadata.assignedBy || null,
      assignmentSource: metadata.assignment_type || metadata.assignmentSource || null,
      metadata,
    }, runner);
  }
  if (!(await isDirectLeadAssignee(userId, runner))) return null;
  const title = safeCount === 1 ? 'New lead assigned' : `${safeCount} leads assigned`;
  const body = safeCount === 1
    ? 'A new lead has been assigned to you.'
    : `${safeCount} new leads have been assigned to you.`;
  await notifyUser(userId, 'lead_assigned', title, body, { count: safeCount, ...metadata }, runner);
}

async function notifyLeadRequestCreated({ requestId, requesterId, requesterName, requesterRole, rmId, quantity, category, assigned = 0 }, runner = null) {
  const type = 'lead_request';
  const title = 'New lead request';
  const body = `${requesterName || 'A user'} requested ${quantity} lead(s)${category ? ` for ${category}` : ''}${assigned ? `; ${assigned} assigned immediately` : ''}.`;
  const metadata = { request_id: requestId, requester_id: requesterId, requester_role: requesterRole, quantity, category, assigned };

  await notifyAdmins(type, title, body, metadata, runner);
  if (rmId) await notifyUser(rmId, type, title, body, metadata, runner);
  await notifyUser(
    requesterId,
    'lead_request_submitted',
    'Lead request submitted',
    assigned ? `Your request for ${quantity} lead(s) was submitted. ${assigned} lead(s) assigned immediately.` : `Your request for ${quantity} lead(s) was submitted.`,
    metadata,
    runner,
  );
}

async function notifyLeadRequestResolved({ requestId, requesterId, quantity, assigned = 0, status, note = null }, runner = null) {
  const rejected = status === 'rejected';
  const partial = !rejected && Number(assigned || 0) < Number(quantity || 0);
  const title = rejected ? 'Lead request rejected' : partial ? 'Lead request partially fulfilled' : 'Lead request fulfilled';
  const body = rejected
    ? `Your request for ${quantity} lead(s) was rejected${note ? `: ${note}` : ''}.`
    : partial
      ? `${assigned} of ${quantity} requested lead(s) have been assigned. Remaining leads will be fulfilled when available.`
      : `${assigned || quantity} lead(s) have been assigned for your request.`;
  await notifyUser(requesterId, rejected ? 'request_rejected' : partial ? 'request_partially_fulfilled' : 'leads_delivered', title, body, {
    request_id: requestId,
    quantity,
    assigned,
    status,
    note,
  }, runner);
}

module.exports = {
  notifyUser,
  notifyUsers,
  notifyAdmins,
  notifyLeadAssigned,
  notifyLeadAssignedDetailed,
  notifyLeadRequestCreated,
  notifyLeadRequestResolved,
};
