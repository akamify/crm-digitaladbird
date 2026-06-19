#!/usr/bin/env node
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { query, closePool } = require('../src/config/database');
const service = require('../src/services/auth/passwordResetService');

async function run() {
  const suffix = crypto.randomBytes(8).toString('hex');
  const email = `auth-test-${suffix}@example.invalid`;
  const cpId = `TEST-${suffix.toUpperCase()}`;
  const oldPassword = `OldPass@${suffix}1`;
  const newPassword = `NewPass@${suffix}2`;
  let userId;

  try {
    const oldHash = await bcrypt.hash(oldPassword, 4);
    const { rows: [user] } = await query(
      `INSERT INTO users(emp_code, cp_id, full_name, email, phone, role, status, password_hash)
       VALUES ($1,$1,'Auth Verification User',$2,NULL,'member','active',$3)
       RETURNING id`,
      [cpId, email, oldHash],
    );
    userId = user.id;
    await query(
      `INSERT INTO auth_sessions(user_id, refresh_token_hash, expires_at)
       VALUES ($1,$2,NOW() + INTERVAL '1 day')`,
      [userId, crypto.createHash('sha256').update(suffix).digest('hex')],
    );

    const issued = await service.createPasswordResetToken({ userId, purpose: 'password_reset' });
    const before = await service.verifyResetToken(issued.rawToken);
    await service.resetPasswordWithToken({
      token: issued.rawToken,
      newPassword,
      confirmPassword: newPassword,
      ipAddress: '127.0.0.1',
      userAgent: 'auth-verification-script',
    });
    const after = await service.verifyResetToken(issued.rawToken);
    const { rows: [state] } = await query(
      `SELECT u.password_hash,
              COUNT(s.id) FILTER (WHERE s.revoked_at IS NULL)::int AS active_sessions
         FROM users u
         LEFT JOIN auth_sessions s ON s.user_id = u.id
        WHERE u.id = $1
        GROUP BY u.id`,
      [userId],
    );
    const memberToken = signAccessToken({ id: userId, role: 'member', full_name: 'Auth Verification User' });
    const forbidden = await request(app)
      .post(`/api/admin/users/${userId}/send-password-reset`)
      .set('Authorization', `Bearer ${memberToken}`);

    const result = {
      token_valid_before_reset: Boolean(before),
      token_invalid_after_reset: !after,
      new_password_matches: await bcrypt.compare(newPassword, state.password_hash),
      old_password_rejected: !(await bcrypt.compare(oldPassword, state.password_hash)),
      active_sessions_after_reset: state.active_sessions,
      member_admin_action_forbidden: forbidden.status === 403,
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.token_valid_before_reset || !result.token_invalid_after_reset
        || !result.new_password_matches || !result.old_password_rejected
        || result.active_sessions_after_reset !== 0 || !result.member_admin_action_forbidden) process.exitCode = 1;
  } finally {
    if (userId) {
      await query(`DELETE FROM activity_logs WHERE entity = 'user' AND entity_id = $1`, [userId]).catch(() => {});
      await query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    }
    await closePool();
  }
}

run()
  .then(() => process.exit(process.exitCode || 0))
  .catch((error) => { console.error(`Password reset verification failed: ${error.message}`); process.exit(1); });
