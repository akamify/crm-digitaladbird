const { query } = require('../../config/database');
const logger = require('../../utils/logger');

function runnerQuery(runner, sql, params = []) {
  if (runner?.query) return runner.query(sql, params);
  return query(sql, params);
}

function activeUserWhere(alias = 'u') {
  return `${alias}.deleted_at IS NULL AND COALESCE(${alias}.status, 'active') = 'active'`;
}

async function getUser(userId, runner = null) {
  if (!userId) return null;
  try {
    const { rows: [user] } = await runnerQuery(
      runner,
      `SELECT id, full_name, email, phone, cp_id, role, report_to_id, status, deleted_at
         FROM users
        WHERE id = $1
        LIMIT 1`,
      [userId],
    );
    return user || null;
  } catch (err) {
    logger.warn({ err: err.message, userId }, '[NotificationRecipients] user lookup failed');
    return null;
  }
}

async function getUserRm(userId, runner = null) {
  const user = await getUser(userId, runner);
  if (!user?.report_to_id) return null;
  return getUser(user.report_to_id, runner);
}

async function getAdminsAndSuperAdmins(runner = null) {
  try {
    const { rows } = await runnerQuery(
      runner,
      `SELECT id, full_name, email, role, report_to_id, status, deleted_at
         FROM users u
        WHERE role IN ('super_admin', 'admin')
          AND ${activeUserWhere('u')}`,
    );
    return rows;
  } catch (err) {
    logger.warn({ err: err.message }, '[NotificationRecipients] admin lookup failed');
    return [];
  }
}

function isActiveRecipient(user) {
  return !!user && !user.deleted_at && (user.status || 'active') === 'active';
}

function dedupeRecipients(recipients = []) {
  const seen = new Set();
  const out = [];
  for (const recipient of recipients) {
    if (!isActiveRecipient(recipient) || seen.has(recipient.id)) continue;
    seen.add(recipient.id);
    out.push(recipient);
  }
  return out;
}

module.exports = {
  getUser,
  getUserRm,
  getAdminsAndSuperAdmins,
  dedupeRecipients,
  isActiveRecipient,
};

