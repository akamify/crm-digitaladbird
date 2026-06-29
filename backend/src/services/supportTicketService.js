const { query, withTransaction } = require('../config/database');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');
const notifications = require('./notifications/notificationService');
const templates = require('./notifications/notificationTemplates');

const ADMIN_ROLES = new Set(['super_admin', 'admin']);
const ALLOWED_CREATOR_ROLES = new Set(['rm', 'member', 'partner']);
const STATUS_VALUES = new Set(['open', 'solved', 'not_solved']);

function isAdmin(user) {
  return ADMIN_ROLES.has(user?.role);
}

function trim(value) {
  return String(value || '').trim();
}

function normalizeStatus(status) {
  const value = trim(status).toLowerCase();
  return STATUS_VALUES.has(value) ? value : null;
}

function pageParams(input = {}) {
  const page = Math.max(1, Number(input.page) || 1);
  const pageSize = Math.min(50, Math.max(5, Number(input.page_size || input.pageSize) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function ticketRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    ticketNo: row.ticket_no,
    ticket_no: row.ticket_no,
    createdByUserId: row.created_by_user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    cpId: row.cp_id,
    cp_id: row.cp_id,
    role: row.role,
    subject: row.subject,
    body: row.body,
    status: row.status,
    lastAdminNote: row.last_admin_note,
    last_admin_note: row.last_admin_note,
    solvedAt: row.solved_at,
    solved_at: row.solved_at,
    notSolvedAt: row.not_solved_at,
    not_solved_at: row.not_solved_at,
    resolvedByUserId: row.resolved_by_user_id,
    resolvedByName: row.resolved_by_name || null,
    createdAt: row.created_at,
    created_at: row.created_at,
    updatedAt: row.updated_at,
    updated_at: row.updated_at,
  };
}

function historyRow(row) {
  return {
    id: row.id,
    action: row.action,
    status: row.status,
    adminNote: row.admin_note,
    admin_note: row.admin_note,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name || null,
    createdAt: row.created_at,
    created_at: row.created_at,
  };
}

async function getUser(userId, runner = null) {
  const db = runner?.query ? runner : { query };
  const { rows: [user] } = await db.query(
    `SELECT id, full_name, email, phone, role, cp_id
       FROM users
      WHERE id = $1
        AND deleted_at IS NULL`,
    [userId],
  );
  return user || null;
}

function validateCreateInput(actor, user, body = {}) {
  if (!ALLOWED_CREATOR_ROLES.has(actor?.role)) {
    throw new AppError(403, 'SUPPORT_TICKET_FORBIDDEN', 'You are not allowed to raise support tickets.');
  }
  const phone = trim(body.phone || user?.phone);
  const subject = trim(body.subject);
  const description = trim(body.body || body.description || body.problem);

  if (!phone) throw new AppError(400, 'SUPPORT_PHONE_REQUIRED', 'Phone number is required.');
  if (phone.length < 8 || phone.length > 20) throw new AppError(400, 'SUPPORT_PHONE_INVALID', 'Enter a valid phone number.');
  if (!subject) throw new AppError(400, 'SUPPORT_SUBJECT_REQUIRED', 'Subject is required.');
  if (subject.length > 180) throw new AppError(400, 'SUPPORT_SUBJECT_TOO_LONG', 'Subject must be 180 characters or less.');
  if (!description) throw new AppError(400, 'SUPPORT_DESCRIPTION_REQUIRED', 'Problem description is required.');
  if (description.length > 3000) throw new AppError(400, 'SUPPORT_DESCRIPTION_TOO_LONG', 'Problem description must be 3000 characters or less.');

  return { phone, subject, description };
}

async function bestEffortTicketCreated(ticket) {
  try {
    await notifications.notifyAdmins(
      'support_ticket_created',
      'New support ticket raised',
      `${ticket.name} raised ${ticket.ticket_no}: ${ticket.subject}`,
      { ticket_id: ticket.id, ticket_no: ticket.ticket_no, status: ticket.status },
    );
  } catch (err) {
    logger.warn({ ticketId: ticket.id, err: err.message }, '[Support] admin notification failed');
  }

  try {
    await notifications.createUserNotification({
      userId: ticket.created_by_user_id,
      type: 'support_ticket_submitted',
      title: 'Support ticket submitted',
      body: `Your ticket ${ticket.ticket_no} was submitted successfully.`,
      metadata: { ticket_id: ticket.id, ticket_no: ticket.ticket_no, status: ticket.status },
      eventType: 'support_ticket_submitted',
      entityType: 'support_ticket',
      entityId: ticket.id,
      dedupeKey: `support_ticket_submitted:${ticket.id}`,
      email: templates.shell({
        title: `Support ticket submitted: ${ticket.ticket_no}`,
        body: `Your support ticket has been submitted successfully.\n\nSubject: ${ticket.subject}\n\nStatus: Open`,
        actionUrl: templates.frontendUrl('/support'),
      }),
      emailType: 'support_ticket_created',
    });
  } catch (err) {
    logger.warn({ ticketId: ticket.id, err: err.message }, '[Support] creator notification failed');
  }
}

function statusEmail(ticket, actorName) {
  const label = ticket.status === 'solved' ? 'Solved' : 'Not solved';
  const actionUrl = templates.frontendUrl('/support');
  const when = ticket.status === 'solved' ? ticket.solved_at : ticket.not_solved_at;
  return templates.shell({
    title: `Support ticket update: ${ticket.ticket_no}`,
    body: [
      `Your support ticket status is now ${label}.`,
      `Subject: ${ticket.subject}`,
      `Admin note: ${ticket.last_admin_note || 'No note provided.'}`,
      `Updated by: ${actorName || 'Admin'}`,
      when ? `Updated at: ${new Date(when).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST` : '',
    ].filter(Boolean).join('\n\n'),
    actionUrl,
  });
}

async function bestEffortTicketUpdated(ticket, actor) {
  const label = ticket.status === 'solved' ? 'solved' : 'not solved';
  const metadata = { ticket_id: ticket.id, ticket_no: ticket.ticket_no, status: ticket.status, admin_note: ticket.last_admin_note };

  try {
    await notifications.createUserNotification({
      userId: ticket.created_by_user_id,
      type: 'support_ticket_updated',
      title: `Support ticket ${label}`,
      body: `${ticket.ticket_no}: ${ticket.last_admin_note || `Marked ${label}.`}`,
      metadata,
      eventType: 'support_ticket_updated',
      entityType: 'support_ticket',
      entityId: ticket.id,
      dedupeKey: `support_ticket_updated:${ticket.id}:${ticket.status}:${ticket.updated_at}`,
      email: statusEmail(ticket, actor?.full_name || actor?.name),
      emailType: 'support_ticket_update',
    });
  } catch (err) {
    logger.warn({ ticketId: ticket.id, status: ticket.status, err: err.message }, '[Support] creator status notification/email failed');
  }

  try {
    await notifications.notifyAdmins(
      'support_ticket_updated',
      'Support ticket updated',
      `${ticket.ticket_no} was marked ${label}.`,
      metadata,
    );
  } catch (err) {
    logger.warn({ ticketId: ticket.id, err: err.message }, '[Support] admin update notification failed');
  }
}

async function createTicket(actor, body = {}) {
  const user = await getUser(actor.id);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
  const input = validateCreateInput(actor, user, body);

  const { rows: [created] } = await query(
    `INSERT INTO support_tickets(created_by_user_id, name, email, phone, cp_id, role, subject, body)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
    [
      user.id,
      trim(body.name) || user.full_name || actor.name || 'CRM User',
      trim(body.email) || user.email,
      input.phone,
      user.cp_id || null,
      user.role,
      input.subject,
      input.description,
    ],
  );

  await query(
    `INSERT INTO support_ticket_history(ticket_id, actor_user_id, action, status)
       VALUES($1,$2,'created','open')`,
    [created.id, actor.id],
  ).catch(err => logger.warn({ ticketId: created.id, err: err.message }, '[Support] history insert failed'));

  bestEffortTicketCreated(created).catch(err => {
    logger.warn({ ticketId: created.id, err: err.message }, '[Support] post-create notification failed');
  });
  return ticketRow(created);
}

async function listMyTickets(actor, filters = {}) {
  const { page, pageSize, offset } = pageParams(filters);
  const values = [actor.id];
  const where = ['t.created_by_user_id = $1'];
  let index = 2;

  const status = normalizeStatus(filters.status);
  if (status) {
    where.push(`t.status = $${index++}`);
    values.push(status);
  }
  const search = trim(filters.search || filters.q);
  if (search) {
    where.push(`(t.ticket_no ILIKE $${index} OR t.subject ILIKE $${index} OR t.body ILIKE $${index})`);
    values.push(`%${search}%`);
    index++;
  }

  const order = String(filters.sort || filters.order || 'newest') === 'oldest' ? 'ASC' : 'DESC';
  const count = await query(`SELECT COUNT(*)::int AS total FROM support_tickets t WHERE ${where.join(' AND ')}`, values);
  values.push(pageSize, offset);
  const { rows } = await query(
    `SELECT t.*, ru.full_name AS resolved_by_name
       FROM support_tickets t
       LEFT JOIN users ru ON ru.id = t.resolved_by_user_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.created_at ${order}
      LIMIT $${index++} OFFSET $${index}`,
    values,
  );
  return { rows: rows.map(ticketRow), pagination: { page, page_size: pageSize, total: count.rows[0]?.total || 0 } };
}

async function listAdminTickets(actor, filters = {}) {
  if (!isAdmin(actor)) throw new AppError(403, 'SUPPORT_TICKET_FORBIDDEN', 'You are not allowed to view support tickets.');
  const { page, pageSize, offset } = pageParams(filters);
  const values = [];
  const where = [];
  let index = 1;

  const status = normalizeStatus(filters.status);
  if (status) {
    where.push(`t.status = $${index++}`);
    values.push(status);
  }
  const role = trim(filters.role).toLowerCase();
  if (role && ['rm', 'member', 'partner'].includes(role)) {
    where.push(`t.role = $${index++}`);
    values.push(role);
  }
  const search = trim(filters.search || filters.q);
  if (search) {
    where.push(`(t.ticket_no ILIKE $${index} OR t.name ILIKE $${index} OR t.email ILIKE $${index} OR t.phone ILIKE $${index} OR COALESCE(t.cp_id,'') ILIKE $${index} OR t.subject ILIKE $${index})`);
    values.push(`%${search}%`);
    index++;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sort = String(filters.sort || 'newest');
  const orderBy = sort === 'oldest' ? 't.created_at ASC' : sort === 'status' ? 't.status ASC, t.created_at DESC' : 't.created_at DESC';
  const count = await query(`SELECT COUNT(*)::int AS total FROM support_tickets t ${whereSql}`, values);
  values.push(pageSize, offset);
  const { rows } = await query(
    `SELECT t.*, ru.full_name AS resolved_by_name
       FROM support_tickets t
       LEFT JOIN users ru ON ru.id = t.resolved_by_user_id
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT $${index++} OFFSET $${index}`,
    values,
  );
  return { rows: rows.map(ticketRow), pagination: { page, page_size: pageSize, total: count.rows[0]?.total || 0 } };
}

async function getTicket(actor, ticketId) {
  const { rows: [ticket] } = await query(
    `SELECT t.*, ru.full_name AS resolved_by_name
       FROM support_tickets t
       LEFT JOIN users ru ON ru.id = t.resolved_by_user_id
      WHERE t.id::text = $1 OR t.ticket_no = $1`,
    [ticketId],
  );
  if (!ticket) throw new AppError(404, 'SUPPORT_TICKET_NOT_FOUND', 'Support ticket not found.');
  if (!isAdmin(actor) && ticket.created_by_user_id !== actor.id) {
    throw new AppError(403, 'SUPPORT_TICKET_FORBIDDEN', 'You are not allowed to view this ticket.');
  }
  const { rows: history } = await query(
    `SELECT h.*, u.full_name AS actor_name
       FROM support_ticket_history h
       LEFT JOIN users u ON u.id = h.actor_user_id
      WHERE h.ticket_id = $1
      ORDER BY h.created_at DESC`,
    [ticket.id],
  );
  return { ...ticketRow(ticket), history: history.map(historyRow) };
}

async function updateTicketStatus(actor, ticketId, statusValue, noteValue) {
  if (!isAdmin(actor)) throw new AppError(403, 'SUPPORT_TICKET_FORBIDDEN', 'You are not allowed to update support tickets.');
  const status = normalizeStatus(statusValue);
  if (!['solved', 'not_solved'].includes(status)) {
    throw new AppError(400, 'INVALID_SUPPORT_TICKET_STATUS', 'Status must be solved or not_solved.');
  }
  const note = trim(noteValue);
  if (!note) throw new AppError(400, 'ADMIN_NOTE_REQUIRED', 'Admin note is required.');
  if (note.length > 1500) throw new AppError(400, 'ADMIN_NOTE_TOO_LONG', 'Admin note must be 1500 characters or less.');

  const result = await withTransaction(async (client) => {
    const { rows: [ticket] } = await client.query(
      `UPDATE support_tickets
          SET status = $2::text,
              last_admin_note = $3::text,
              solved_at = CASE WHEN $2::text = 'solved' THEN NOW() ELSE solved_at END,
              not_solved_at = CASE WHEN $2::text = 'not_solved' THEN NOW() ELSE not_solved_at END,
              resolved_by_user_id = $4,
              updated_at = NOW()
        WHERE (id::text = $1 OR ticket_no = $1)
          AND status = 'open'
        RETURNING *`,
      [ticketId, status, note, actor.id],
    );
    if (!ticket) {
      const { rows: [existing] } = await client.query(
        `SELECT id, status
           FROM support_tickets
          WHERE id::text = $1 OR ticket_no = $1`,
        [ticketId],
      );
      if (!existing) throw new AppError(404, 'SUPPORT_TICKET_NOT_FOUND', 'Support ticket not found.');
      throw new AppError(409, 'SUPPORT_TICKET_ALREADY_CLOSED', 'This ticket has already been marked solved or not solved.');
    }
    await client.query(
      `INSERT INTO support_ticket_history(ticket_id, actor_user_id, action, status, admin_note)
         VALUES($1,$2,'status_update',$3,$4)`,
      [ticket.id, actor.id, status, note],
    );
    return ticket;
  });

  bestEffortTicketUpdated(result, actor).catch(err => {
    logger.warn({ ticketId: result.id, err: err.message }, '[Support] post-update notification failed');
  });
  return ticketRow(result);
}

module.exports = {
  createTicket,
  listMyTickets,
  listAdminTickets,
  getTicket,
  updateTicketStatus,
};
