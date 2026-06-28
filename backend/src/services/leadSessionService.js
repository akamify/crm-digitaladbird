const { query, withTransaction } = require('../config/database');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

const MAX_SESSION_NAME = 150;
const MAX_NOTES = 1000;
const TIMEZONE_DEFAULT = 'Asia/Kolkata';

function normalizeDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === text ? text : null;
}

function normalizeTime(value) {
  const text = String(value || '').trim();
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!match) return null;
  return `${match[1]}:${match[2]}:${match[3] || '00'}`;
}

function normalizePayload(body = {}, partial = false) {
  const rawName = body.session_name ?? body.sessionName ?? body.webinar_name ?? body.webinarName;
  const rawDate = body.session_date ?? body.sessionDate;
  const rawTime = body.session_time ?? body.sessionTime;
  const rawTimezone = body.timezone;
  const rawNotes = body.notes;
  const payload = {};

  if (!partial || rawName !== undefined) {
    const sessionName = String(rawName || '').trim();
    if (!sessionName) throw new AppError(400, 'SESSION_NAME_REQUIRED', 'Session name is required.');
    if (sessionName.length > MAX_SESSION_NAME) throw new AppError(400, 'SESSION_NAME_TOO_LONG', 'Session name must be 150 characters or less.');
    payload.sessionName = sessionName;
  }

  if (!partial || rawDate !== undefined) {
    const sessionDate = normalizeDate(rawDate);
    if (!sessionDate) throw new AppError(400, 'INVALID_SESSION_DATE', 'Session date must be a valid date.');
    payload.sessionDate = sessionDate;
  }

  if (!partial || rawTime !== undefined) {
    const sessionTime = normalizeTime(rawTime);
    if (!sessionTime) throw new AppError(400, 'INVALID_SESSION_TIME', 'Session time must be HH:mm or HH:mm:ss.');
    payload.sessionTime = sessionTime;
  }

  if (!partial || rawTimezone !== undefined) {
    payload.timezone = String(rawTimezone || TIMEZONE_DEFAULT).trim() || TIMEZONE_DEFAULT;
  }

  if (!partial || rawNotes !== undefined) {
    const notes = rawNotes === null || rawNotes === undefined ? null : String(rawNotes).trim();
    if (notes && notes.length > MAX_NOTES) throw new AppError(400, 'SESSION_NOTES_TOO_LONG', 'Notes must be 1000 characters or less.');
    payload.notes = notes || null;
  }

  if (partial && Object.keys(payload).length === 0) {
    throw new AppError(400, 'NO_SESSION_CHANGES', 'Provide at least one field to update.');
  }

  return payload;
}

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    leadId: row.lead_id,
    sessionName: row.session_name,
    webinarName: row.session_name,
    sessionDate: row.session_date,
    sessionTime: row.session_time,
    timezone: row.timezone,
    notes: row.notes,
    createdBy: row.created_by_name || null,
    updatedBy: row.updated_by_name || null,
    createdByUserId: row.created_by_user_id || null,
    updatedByUserId: row.updated_by_user_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertLeadSessionAccess(user, leadId, runner = query) {
  const run = runner.query ? runner.query.bind(runner) : runner;
  const { rows: [lead] } = await run(
    `SELECT l.id, l.assigned_to_user_id, l.pool_rm_id,
            assigned_user.report_to_id AS assigned_user_rm_id
       FROM leads l
       LEFT JOIN users assigned_user ON assigned_user.id = l.assigned_to_user_id
      WHERE l.id = $1 AND l.deleted_at IS NULL`,
    [leadId],
  );

  if (!lead) throw new AppError(404, 'NOT_FOUND', 'Lead not found');
  if (user.role === 'super_admin' || user.role === 'admin') return lead;
  if ((user.role === 'member' || user.role === 'partner') && lead.assigned_to_user_id === user.id) return lead;
  if (user.role === 'rm' && (lead.assigned_user_rm_id === user.id || lead.pool_rm_id === user.id)) return lead;
  throw new AppError(403, 'FORBIDDEN', 'You are not allowed to manage sessions for this lead.');
}

async function getSessionForLead(leadId, sessionId, runner = query) {
  const run = runner.query ? runner.query.bind(runner) : runner;
  const { rows: [session] } = await run(
    `SELECT s.*, cb.full_name AS created_by_name, ub.full_name AS updated_by_name
       FROM lead_sessions s
       LEFT JOIN users cb ON cb.id = s.created_by_user_id
       LEFT JOIN users ub ON ub.id = s.updated_by_user_id
      WHERE s.id = $1 AND s.lead_id = $2 AND s.deleted_at IS NULL`,
    [sessionId, leadId],
  );
  if (!session) throw new AppError(404, 'NOT_FOUND', 'Session not found');
  return session;
}

async function logSessionActivity({ user, leadId, sessionId, action, metadata }) {
  try {
    await query(
      `INSERT INTO activity_logs(user_id, user_name, user_role, entity, entity_id, action, metadata)
       VALUES ($1, $2, $3, 'lead_session', $4, $5, $6)`,
      [
        user.id,
        user.full_name || user.name || null,
        user.role || null,
        sessionId || leadId,
        action,
        JSON.stringify({ lead_id: leadId, session_id: sessionId, ...(metadata || {}) }),
      ],
    );
  } catch (error) {
    logger.warn({ err: error.message, leadId, sessionId, action }, '[LeadSessions] activity log skipped');
  }
}

async function listLeadSessions({ user, leadId }) {
  await assertLeadSessionAccess(user, leadId);
  const { rows } = await query(
    `SELECT s.*, cb.full_name AS created_by_name, ub.full_name AS updated_by_name
       FROM lead_sessions s
       LEFT JOIN users cb ON cb.id = s.created_by_user_id
       LEFT JOIN users ub ON ub.id = s.updated_by_user_id
      WHERE s.lead_id = $1 AND s.deleted_at IS NULL
      ORDER BY s.session_date DESC, s.session_time DESC, s.created_at DESC`,
    [leadId],
  );
  return rows.map(mapSession);
}

async function createLeadSession({ user, leadId, body }) {
  const payload = normalizePayload(body);
  const session = await withTransaction(async (client) => {
    await assertLeadSessionAccess(user, leadId, client);
    const { rows: [created] } = await client.query(
      `INSERT INTO lead_sessions(
         lead_id, session_name, session_date, session_time, timezone, notes,
         created_by_user_id, updated_by_user_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       RETURNING *`,
      [leadId, payload.sessionName, payload.sessionDate, payload.sessionTime, payload.timezone, payload.notes, user.id],
    );
    return created;
  });
  await logSessionActivity({ user, leadId, sessionId: session.id, action: 'lead_session_added', metadata: { session_name: session.session_name } });
  return mapSession(await getSessionForLead(leadId, session.id));
}

async function updateLeadSession({ user, leadId, sessionId, body }) {
  const payload = normalizePayload(body, true);
  const session = await withTransaction(async (client) => {
    await assertLeadSessionAccess(user, leadId, client);
    await getSessionForLead(leadId, sessionId, client);

    const sets = ['updated_by_user_id = $1'];
    const params = [user.id];
    if (payload.sessionName !== undefined) { params.push(payload.sessionName); sets.push(`session_name = $${params.length}`); }
    if (payload.sessionDate !== undefined) { params.push(payload.sessionDate); sets.push(`session_date = $${params.length}`); }
    if (payload.sessionTime !== undefined) { params.push(payload.sessionTime); sets.push(`session_time = $${params.length}`); }
    if (payload.timezone !== undefined) { params.push(payload.timezone); sets.push(`timezone = $${params.length}`); }
    if (payload.notes !== undefined) { params.push(payload.notes); sets.push(`notes = $${params.length}`); }
    params.push(sessionId, leadId);

    const { rows: [updated] } = await client.query(
      `UPDATE lead_sessions SET ${sets.join(', ')}
        WHERE id = $${params.length - 1} AND lead_id = $${params.length} AND deleted_at IS NULL
        RETURNING *`,
      params,
    );
    return updated;
  });
  await logSessionActivity({ user, leadId, sessionId, action: 'lead_session_updated', metadata: { session_name: session.session_name } });
  return mapSession(await getSessionForLead(leadId, sessionId));
}

async function deleteLeadSession({ user, leadId, sessionId }) {
  const session = await withTransaction(async (client) => {
    await assertLeadSessionAccess(user, leadId, client);
    await getSessionForLead(leadId, sessionId, client);
    const { rows: [deleted] } = await client.query(
      `UPDATE lead_sessions
          SET deleted_at = NOW(), updated_by_user_id = $1
        WHERE id = $2 AND lead_id = $3 AND deleted_at IS NULL
        RETURNING *`,
      [user.id, sessionId, leadId],
    );
    return deleted;
  });
  await logSessionActivity({ user, leadId, sessionId, action: 'lead_session_deleted', metadata: { session_name: session.session_name } });
  return { id: sessionId, deleted: true };
}

module.exports = {
  listLeadSessions,
  createLeadSession,
  updateLeadSession,
  deleteLeadSession,
};
