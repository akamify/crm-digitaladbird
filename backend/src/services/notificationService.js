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

async function notifyLeadAssigned(userId, count, metadata = {}, runner = null) {
  const safeCount = Number(count || 0);
  if (!safeCount) return;
  const title = safeCount === 1 ? 'New lead assigned' : `${safeCount} leads assigned`;
  const body = safeCount === 1
    ? '1 lead has been assigned to you. Please follow up from your lead dashboard.'
    : `${safeCount} leads have been assigned to you. Please follow up from your lead dashboard.`;
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
  notifyLeadRequestCreated,
  notifyLeadRequestResolved,
};
