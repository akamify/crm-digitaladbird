/**
 * Auth flows:
 *
 *   DEMO MODE (no OTP):
 *   POST /auth/login        { identifier, password }  -> JWT directly
 *     identifier = email | phone | full_name
 *
 *   PRODUCTION (OTP, added later):
 *   POST /auth/request-otp  { email, password, role, full_name?, phone? }
 *   POST /auth/verify-otp   { email, code }
 *
 *   SHARED:
 *   POST /auth/refresh      { refreshToken }
 *   POST /auth/logout
 *   GET  /auth/me
 */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query } = require('../config/database');
const { issueOtp, verifyOtp: verifyOtpCode } = require('../services/otpService');
const { signAccessToken, signRefreshToken, hashToken } = require('../utils/jwt');
const { AppError, asyncHandler } = require('../utils/errors');
const config = require('../config/env');
const logger = require('../utils/logger');

const VALID_ROLES = ['super_admin', 'rm', 'member'];

function normalizePhone(input) {
  if (!input) return null;
  let p = String(input).trim().replace(/[\s-()]/g, '');
  if (/^\d{10}$/.test(p)) p = '+91' + p;
  if (!p.startsWith('+')) p = '+' + p;
  return /^\+\d{10,15}$/.test(p) ? p : null;
}

function generateEmpCode(role) {
  const prefix = role === 'super_admin' ? 'SA' : role === 'rm' ? 'RM' : 'MB';
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

/**
 * DEMO MODE — Direct login: identifier (email | phone | name) + password → JWT
 * No OTP, no verification step. For production, use request-otp / verify-otp.
 */
// Map frontend role labels to database role values
const ROLE_MAP = { admin: 'super_admin', rm: 'rm', partner: 'member', member: 'member', super_admin: 'super_admin' };

function identifierType(value) {
  const raw = String(value || '').trim();
  if (raw.includes('@')) return 'email';
  if (normalizePhone(raw)) return 'phone';
  if (/^[a-z]{1,4}[-_\d]/i.test(raw) || /^cp/i.test(raw)) return 'cp_id';
  return 'name_or_id';
}

function normalizeDbRole(role) {
  return role === 'partner' ? 'member' : role;
}

function assertLoginStatus(user) {
  if (user.deleted_at || user.status === 'deleted') {
    throw new AppError(403, 'USER_DELETED', 'Your account has been disabled. Please contact admin.');
  }
  if (user.status === 'blocked') {
    throw new AppError(403, 'USER_BLOCKED', 'Your account has been blocked. Please contact admin.');
  }
  if (user.status !== 'active') {
    throw new AppError(403, 'USER_INACTIVE', 'Your account is inactive. Contact your administrator.');
  }
}

function generateCpId() {
  return `MSA${String(crypto.randomInt(0, 100000000)).padStart(8, '0')}`;
}

exports.login = asyncHandler(async (req, res) => {
  const { identifier, password, role: selectedRole } = req.body;
  if (!identifier || !identifier.toString().trim()) {
    throw new AppError(400, 'IDENTIFIER_REQUIRED', 'Email, mobile number, or CP ID is required');
  }
  if (!password) throw new AppError(400, 'PASSWORD_REQUIRED', 'Password is required');

  const raw = identifier.toString().trim();

  // Lookup strategy: email > phone > cp_id > full_name
  let user;
  const SELECT = `SELECT id, full_name, email, phone, role, member_type,
                         report_to_id, team_name, status, password_hash, cp_id, deleted_at
                    FROM users WHERE TRUE`;

  if (raw.includes('@')) {
    const { rows } = await query(`${SELECT} AND LOWER(email) = $1`, [raw.toLowerCase()]);
    user = rows[0];
  }

  if (!user) {
    const phone = normalizePhone(raw);
    if (phone) {
      const { rows } = await query(`${SELECT} AND phone = $1`, [phone]);
      user = rows.find(r => r.status === 'active') || rows[0];
    }
  }

  if (!user) {
    const { rows } = await query(`${SELECT} AND UPPER(cp_id) = UPPER($1)`, [raw]);
    user = rows[0];
  }

  if (!user) {
    const { rows } = await query(`${SELECT} AND LOWER(full_name) = LOWER($1)`, [raw]);
    user = rows[0];
  }

  // Audit failed-login attempts (no user found, inactive account, or bad
  // password). Each failure writes an activity_logs row so super_admin can
  // see brute-force attempts in the Activity Logs view.
  const auditFailedLogin = async (reason, foundUserId = null) => {
    const type = identifierType(raw);
    logger.warn({
      identifierType: type,
      failureCode: reason,
      selectedRole: selectedRole || null,
    }, 'Login failed');
    const { logActivity } = require('../utils/auditLog');
    await logActivity(req, {
      entity: 'session', entity_id: foundUserId,
      action: 'login_failed',
      metadata: { reason, identifier_type: type, role: selectedRole || null },
    });
  };

  if (!user) {
    await auditFailedLogin('no_account');
    throw new AppError(401, 'INVALID_CREDENTIALS', 'No account found. Check your email, mobile, or CP ID.');
  }
  try {
    assertLoginStatus(user);
  } catch (error) {
    await auditFailedLogin(error.code || 'user_inactive', user.id);
    throw error;
  }
  if (!user.password_hash) {
    await auditFailedLogin('password_not_set', user.id);
    throw new AppError(400, 'PASSWORD_NOT_SET', 'No password configured for this account.');
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    await auditFailedLogin('bad_password', user.id);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect password.');
  }

  // Enforce role matching when the frontend sends a selected role
  if (selectedRole) {
    const expectedDbRole = ROLE_MAP[selectedRole] || selectedRole;
    if (normalizeDbRole(user.role) !== expectedDbRole) {
      await auditFailedLogin('role_mismatch', user.id);
      const labels = { super_admin: 'Admin', rm: 'RM', member: 'Member' };
      throw new AppError(403, 'ROLE_MISMATCH',
        `This account is registered as ${labels[normalizeDbRole(user.role)] || normalizeDbRole(user.role)}. Please select the correct role.`);
    }
  }
  user.role = normalizeDbRole(user.role);

  const accessToken = signAccessToken(user);
  const refresh     = signRefreshToken(user);

  // Security signal: is this UA new for this user? (no prior auth_sessions
  // row with the same UA). And: are there other active sessions right now?
  const currentUA = req.headers['user-agent'] || null;
  let isNewDevice = false;
  let otherActiveSessions = 0;
  if (currentUA) {
    const { rows: [seen] } = await query(
      `SELECT COUNT(*)::int AS n FROM auth_sessions
        WHERE user_id = $1 AND user_agent = $2`,
      [user.id, currentUA]
    );
    isNewDevice = (seen.n === 0);
  } else {
    isNewDevice = true;
  }
  const { rows: [act] } = await query(
    `SELECT COUNT(*)::int AS n FROM auth_sessions
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [user.id]
  );
  otherActiveSessions = act.n;  // not yet incremented by the new INSERT

  const { rows: [sess] } = await query(
    `INSERT INTO auth_sessions (user_id, refresh_token_hash, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [user.id, refresh.hash, currentUA, req.ip, refresh.expiresAt]
  );
  await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);

  // Audit trail — rich row in activity_logs. Includes security signals so
  // super_admin can spot new-device logins + concurrent sessions.
  const { logActivity } = require('../utils/auditLog');
  await logActivity(
    { user: { id: user.id, name: user.full_name, role: user.role }, ip: req.ip, headers: req.headers },
    { entity: 'session', entity_id: user.id, action: 'login', session_id: sess.id,
      metadata: {
        method: 'direct',
        session_id: sess.id,
        email: user.email,
        new_device: isNewDevice,
        other_active_sessions: otherActiveSessions,
      } }
  );

  res.json({
    success: true,
    data: {
      accessToken,
      refreshToken:        refresh.raw,
      accessTokenExpiresIn: config.jwt.accessTtl,
      user: {
        id:         user.id,
        name:       user.full_name,
        email:      user.email,
        phone:      user.phone,
        role:       normalizeDbRole(user.role),
        memberType: user.member_type,
        reportToId: user.report_to_id,
        team:       user.team_name,
        cpId:       user.cp_id,
      },
    },
  });
});

exports.requestOtp = asyncHandler(async (req, res) => {
  const { email: rawEmail, password, role, full_name, phone: rawPhone } = req.body;

  if (!rawEmail || !rawEmail.trim()) throw new AppError(400, 'EMAIL_REQUIRED', 'Email is required');
  if (!password)                    throw new AppError(400, 'PASSWORD_REQUIRED', 'Password is required');
  if (!role || !VALID_ROLES.includes(role)) {
    throw new AppError(400, 'ROLE_REQUIRED', `role must be one of: ${VALID_ROLES.join(', ')}`);
  }

  const email = rawEmail.trim().toLowerCase();

  // Look up existing user by email
  const { rows } = await query(
    `SELECT id, role, member_type, status, password_hash, deleted_at
       FROM users WHERE email = $1`,
    [email]
  );
  let user = rows[0];

  if (user) {
    // Existing user: validate role, status, and password
    if (normalizeDbRole(user.role) !== role) {
      const roleLabel = { super_admin: 'Super Admin', rm: 'RM', member: 'Member' };
      throw new AppError(403, 'ROLE_MISMATCH',
        `This email is registered as ${roleLabel[user.role] || user.role}. Please select the correct role.`);
    }
    assertLoginStatus(user);
    if (!user.password_hash) {
      throw new AppError(400, 'PASSWORD_NOT_SET', 'No password configured for this account. Contact your administrator.');
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  } else {
    // New user: super_admin cannot self-register
    if (role === 'super_admin') {
      throw new AppError(403, 'REGISTRATION_BLOCKED',
        'Super Admin accounts must be created by the system administrator.');
    }
    if (!full_name || !full_name.trim()) {
      throw new AppError(400, 'NAME_REQUIRED', 'Full name is required to create your account.');
    }

    const phone       = rawPhone ? normalizePhone(rawPhone) : null;
    const passwordHash = await bcrypt.hash(password, 12);
    const memberType  = role === 'member' ? 'fresher' : null;

    const { rows: [created] } = await query(
      `INSERT INTO users (emp_code, cp_id, full_name, email, phone, role, member_type, status, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)
         RETURNING id, role, member_type, status`,
      [generateEmpCode(role), generateCpId(), full_name.trim(), email, phone, role, memberType, passwordHash]
    );
    user = created;
  }

  // Issue OTP — email is the identifier (printed to console in dev mode)
  const { expiresInSeconds } = await issueOtp(email, req.ip);
  res.json({ success: true, data: { expiresInSeconds } });
});

exports.verifyOtp = asyncHandler(async (req, res) => {
  const { email: rawEmail, code } = req.body;
  if (!rawEmail || !rawEmail.trim()) throw new AppError(400, 'EMAIL_REQUIRED', 'Email is required');
  const email = rawEmail.trim().toLowerCase();
  const otp   = String(code || '').trim();
  if (!otp) throw new AppError(400, 'CODE_REQUIRED', 'OTP code is required');

  await verifyOtpCode(email, otp);

  const { rows } = await query(
    `SELECT id, full_name, email, phone, cp_id, role, member_type, report_to_id, team_name
       FROM users
      WHERE email = $1 AND deleted_at IS NULL AND status = 'active'`,
    [email]
  );
  const user = rows[0];
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

  const accessToken = signAccessToken(user);
  const refresh     = signRefreshToken(user);

  await query(
    `INSERT INTO auth_sessions (user_id, refresh_token_hash, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
    [user.id, refresh.hash, req.headers['user-agent'] || null, req.ip, refresh.expiresAt]
  );
  await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
  await query(
    `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata, ip_address)
       VALUES ($1, 'user', $1, 'login', '{}', $2)`,
    [user.id, req.ip]
  );

  res.json({
    success: true,
    data: {
      accessToken,
      refreshToken: refresh.raw,
      accessTokenExpiresIn: config.jwt.accessTtl,
      user: {
        id:         user.id,
        name:       user.full_name,
        email:      user.email,
        phone:      user.phone,
        role:       normalizeDbRole(user.role),
        memberType: user.member_type,
        reportToId: user.report_to_id,
        team:       user.team_name,
        cpId:       user.cp_id,
      },
    },
  });
});

exports.refresh = asyncHandler(async (req, res) => {
  const raw = req.body.refreshToken;
  if (!raw) throw new AppError(400, 'REFRESH_REQUIRED', 'Refresh token required');
  const hash = hashToken(raw);

  const { rows } = await query(
    `SELECT s.id, s.user_id, s.expires_at, s.revoked_at,
            u.id AS uid, u.role, u.full_name, u.status, u.deleted_at
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.refresh_token_hash = $1`,
    [hash]
  );
  const sess = rows[0];
  if (!sess)                                   throw new AppError(401, 'SESSION_INVALID', 'Invalid refresh token');
  if (sess.revoked_at)                         throw new AppError(401, 'SESSION_REVOKED',  'Session revoked');
  if (new Date(sess.expires_at) < new Date())  throw new AppError(401, 'SESSION_EXPIRED',  'Refresh token expired');
  if (sess.deleted_at || sess.status === 'deleted') throw new AppError(403, 'USER_DELETED', 'Your account has been disabled. Please contact admin.');
  if (sess.status === 'blocked')               throw new AppError(403, 'USER_BLOCKED',    'Your account has been blocked. Please contact admin.');
  if (sess.status !== 'active')                throw new AppError(403, 'USER_INACTIVE',    'Account is not active');

  const user       = { id: sess.uid, role: normalizeDbRole(sess.role), full_name: sess.full_name };
  const newRefresh = signRefreshToken(user);

  await query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1`, [sess.id]);
  await query(
    `INSERT INTO auth_sessions(user_id, refresh_token_hash, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
    [user.id, newRefresh.hash, req.headers['user-agent'] || null, req.ip, newRefresh.expiresAt]
  );

  res.json({
    success: true,
    data: {
      accessToken:         signAccessToken(user),
      refreshToken:        newRefresh.raw,
      accessTokenExpiresIn: config.jwt.accessTtl,
    },
  });
});

exports.logout = asyncHandler(async (req, res) => {
  // /auth/logout has NO authenticate middleware (we accept refreshToken
  // even when the access token has expired) — so req.user is null. To get
  // a non-blank User Name in the audit log, resolve the user by JOINing
  // auth_sessions → users using the refresh token hash.
  const raw = req.body.refreshToken;
  let sessionId = null;
  let durationSecs = null;
  let auditUser = null;  // { id, name, role } pulled from auth_sessions JOIN

  if (raw) {
    const { rows: [sess] } = await query(
      `SELECT s.id, s.user_id, s.created_at, s.last_activity_at,
              u.full_name, u.role
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.refresh_token_hash = $1 AND s.revoked_at IS NULL
        LIMIT 1`,
      [hashToken(raw)]
    );
    if (sess) {
      sessionId = sess.id;
      durationSecs = Math.max(0, Math.floor((Date.now() - new Date(sess.created_at).getTime()) / 1000));
      auditUser = { id: sess.user_id, name: sess.full_name, role: sess.role };
      await query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1`, [sess.id]);
    }
  }

  // Audit trail — pass a synthetic req-like shape so logActivity gets a
  // proper user_name and user_role even though /auth/logout has no
  // authenticate middleware.
  const { logActivity } = require('../utils/auditLog');
  const syntheticReq = {
    user: auditUser,                                      // null if session not found
    ip: req.ip,
    headers: req.headers,                                 // for user_agent capture
  };
  await logActivity(syntheticReq, {
    entity: 'session',
    entity_id: auditUser?.id || null,
    action: 'logout',
    session_id: sessionId,
    metadata: {
      session_id: sessionId,
      duration_seconds: durationSecs,
      duration_human: durationSecs != null ? formatDuration(durationSecs) : null,
    },
  });
  res.json({ success: true });
});

function formatDuration(secs) {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

exports.me = asyncHandler(async (req, res) => {
  const u = req.user;
  res.json({
    success: true,
    data: {
      id:         u.id,
      name:       u.full_name,
      email:      u.email,
      phone:      u.phone,
      role:       normalizeDbRole(u.role),
      memberType: u.member_type,
      reportToId: u.report_to_id,
      cpId:       u.cp_id,
    },
  });
});
