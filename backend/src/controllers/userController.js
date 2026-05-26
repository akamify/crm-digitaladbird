const { query } = require('../config/database');
const bcrypt = require('bcryptjs');
const { AppError, asyncHandler } = require('../utils/errors');
const { invalidateUser } = require('../middleware/auth');

/** GET /api/users — admin: all; rm: own team; member: self */
exports.list = asyncHandler(async (req, res) => {
  const u = req.user;
  let sql, params = [];
  if (u.role === 'super_admin') {
    sql = `SELECT u.id, u.emp_code, u.full_name, u.email, u.phone, u.role, u.status,
                  u.report_to_id, m.full_name AS manager_name, u.team_name,
                  u.daily_lead_cap, u.distribution_weight, u.is_available, u.last_login_at
             FROM users u LEFT JOIN users m ON m.id = u.report_to_id
            WHERE u.deleted_at IS NULL ORDER BY u.role, u.full_name`;
  } else if (u.role === 'rm') {
    params = [u.id];
    sql = `SELECT u.id, u.emp_code, u.full_name, u.email, u.phone, u.role, u.status,
                  u.team_name, u.daily_lead_cap, u.distribution_weight, u.is_available, u.last_login_at
             FROM users u
            WHERE u.deleted_at IS NULL AND (u.id = $1 OR u.report_to_id = $1)
            ORDER BY u.role, u.full_name`;
  } else {
    params = [u.id];
    sql = `SELECT id, emp_code, full_name, email, phone, role, status, team_name
             FROM users WHERE id = $1`;
  }
  const { rows } = await query(sql, params);
  res.json({ success: true, data: rows });
});

/** GET /api/users/hierarchy — tree of admins -> rms -> members */
exports.hierarchy = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT id, full_name, email, phone, role, report_to_id, team_name, status
       FROM users WHERE deleted_at IS NULL ORDER BY role, full_name`
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
    emp_code, full_name, email, phone, role, report_to_id, team_name,
    daily_lead_cap, distribution_weight, password,
  } = req.body;
  if (!full_name || !email || !phone || !role)
    throw new AppError(400, 'INVALID_INPUT', 'full_name, email, phone, role required');

  const pwHash = password ? await bcrypt.hash(password, 10) : null;

  const { rows: [u] } = await query(
    `INSERT INTO users (emp_code, full_name, email, phone, role, report_to_id, team_name,
                        daily_lead_cap, distribution_weight, password_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 50), COALESCE($9, 1), $10)
        RETURNING id, full_name, email, phone, role`,
    [emp_code, full_name, email, phone, role, report_to_id || null, team_name || null,
     daily_lead_cap, distribution_weight, pwHash]
  );
  res.status(201).json({ success: true, data: u });
});

/** PATCH /api/users/:id */
exports.update = asyncHandler(async (req, res) => {
  if (req.user.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Admin only');
  const allowed = ['full_name', 'email', 'phone', 'role', 'report_to_id', 'team_name',
                   'daily_lead_cap', 'distribution_weight', 'is_available', 'status'];
  const sets = [], params = [];
  for (const k of allowed) {
    if (k in req.body) {
      params.push(req.body[k]);
      sets.push(`${k} = $${params.length}`);
    }
  }
  if (sets.length === 0) return res.json({ success: true });
  params.push(req.params.id);
  const { rows: [u] } = await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, full_name, role, status`,
    params
  );
  if (!u) throw new AppError(404, 'NOT_FOUND', 'User not found');
  invalidateUser(req.params.id);
  res.json({ success: true, data: u });
});

exports.softDelete = asyncHandler(async (req, res) => {
  if (req.user.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Admin only');
  await query(`UPDATE users SET deleted_at = NOW(), status = 'inactive' WHERE id = $1`, [req.params.id]);
  invalidateUser(req.params.id);
  res.json({ success: true });
});
