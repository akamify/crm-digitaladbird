const { query } = require('../config/database');
const bcrypt = require('bcryptjs');
const { AppError, asyncHandler } = require('../utils/errors');
const { invalidateUser } = require('../middleware/auth');
const logger = require('../utils/logger');
const { validateUniqueCpId } = require('../services/userIdentityService');
const passwordResetService = require('../services/auth/passwordResetService');

// ─── Hidden / protected account filter ─────────────────────────────
// is_hidden = TRUE accounts MUST NOT appear in:
//   - GET /users (any role)
//   - GET /users/hierarchy
//   - GET /users/:id (returns 404 unless the requester IS that user)
//   - any /admin/* user listing
//   - team rosters
//
// is_protected = TRUE accounts cannot be edited / soft-deleted / role-
// changed even by super_admin. We REJECT at the route level with a
// 403 PROTECTED_ACCOUNT response so the operator sees a clear error
// instead of the raw DB trigger exception. The DB trigger is the
// belt-and-suspenders fallback.
const HIDDEN_FILTER = 'u.is_hidden = FALSE';

/** GET /api/users — admin: all; rm: own team; member: self */
exports.list = asyncHandler(async (req, res) => {
  const u = req.user;
  let sql, params = [];
  if (u.role === 'super_admin') {
    sql = `SELECT u.id, u.emp_code, u.cp_id, u.full_name, u.email, u.phone, u.role, u.status,
                  u.report_to_id, m.full_name AS manager_name, u.team_name,
                  u.daily_lead_cap, u.distribution_weight, u.is_available, u.last_login_at, u.created_at
             FROM users u LEFT JOIN users m ON m.id = u.report_to_id
            WHERE u.deleted_at IS NULL AND ${HIDDEN_FILTER}
            ORDER BY u.role, u.full_name`;
  } else if (u.role === 'rm') {
    params = [u.id];
    sql = `SELECT u.id, u.emp_code, u.cp_id, u.full_name, u.email, u.phone, u.role, u.status,
                  u.team_name, u.daily_lead_cap, u.distribution_weight, u.is_available, u.last_login_at, u.created_at
             FROM users u
            WHERE u.deleted_at IS NULL AND ${HIDDEN_FILTER}
              AND (u.id = $1 OR u.report_to_id = $1)
            ORDER BY u.role, u.full_name`;
  } else {
    params = [u.id];
    sql = `SELECT id, emp_code, cp_id, full_name, email, phone, role, status, team_name, created_at
             FROM users WHERE id = $1`;
  }
  const { rows } = await query(sql, params);
  res.json({ success: true, data: rows });
});

/** GET /api/users/hierarchy — tree of admins -> rms -> members */
exports.hierarchy = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT id, cp_id, full_name, email, phone, role, report_to_id, team_name, status
       FROM users u
      WHERE u.deleted_at IS NULL AND ${HIDDEN_FILTER}
      ORDER BY role, full_name`
  );
  const byId = Object.fromEntries(rows.map(r => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const u of Object.values(byId)) {
    if (u.report_to_id && byId[u.report_to_id]) byId[u.report_to_id].children.push(u);
    else roots.push(u);
  }
  res.json({ success: true, data: roots });
});

/** POST /api/users — admin only */
exports.create = asyncHandler(async (req, res) => {
  if (req.user.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Admin only');
  const {
    emp_code, cp_id, full_name, email, phone, role, report_to_id, team_name,
    daily_lead_cap, distribution_weight, password, sendWelcomeEmail,
  } = req.body;
  if (!full_name || !email || !phone || !role || !cp_id)
    throw new AppError(400, 'INVALID_INPUT', 'full_name, email, phone, role, cp_id required');
  const normalizedCpId = await validateUniqueCpId(cp_id);
  // Hidden flag cannot be set via API — only via env-driven bootstrap.
  // Silently strip if any tampering attempt arrives.
  const pwHash = password ? await bcrypt.hash(password, 10) : null;

  const { rows: [u] } = await query(
    `INSERT INTO users (emp_code, cp_id, full_name, email, phone, role, report_to_id, team_name,
                        daily_lead_cap, distribution_weight, password_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 50), COALESCE($10, 1), $11)
        RETURNING id, cp_id, full_name, email, phone, role, report_to_id, team_name`,
    [emp_code || normalizedCpId, normalizedCpId, full_name.trim(), email.trim().toLowerCase(), phone.trim(), role, report_to_id || null, team_name || null,
     daily_lead_cap, distribution_weight, pwHash]
  );
  let emailWarning = null;
  if (sendWelcomeEmail !== false && u.email) {
    try {
      await passwordResetService.sendNewUserSetupLink({
        userId: u.id,
        createdByUser: req.user,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] || null,
      });
    } catch (error) {
      logger.warn({ userId: u.id, code: error.code || 'ONBOARDING_EMAIL_FAILED' }, 'User created but onboarding email failed');
      emailWarning = error.code === 'EMAIL_PROVIDER_NOT_CONFIGURED'
        ? 'User created, but the email provider is not configured.'
        : 'User created, but onboarding email could not be sent.';
    }
  }
  res.status(201).json({ success: true, data: { ...u, emailWarning } });
});

// Refuses modifications to is_protected users + logs every attempt.
// Reasons audited:
//   protected_edit_attempt — PATCH on protected user
//   protected_delete_attempt — DELETE on protected user
//   protected_role_change_attempt — PATCH that includes role field
//   protected_status_change_attempt — PATCH that includes status field
async function refuseIfProtected(req, action) {
  const { rows: [target] } = await query(
    `SELECT id, email, role, is_protected, is_hidden, is_system_account
       FROM users WHERE id = $1`,
    [req.params.id]
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
    // Best-effort audit insert. If audit_logs schema differs, swallow.
    try {
      await query(
        `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata, ip_address)
           VALUES ($1, 'user', $2, $3, $4, $5)`,
        [req.user.id, target.id, 'protected_' + action + '_attempt',
         JSON.stringify({ targetEmail: target.email, role: req.user.role, body_keys: Object.keys(req.body || {}) }),
         req.ip]
      );
    } catch (_) { /* audit failure is non-fatal */ }
    throw new AppError(403, 'PROTECTED_ACCOUNT',
      'This account is a protected system account and cannot be modified.');
  }
  if (target.is_hidden) {
    // Treat hidden accounts as not-found for non-self requesters.
    throw new AppError(404, 'NOT_FOUND', 'User not found');
  }
  return target;
}

/** PATCH /api/users/:id */
exports.update = asyncHandler(async (req, res) => {
  if (req.user.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Admin only');
  await refuseIfProtected(req, 'edit');

  // Even though refuseIfProtected blocks the request, allowed list also
  // excludes is_hidden / is_protected / is_system_account — these can
  // never be set via API regardless of target.
  const allowed = ['full_name', 'email', 'phone', 'cp_id', 'role', 'report_to_id', 'team_name',
                   'daily_lead_cap', 'distribution_weight', 'is_available', 'status'];
  const sets = [], params = [];
  for (const k of allowed) {
    if (k in req.body) {
      let value = req.body[k];
      if (k === 'cp_id') value = await validateUniqueCpId(value, req.params.id);
      if (k === 'email' && value) value = String(value).trim().toLowerCase();
      params.push(value);
      sets.push(`${k} = $${params.length}`);
    }
  }
  if (sets.length === 0) return res.json({ success: true });
  params.push(req.params.id);
  const { rows: [u] } = await query(
    `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING id, cp_id, full_name, role, status`,
    params
  );
  if (!u) throw new AppError(404, 'NOT_FOUND', 'User not found');
  invalidateUser(req.params.id);
  res.json({ success: true, data: u });
});

exports.softDelete = asyncHandler(async (req, res) => {
  if (req.user.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Admin only');
  await refuseIfProtected(req, 'delete');
  await query(`UPDATE users SET deleted_at = NOW(), status = 'inactive' WHERE id = $1`, [req.params.id]);
  invalidateUser(req.params.id);
  res.json({ success: true });
});
