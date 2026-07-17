const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { AppError } = require('../utils/errors');
const { logActivity } = require('../utils/auditLog');
const passwordResetService = require('./auth/passwordResetService');
const logger = require('../utils/logger');

const ADMIN_ROLES = new Set(['super_admin', 'admin']);

function trim(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
}

function normalizePhone(value) {
  const raw = trim(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (/^\+\d{10,15}$/.test(raw.replace(/[\s()-]/g, ''))) return raw.replace(/[\s()-]/g, '');
  throw new AppError(400, 'INVALID_CLIENT_PHONE', 'Enter a valid phone number.');
}

async function generateClientUserId(fullName) {
  const initials = String(fullName || 'client')
    .replace(/[^a-zA-Z\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .join('')
    .slice(0, 3)
    .toUpperCase() || 'CL';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const userId = `CL-${initials}-${suffix}`;
    const { rows } = await query(`SELECT 1 FROM users WHERE LOWER(emp_code) = LOWER($1) LIMIT 1`, [userId]);
    if (!rows.length) return userId;
  }
  return `CL-${Date.now().toString(36).toUpperCase()}`;
}

function assertAdmin(actor) {
  if (!ADMIN_ROLES.has(actor?.role)) throw new AppError(403, 'CLIENT_MANAGEMENT_FORBIDDEN', 'Only admins can manage clients.');
}

function validateClientInput(body = {}, partial = false) {
  const fullName = trim(body.full_name || body.name);
  const email = normalizeEmail(body.email);
  const phone = Object.prototype.hasOwnProperty.call(body, 'phone') ? normalizePhone(body.phone) : undefined;
  const userId = trim(body.user_id || body.emp_code);

  if (!partial || fullName) {
    if (fullName.length < 2 || fullName.length > 120) throw new AppError(400, 'INVALID_CLIENT_NAME', 'Client name must be 2-120 characters.');
  }
  if (!partial || email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
      throw new AppError(400, 'INVALID_CLIENT_EMAIL', 'Enter a valid client email.');
    }
  }
  if (userId) {
    if (!/^[a-zA-Z0-9._-]{3,60}$/.test(userId)) {
      throw new AppError(400, 'INVALID_CLIENT_USER_ID', 'Client user ID must be 3-60 letters, numbers, dot, underscore, or dash.');
    }
  }
  if (!partial && !phone) throw new AppError(400, 'CLIENT_PHONE_REQUIRED', 'Client phone is required.');

  return { fullName, email, phone, userId };
}

function logClientError(error, context = {}) {
  logger.error({
    ...context,
    code: error?.code || error?.errorCode || null,
    status: error?.status || error?.statusCode || null,
    message: error?.message,
    stack: error?.stack,
    db_code: error?.code || null,
    db_detail: error?.detail || null,
    db_table: error?.table || null,
    db_column: error?.column || null,
    db_constraint: error?.constraint || null,
  }, 'Client management operation failed');
}

function toClientCreateAppError(error) {
  if (error instanceof AppError) return error;
  if (error?.code === '22P02' && String(error.message || '').includes('user_role')) {
    return new AppError(
      500,
      'CLIENT_ROLE_MIGRATION_REQUIRED',
      'Client role is not available in the database. Run latest migrations and retry.',
    );
  }
  if (error?.code === '42703' || error?.code === '42P01') {
    return new AppError(
      500,
      'CLIENT_SCHEMA_MIGRATION_REQUIRED',
      'Client management database schema is not ready. Run latest migrations and retry.',
      {
        table: error.table || null,
        column: error.column || null,
        constraint: error.constraint || null,
      },
    );
  }
  return error;
}

function pageParams(input = {}) {
  const page = Math.max(1, Number(input.page) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(input.page_size || input.pageSize) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function clientSelect() {
  return `
    u.id, u.emp_code AS user_id, u.full_name, u.email, u.phone, u.role::text AS role,
    u.status::text AS status, u.created_at, u.updated_at, u.last_login_at,
    COUNT(DISTINCT p.id)::int AS pages_count,
    COUNT(DISTINCT a.id)::int AS ad_accounts_count,
    COUNT(DISTINCT c.id)::int AS campaigns_count,
    COUNT(DISTINCT l.id)::int AS leads_count,
    (COUNT(DISTINCT st.id) FILTER (WHERE st.status = 'open'))::int AS open_support_tickets
  `;
}

function mapClient(row) {
  return row ? {
    id: row.id,
    user_id: row.user_id,
    full_name: row.full_name,
    name: row.full_name,
    email: row.email,
    phone: row.phone,
    role: 'client',
    status: row.status,
    active: row.status === 'active',
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
    pages_count: Number(row.pages_count || 0),
    ad_accounts_count: Number(row.ad_accounts_count || 0),
    campaigns_count: Number(row.campaigns_count || 0),
    leads_count: Number(row.leads_count || 0),
    open_support_tickets: Number(row.open_support_tickets || 0),
  } : null;
}

async function listClients(actor, filters = {}) {
  assertAdmin(actor);
  const { page, pageSize, offset } = pageParams(filters);
  const search = trim(filters.search).toLowerCase();
  const status = trim(filters.status);
  const sort = ['full_name', 'created_at', 'status', 'last_login_at'].includes(filters.sort) ? filters.sort : 'created_at';
  const order = String(filters.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const params = [search ? `%${search}%` : '', status, pageSize, offset];

  const where = `
    u.deleted_at IS NULL
    AND COALESCE(u.is_hidden, FALSE) = FALSE
    AND u.role::text = 'client'
    AND ($1::text = '' OR LOWER(u.full_name) LIKE $1 OR LOWER(u.email) LIKE $1 OR LOWER(COALESCE(u.emp_code, '')) LIKE $1 OR COALESCE(u.phone, '') LIKE $1)
    AND ($2::text = '' OR $2::text = 'all' OR u.status::text = $2::text)
  `;

  const { rows: countRows } = await query(`SELECT COUNT(*)::int AS total FROM users u WHERE ${where}`, params.slice(0, 2));
  const { rows } = await query(
    `SELECT ${clientSelect()}
       FROM users u
       LEFT JOIN meta_pages p ON p.client_id = u.id
       LEFT JOIN meta_ad_accounts a ON a.client_id = u.id
       LEFT JOIN meta_campaigns c ON c.client_id = u.id
       LEFT JOIN leads l ON l.client_id = u.id AND l.deleted_at IS NULL
       LEFT JOIN support_tickets st ON st.created_by_user_id = u.id
      WHERE ${where}
      GROUP BY u.id
      ORDER BY u.${sort} ${order} NULLS LAST
      LIMIT $3 OFFSET $4`,
    params,
  );
  return { rows: rows.map(mapClient), pagination: { page, page_size: pageSize, total: countRows[0]?.total || 0 } };
}

async function getClient(actor, clientId) {
  assertAdmin(actor);
  const { rows: [row] } = await query(
    `SELECT ${clientSelect()}
       FROM users u
       LEFT JOIN meta_pages p ON p.client_id = u.id
       LEFT JOIN meta_ad_accounts a ON a.client_id = u.id
       LEFT JOIN meta_campaigns c ON c.client_id = u.id
       LEFT JOIN leads l ON l.client_id = u.id AND l.deleted_at IS NULL
       LEFT JOIN support_tickets st ON st.created_by_user_id = u.id
      WHERE u.id = $1 AND u.role::text = 'client' AND u.deleted_at IS NULL
      GROUP BY u.id`,
    [clientId],
  );
  if (!row) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found.');

  const [pages, adAccounts, campaigns, leads, tickets] = await Promise.all([
    query(`SELECT id, page_id, page_name, is_active, connection_status, token_last_checked, selected_at FROM meta_pages WHERE client_id = $1 ORDER BY page_name NULLS LAST, page_id`, [clientId]),
    query(`SELECT id, account_id, account_name, sync_status, last_attempted_sync_at, last_successful_sync_at, last_sync_error, total_returned_by_api, active_campaign_count, paused_campaign_count FROM meta_ad_accounts WHERE client_id = $1 ORDER BY account_name NULLS LAST, account_id`, [clientId]),
    query(`SELECT campaign_id, campaign_name, effective_status, configured_status, status, ui_status, last_synced_at, sync_status FROM meta_campaigns WHERE client_id = $1 ORDER BY updated_time DESC NULLS LAST, campaign_name`, [clientId]),
    query(`SELECT id, full_name, phone, email, source, campaign_name, created_at, call_status, stage FROM leads WHERE client_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`, [clientId]),
    query(`SELECT id, ticket_no, subject, status, created_at, updated_at FROM support_tickets WHERE created_by_user_id = $1 ORDER BY created_at DESC LIMIT 20`, [clientId]).catch(() => ({ rows: [] })),
  ]);

  return {
    client: mapClient(row),
    meta: { pages: pages.rows, ad_accounts: adAccounts.rows, campaigns: campaigns.rows },
    leads_summary: { recent: leads.rows },
    support_history: tickets.rows,
  };
}

async function createClient(actor, body = {}, req = {}) {
  assertAdmin(actor);
  try {
    const input = validateClientInput(body);
    const userId = await generateClientUserId(input.fullName);

    const { rows: [client] } = await query(
      `INSERT INTO users(emp_code, cp_id, full_name, email, phone, role, status, password_hash, is_available, lead_assignment_enabled, lead_assignment_status)
       VALUES($1, NULL, $2, $3, $4, 'client', COALESCE($5, 'active')::user_status, NULL, FALSE, FALSE, 'disabled')
       RETURNING id, emp_code AS user_id, full_name, email, phone, role::text AS role, status::text AS status, created_at, updated_at, NULL::timestamptz AS last_login_at,
                 0::int AS pages_count, 0::int AS ad_accounts_count, 0::int AS campaigns_count, 0::int AS leads_count, 0::int AS open_support_tickets`,
      [userId, input.fullName, input.email, input.phone, body.active === false ? 'inactive' : 'active'],
    ).catch((error) => {
      if (error?.code === '23505') throw new AppError(409, 'CLIENT_ALREADY_EXISTS', 'Client email, phone, or user ID already exists.');
      throw error;
    });

    let emailWarning = null;
    try {
      await passwordResetService.sendNewUserSetupLink({
        userId: client.id,
        createdByUser: actor,
        ipAddress: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
    } catch (error) {
      logger.warn({ clientId: client.id, code: error.code || 'CLIENT_ONBOARDING_EMAIL_FAILED', message: error.message }, 'Client created but onboarding email failed');
      emailWarning = error.code === 'EMAIL_PROVIDER_NOT_CONFIGURED'
        ? 'Client created, but the email provider is not configured.'
        : 'Client created, but onboarding email could not be sent.';
    }

    await logActivity({ user: actor, ip: req.ip, headers: req.headers || {} }, {
      entity: 'client',
      entity_id: client.id,
      action: 'client_created',
      metadata: { email: client.email, user_id: client.user_id, onboarding_email_warning: emailWarning },
    });
    return { ...mapClient(client), email_warning: emailWarning };
  } catch (error) {
    logClientError(error, {
      route: 'POST /api/admin/clients',
      actorId: actor?.id,
      actorRole: actor?.role,
      input: {
        has_name: Boolean(body?.full_name || body?.name),
        has_email: Boolean(body?.email),
        has_phone: Boolean(body?.phone),
        requested_user_id_ignored: Boolean(body?.user_id || body?.emp_code),
      },
    });
    throw toClientCreateAppError(error);
  }
}

async function updateClient(actor, clientId, body = {}, req = {}) {
  assertAdmin(actor);
  const input = validateClientInput(body, true);
  const sets = [];
  const params = [];
  if (input.fullName) { params.push(input.fullName); sets.push(`full_name = $${params.length}`); }
  if (input.email) { params.push(input.email); sets.push(`email = $${params.length}`); }
  if (input.phone !== undefined) { params.push(input.phone); sets.push(`phone = $${params.length}`); }
  if (input.userId) { params.push(input.userId); sets.push(`emp_code = $${params.length}`); }
  if (Object.prototype.hasOwnProperty.call(body, 'active')) {
    params.push(body.active === false ? 'inactive' : 'active');
    sets.push(`status = $${params.length}::user_status`);
  } else if (body.status) {
    const status = trim(body.status).toLowerCase();
    if (!['active', 'inactive', 'blocked'].includes(status)) throw new AppError(400, 'INVALID_CLIENT_STATUS', 'Invalid client status.');
    params.push(status);
    sets.push(`status = $${params.length}::user_status`);
  }
  if (body.password) {
    if (String(body.password).length < 8) throw new AppError(400, 'INVALID_CLIENT_PASSWORD', 'Password must be at least 8 characters.');
    params.push(await bcrypt.hash(String(body.password), 12));
    sets.push(`password_hash = $${params.length}`);
  }
  if (!sets.length) return getClient(actor, clientId).then(result => result.client);
  params.push(clientId);
  const { rows: [updated] } = await query(
    `UPDATE users SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length} AND role::text = 'client' AND deleted_at IS NULL
      RETURNING id, emp_code AS user_id, full_name, email, phone, role::text AS role, status::text AS status, created_at, updated_at, last_login_at,
                0::int AS pages_count, 0::int AS ad_accounts_count, 0::int AS campaigns_count, 0::int AS leads_count, 0::int AS open_support_tickets`,
    params,
  );
  if (!updated) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found.');
  await logActivity({ user: actor, ip: req.ip, headers: req.headers || {} }, {
    entity: 'client',
    entity_id: clientId,
    action: 'client_updated',
    metadata: { fields: Object.keys(body || {}) },
  });
  return mapClient(updated);
}

async function setClientStatus(actor, clientId, active, req = {}) {
  return updateClient(actor, clientId, { active }, req);
}

async function deleteClient(actor, clientId, req = {}) {
  assertAdmin(actor);
  const { rows: [deleted] } = await query(
    `UPDATE users SET deleted_at = NOW(), status = 'deleted', updated_at = NOW()
      WHERE id = $1 AND role::text = 'client' AND deleted_at IS NULL
      RETURNING id, full_name, email`,
    [clientId],
  );
  if (!deleted) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found.');
  await logActivity({ user: actor, ip: req.ip, headers: req.headers || {} }, {
    entity: 'client',
    entity_id: clientId,
    action: 'client_deleted',
    metadata: { email: deleted.email },
  });
  return { id: deleted.id };
}

async function sendReset(actor, clientId, req = {}) {
  assertAdmin(actor);
  const { rows: [client] } = await query(`SELECT id, email FROM users WHERE id = $1 AND role::text = 'client' AND deleted_at IS NULL`, [clientId]);
  if (!client) throw new AppError(404, 'CLIENT_NOT_FOUND', 'Client not found.');
  try {
    await passwordResetService.sendNewUserSetupLink({
      userId: client.id,
      createdByUser: actor,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'] || null,
    });
  } catch (error) {
    logger.warn({ clientId, code: error.code, message: error.message }, 'Client reset password email failed');
    throw error;
  }
  await logActivity({ user: actor, ip: req.ip, headers: req.headers || {} }, {
    entity: 'client',
    entity_id: clientId,
    action: 'client_password_reset_sent',
    metadata: { email: client.email },
  });
  return { sent: true };
}

async function clientDashboard(actor) {
  if (actor?.role !== 'client') throw new AppError(403, 'CLIENT_ONLY', 'Client dashboard is only available to client users.');
  const clientId = actor.id;
  const { rows: [stats] } = await query(
    `SELECT
       COUNT(l.id)::int AS total_leads,
       COUNT(l.id) FILTER (WHERE (l.created_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date)::int AS today_leads,
       COUNT(l.id) FILTER (WHERE l.call_status = 'converted' OR l.stage::text = 'won')::int AS conversions,
       (SELECT COUNT(*)::int FROM meta_campaigns WHERE client_id = $1) AS total_campaigns,
       (SELECT COUNT(*)::int FROM meta_campaigns WHERE client_id = $1 AND effective_status = 'ACTIVE') AS active_campaigns,
       (SELECT COUNT(*)::int FROM meta_pages WHERE client_id = $1) AS pages,
       (SELECT COUNT(*)::int FROM meta_forms WHERE client_id = $1) AS forms,
       COALESCE((SELECT SUM(COALESCE(spend,0)) FROM meta_campaigns WHERE client_id = $1), 0)::numeric AS spend,
       COALESCE((SELECT SUM(COALESCE(reach,0)) FROM meta_campaigns WHERE client_id = $1), 0)::numeric AS reach,
       COALESCE((SELECT SUM(COALESCE(impressions,0)) FROM meta_campaigns WHERE client_id = $1), 0)::numeric AS impressions
     FROM leads l
     WHERE l.client_id = $1 AND l.deleted_at IS NULL`,
    [clientId],
  );
  const totalLeads = Number(stats.total_leads || 0);
  const spend = Number(stats.spend || 0);
  return {
    ...stats,
    cpl: totalLeads ? spend / totalLeads : 0,
    conversion_rate: totalLeads ? (Number(stats.conversions || 0) / totalLeads) * 100 : 0,
  };
}

async function clientSettings(actor) {
  if (actor?.role !== 'client') throw new AppError(403, 'CLIENT_ONLY', 'Client settings are only available to client users.');
  const detail = await getClient({ role: 'super_admin' }, actor.id);
  return detail.meta;
}

module.exports = {
  listClients,
  getClient,
  createClient,
  updateClient,
  setClientStatus,
  deleteClient,
  sendReset,
  clientDashboard,
  clientSettings,
};
