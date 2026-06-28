const { query } = require('../config/database');
const bcrypt = require('bcryptjs');
const { AppError, asyncHandler } = require('../utils/errors');
const { invalidateUser } = require('../middleware/auth');
const logger = require('../utils/logger');
const {
  assertCpIdNotEditable,
  generateUniqueCpId,
  normalizeRole,
} = require('../services/userIdentityService');
const passwordResetService = require('../services/auth/passwordResetService');

const HIDDEN_FILTER = 'COALESCE(u.is_hidden, FALSE) = FALSE';
const ADMIN_ROLES = new Set(['super_admin', 'admin']);

const USER_SELECT = `
  u.id, u.emp_code, u.cp_id, u.full_name, u.email, u.phone,
  CASE WHEN u.role::text = 'partner' THEN 'member' ELSE u.role::text END AS role,
  u.status::text AS status, u.report_to_id, m.full_name AS manager_name,
  u.team_name, u.daily_lead_cap, u.distribution_weight, u.is_available,
  u.lead_assignment_enabled, u.lead_assignment_status,
  u.lead_assignment_disabled_reason, u.lead_assignment_updated_at,
  u.last_login_at, u.created_at, u.updated_at, u.deleted_at,
  u.blocked_at, u.blocked_by, u.deleted_by, u.delete_reason
`;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePhoneInput(phone) {
  return String(phone || '').trim();
}

function mapUserRow(row) {
  if (!row) return row;
  const mapped = { ...row, role: normalizeRole(row.role) };
  const assignmentStatus = String(mapped.lead_assignment_status || '').trim().toLowerCase();
  const hasAssignmentStatus = Boolean(assignmentStatus);
  const assignmentEnabled = mapped.lead_assignment_enabled !== false;
  const accountActive = mapped.status === 'active';
  const effectiveAvailable = accountActive && (hasAssignmentStatus
    ? assignmentEnabled && assignmentStatus === 'available'
    : mapped.is_available !== false);
  mapped.is_available = effectiveAvailable;
  mapped.lead_assignment_enabled = hasAssignmentStatus ? assignmentEnabled : effectiveAvailable;
  mapped.lead_assignment_status = hasAssignmentStatus
    ? assignmentStatus
    : (effectiveAvailable ? 'available' : 'unavailable');
  return mapped;
}

async function assertReservedIdentity({ email, phone }, excludeUserId = null) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhoneInput(phone);
  if (!normalizedEmail && !normalizedPhone) return;

  const { rows: [existing] } = await query(
    `SELECT id,
            CASE
              WHEN $1 <> '' AND LOWER(email) = $1 THEN 'email'
              WHEN $2 <> '' AND phone = $2 THEN 'phone'
            END AS field
       FROM users
      WHERE ($3::uuid IS NULL OR id <> $3::uuid)
        AND (($1 <> '' AND LOWER(email) = $1) OR ($2 <> '' AND phone = $2))
      LIMIT 1`,
    [normalizedEmail, normalizedPhone, excludeUserId],
  );

  if (!existing) return;
  if (existing.field === 'email') {
    throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'This email is already assigned to another user.');
  }
  throw new AppError(409, 'PHONE_ALREADY_EXISTS', 'This phone is already assigned to another user.');
}

async function assertActiveRm(rmId) {
  const { rows: [rm] } = await query(
    `SELECT id, team_name
       FROM users
      WHERE id = $1
        AND role = 'rm'
        AND status = 'active'
        AND deleted_at IS NULL`,
    [rmId],
  );
  if (!rm) throw new AppError(400, 'INVALID_REPORTING_RM', 'Member must report to an active RM.');
  return rm;
}

async function revokeUserSessions(userId) {
  await query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  invalidateUser(userId);
}

async function refuseIfProtected(req, action) {
  const { rows: [target] } = await query(
    `SELECT id, email, role, is_protected, is_hidden, is_system_account
       FROM users WHERE id = $1`,
    [req.params.id],
  );
  if (!target) throw new AppError(404, 'NOT_FOUND', 'User not found');
  if (target.is_protected) {
    logger.warn({
      attemptedBy: req.user.id,
      attemptedByRole: req.user.role,
      targetId: target.id,
      targetEmail: target.email,
      action,
      body: action === 'edit' ? Object.keys(req.body || {}) : undefined,
    }, '[ProtectedAccount] modification blocked');
    try {
      await query(
        `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata, ip_address)
           VALUES ($1, 'user', $2, $3, $4, $5)`,
        [req.user.id, target.id, `protected_${action}_attempt`,
          JSON.stringify({ targetEmail: target.email, role: req.user.role, body_keys: Object.keys(req.body || {}) }),
          req.ip],
      );
    } catch (_) {}
    throw new AppError(403, 'PROTECTED_ACCOUNT', 'This account is a protected system account and cannot be modified.');
  }
  if (target.is_hidden) throw new AppError(404, 'NOT_FOUND', 'User not found');
  return target;
}

exports.list = asyncHandler(async (req, res) => {
  const actor = req.user;
  const status = String(req.query.status || '').trim();
  const role = String(req.query.role || '').trim();
  const rmId = String(req.query.rmId || '').trim();
  const search = String(req.query.search || '').trim().toLowerCase();
  const includeDeleted = status === 'deleted' || status === 'all';

  let sql;
  let params;
  if (ADMIN_ROLES.has(actor.role)) {
    params = [status, role, rmId, search ? `%${search}%` : ''];
    sql = `SELECT ${USER_SELECT}
             FROM users u
             LEFT JOIN users m ON m.id = u.report_to_id
            WHERE ${includeDeleted ? 'TRUE' : 'u.deleted_at IS NULL'}
              AND ${HIDDEN_FILTER}
              AND ($1::text = '' OR $1::text = 'all' OR u.status::text = $1::text)
              AND ($2::text = '' OR $2::text = 'all'
                   OR (CASE WHEN u.role::text = 'partner' THEN 'member' ELSE u.role::text END) = $2::text)
              AND ($3::text = '' OR u.report_to_id::text = $3::text)
              AND ($4::text = '' OR LOWER(u.full_name) LIKE $4 OR LOWER(u.email) LIKE $4
                   OR COALESCE(u.phone, '') LIKE $4 OR LOWER(COALESCE(u.cp_id, '')) LIKE $4)
            ORDER BY u.role, u.full_name`;
  } else if (actor.role === 'rm') {
    params = [actor.id];
    sql = `SELECT ${USER_SELECT}
             FROM users u
             LEFT JOIN users m ON m.id = u.report_to_id
            WHERE u.deleted_at IS NULL
              AND ${HIDDEN_FILTER}
              AND (u.id = $1 OR u.report_to_id = $1)
            ORDER BY u.role, u.full_name`;
  } else {
    params = [actor.id];
    sql = `SELECT ${USER_SELECT}
             FROM users u
             LEFT JOIN users m ON m.id = u.report_to_id
            WHERE u.id = $1`;
  }

  const { rows } = await query(sql, params);
  res.json({ success: true, data: rows.map(mapUserRow) });
});

exports.deleted = asyncHandler(async (req, res) => {
  if (!ADMIN_ROLES.has(req.user.role)) throw new AppError(403, 'FORBIDDEN', 'Admin only');
  const { rows } = await query(
    `SELECT ${USER_SELECT}
       FROM users u
       LEFT JOIN users m ON m.id = u.report_to_id
      WHERE u.deleted_at IS NOT NULL AND ${HIDDEN_FILTER}
      ORDER BY u.deleted_at DESC NULLS LAST, u.full_name`,
  );
  res.json({ success: true, data: rows.map(mapUserRow) });
});

exports.hierarchy = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT id, cp_id, full_name, email, phone,
            CASE WHEN role::text = 'partner' THEN 'member' ELSE role::text END AS role,
            report_to_id, team_name, status::text AS status
       FROM users u
      WHERE u.deleted_at IS NULL AND ${HIDDEN_FILTER}
      ORDER BY role, full_name`,
  );
  const byId = Object.fromEntries(rows.map(r => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const u of Object.values(byId)) {
    if (u.report_to_id && byId[u.report_to_id]) byId[u.report_to_id].children.push(u);
    else roots.push(u);
  }
  res.json({ success: true, data: roots });
});

exports.create = asyncHandler(async (req, res) => {
  if (!ADMIN_ROLES.has(req.user.role)) throw new AppError(403, 'FORBIDDEN', 'Admin only');
  assertCpIdNotEditable(req.body);

  const {
    emp_code, full_name, email, phone, role: rawRole, report_to_id, team_name,
    daily_lead_cap, distribution_weight, password, sendWelcomeEmail,
  } = req.body;

  if (rawRole === 'partner') throw new AppError(400, 'PARTNER_ROLE_DEPRECATED', 'Partner users are now created as members.');
  const role = normalizeRole(rawRole);
  if (!['super_admin', 'admin', 'rm', 'member'].includes(role)) throw new AppError(400, 'INVALID_ROLE', 'Invalid user role.');
  if (!full_name || !email || !phone || !role) {
    throw new AppError(400, 'INVALID_INPUT', 'full_name, email, phone and role are required');
  }

  let resolvedReportTo = null;
  let resolvedTeamName = String(team_name || '').trim() || null;
  if (role === 'rm') {
    if (!resolvedTeamName) throw new AppError(400, 'TEAM_NAME_REQUIRED', 'RM must have a team name.');
  } else if (role === 'member') {
    if (!report_to_id) throw new AppError(400, 'REPORTING_RM_REQUIRED', 'Member must report to an RM.');
    const rm = await assertActiveRm(report_to_id);
    resolvedReportTo = rm.id;
    resolvedTeamName = rm.team_name || null;
  }

  await assertReservedIdentity({ email, phone });
  const cpId = await generateUniqueCpId();
  const pwHash = password ? await bcrypt.hash(password, 10) : null;

  const { rows: [user] } = await query(
    `INSERT INTO users (emp_code, cp_id, full_name, email, phone, role, report_to_id, team_name,
                        daily_lead_cap, distribution_weight, password_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 50), COALESCE($10, 1), $11)
        RETURNING id, cp_id, full_name, email, phone, role, report_to_id, team_name`,
    [emp_code || cpId, cpId, full_name.trim(), normalizeEmail(email), normalizePhoneInput(phone), role,
      resolvedReportTo, resolvedTeamName, daily_lead_cap, distribution_weight, pwHash],
  );

  let emailWarning = null;
  if (sendWelcomeEmail !== false && user.email) {
    try {
      await passwordResetService.sendNewUserSetupLink({
        userId: user.id,
        createdByUser: req.user,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] || null,
      });
    } catch (error) {
      logger.warn({ userId: user.id, code: error.code || 'ONBOARDING_EMAIL_FAILED' }, 'User created but onboarding email failed');
      emailWarning = error.code === 'EMAIL_PROVIDER_NOT_CONFIGURED'
        ? 'User created, but the email provider is not configured.'
        : 'User created, but onboarding email could not be sent.';
    }
  }

  res.status(201).json({ success: true, data: { ...mapUserRow(user), emailWarning } });
});

exports.update = asyncHandler(async (req, res) => {
  if (!ADMIN_ROLES.has(req.user.role)) throw new AppError(403, 'FORBIDDEN', 'Admin only');
  await refuseIfProtected(req, 'edit');
  assertCpIdNotEditable(req.body);

  if (req.body.role === 'partner') throw new AppError(400, 'PARTNER_ROLE_DEPRECATED', 'Partner users are now members.');
  const nextRole = Object.prototype.hasOwnProperty.call(req.body, 'role') ? normalizeRole(req.body.role) : null;
  if (nextRole && !['super_admin', 'admin', 'rm', 'member'].includes(nextRole)) throw new AppError(400, 'INVALID_ROLE', 'Invalid user role.');

  await assertReservedIdentity({ email: req.body.email || '', phone: req.body.phone || '' }, req.params.id);

  const { rows: [current] } = await query(
    `SELECT role, report_to_id, team_name FROM users WHERE id = $1 AND COALESCE(is_hidden, FALSE) = FALSE`,
    [req.params.id],
  );
  if (!current) throw new AppError(404, 'NOT_FOUND', 'User not found');
  const effectiveRole = nextRole || normalizeRole(current.role);
  const effectiveReportTo = Object.prototype.hasOwnProperty.call(req.body, 'report_to_id')
    ? req.body.report_to_id
    : current.report_to_id;

  let rmForMember = null;
  if (effectiveRole === 'rm' && !String(Object.prototype.hasOwnProperty.call(req.body, 'team_name') ? req.body.team_name : current.team_name || '').trim()) {
    throw new AppError(400, 'TEAM_NAME_REQUIRED', 'RM must have a team name.');
  }
  if (effectiveRole === 'member') {
    if (!effectiveReportTo) throw new AppError(400, 'REPORTING_RM_REQUIRED', 'Member must report to an RM.');
    rmForMember = await assertActiveRm(effectiveReportTo);
  }

  const allowed = ['full_name', 'email', 'phone', 'role', 'report_to_id', 'team_name',
    'daily_lead_cap', 'distribution_weight', 'is_available'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(req.body, key)) continue;
    let value = req.body[key];
    if (key === 'email' && value) value = normalizeEmail(value);
    if (key === 'phone' && value) value = normalizePhoneInput(value);
    if (key === 'role') value = normalizeRole(value);
    if (key === 'report_to_id' && effectiveRole === 'rm') value = null;
    if (key === 'report_to_id' && effectiveRole === 'member') value = rmForMember.id;
    if (key === 'team_name' && effectiveRole === 'member') value = rmForMember.team_name || null;
    params.push(value);
    sets.push(`${key} = $${params.length}`);
    if (key === 'is_available') {
      params.push(value === true);
      sets.push(`lead_assignment_enabled = $${params.length}`);
      params.push(value === true ? 'available' : 'unavailable');
      sets.push(`lead_assignment_status = $${params.length}`);
      params.push(req.user.id);
      sets.push(`lead_assignment_updated_by = $${params.length}`);
      sets.push(`lead_assignment_updated_at = NOW()`);
    }
  }
  if (effectiveRole === 'rm' && !Object.prototype.hasOwnProperty.call(req.body, 'report_to_id')) {
    params.push(null);
    sets.push(`report_to_id = $${params.length}`);
  }
  if (effectiveRole === 'member' && !Object.prototype.hasOwnProperty.call(req.body, 'team_name')) {
    params.push(rmForMember.team_name || null);
    sets.push(`team_name = $${params.length}`);
  }

  if (!sets.length) return res.json({ success: true });
  params.push(req.params.id);
  const { rows: [user] } = await query(
    `UPDATE users SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length}
        AND COALESCE(is_hidden, FALSE) = FALSE
        AND COALESCE(is_protected, FALSE) = FALSE
      RETURNING id, cp_id, full_name, role, status`,
    params,
  );
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  invalidateUser(req.params.id);
  res.json({ success: true, data: mapUserRow(user) });
});

exports.block = asyncHandler(async (req, res) => {
  if (!ADMIN_ROLES.has(req.user.role)) throw new AppError(403, 'FORBIDDEN', 'Admin only');
  await refuseIfProtected(req, 'block');
  const reason = String(req.body?.reason || '').trim() || null;
  const { rows: [user] } = await query(
    `UPDATE users
        SET status = 'blocked',
            is_available = FALSE,
            lead_assignment_enabled = FALSE,
            lead_assignment_status = 'blocked',
            lead_assignment_disabled_reason = $3,
            lead_assignment_updated_by = $2,
            lead_assignment_updated_at = NOW(),
            blocked_at = NOW(),
            blocked_by = $2,
            updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, full_name`,
    [req.params.id, req.user.id, reason],
  );
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  await query(
    `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata, ip_address)
       VALUES ($1, 'user', $2, 'block', $3, $4)`,
    [req.user.id, req.params.id, JSON.stringify({ target: user.full_name, reason }), req.ip],
  ).catch(() => {});
  await revokeUserSessions(req.params.id);
  res.json({ success: true, data: { blocked: user.full_name } });
});

exports.unblock = asyncHandler(async (req, res) => {
  if (!ADMIN_ROLES.has(req.user.role)) throw new AppError(403, 'FORBIDDEN', 'Admin only');
  await refuseIfProtected(req, 'unblock');
  const { rows: [user] } = await query(
    `UPDATE users
        SET status = 'active',
            is_available = TRUE,
            lead_assignment_enabled = TRUE,
            lead_assignment_status = 'available',
            lead_assignment_disabled_reason = NULL,
            lead_assignment_updated_by = $2,
            lead_assignment_updated_at = NOW(),
            blocked_at = NULL,
            blocked_by = NULL,
            updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL AND status = 'blocked'
      RETURNING id, full_name`,
    [req.params.id, req.user.id],
  );
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found or not blocked');
  await query(
    `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata, ip_address)
       VALUES ($1, 'user', $2, 'unblock', $3, $4)`,
    [req.user.id, req.params.id, JSON.stringify({ target: user.full_name }), req.ip],
  ).catch(() => {});
  invalidateUser(req.params.id);
  res.json({ success: true, data: { unblocked: user.full_name } });
});

exports.softDelete = asyncHandler(async (req, res) => {
  if (!ADMIN_ROLES.has(req.user.role)) throw new AppError(403, 'FORBIDDEN', 'Admin only');
  await refuseIfProtected(req, 'delete');
  const reason = String(req.body?.reason || '').trim() || null;
  await query(
    `UPDATE users
        SET deleted_at = COALESCE(deleted_at, NOW()),
            deleted_by = $2,
            delete_reason = COALESCE($3, delete_reason),
            status = 'deleted',
            is_available = FALSE,
            lead_assignment_enabled = FALSE,
            lead_assignment_status = 'disabled',
            lead_assignment_disabled_reason = COALESCE($3, lead_assignment_disabled_reason),
            lead_assignment_updated_by = $2,
            lead_assignment_updated_at = NOW(),
            updated_at = NOW()
      WHERE id = $1`,
    [req.params.id, req.user.id, reason],
  );
  await revokeUserSessions(req.params.id);
  res.json({ success: true });
});
