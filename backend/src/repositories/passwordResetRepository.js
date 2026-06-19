const { query, withTransaction } = require('../config/database');

async function findActiveUserByEmail(email) {
  const { rows } = await query(
    `SELECT id, full_name, email, phone, cp_id, role, report_to_id, status
       FROM users
      WHERE LOWER(email) = $1 AND deleted_at IS NULL`,
    [email],
  );
  return rows[0] || null;
}

async function findTargetUser(userId) {
  const { rows } = await query(
    `SELECT id, full_name, email, phone, cp_id, role, report_to_id, status
       FROM users
      WHERE id = $1 AND deleted_at IS NULL AND COALESCE(is_hidden, FALSE) = FALSE`,
    [userId],
  );
  return rows[0] || null;
}

async function countRecentTokens(userId, since) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count
       FROM password_reset_tokens
      WHERE user_id = $1 AND created_at >= $2`,
    [userId, since],
  );
  return rows[0].count;
}

async function replaceUnusedToken(input) {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE password_reset_tokens
          SET used_at = NOW(), metadata = metadata || '{"superseded":true}'::jsonb
        WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
      [input.userId, input.purpose],
    );
    const { rows } = await client.query(
      `INSERT INTO password_reset_tokens(
         user_id, token_hash, purpose, requested_by_user_id, expires_at,
         ip_address, user_agent, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, expires_at`,
      [
        input.userId,
        input.tokenHash,
        input.purpose,
        input.requestedByUserId || null,
        input.expiresAt,
        input.ipAddress || null,
        input.userAgent || null,
        JSON.stringify(input.metadata || {}),
      ],
    );
    return rows[0];
  });
}

async function findTokenByHash(tokenHash) {
  const { rows } = await query(
    `SELECT t.id, t.user_id, t.purpose, t.expires_at, t.used_at,
            u.email, u.status, u.deleted_at
       FROM password_reset_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1`,
    [tokenHash],
  );
  return rows[0] || null;
}

async function consumeTokenAndResetPassword({ tokenHash, passwordHash }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT t.id, t.user_id, t.expires_at, t.used_at, u.status, u.deleted_at
         FROM password_reset_tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1
        FOR UPDATE OF t`,
      [tokenHash],
    );
    const token = rows[0] || null;
    if (!token) return { status: 'invalid' };
    if (token.used_at || new Date(token.expires_at) <= new Date()) return { status: 'expired' };
    if (token.deleted_at || token.status !== 'active') return { status: 'user_inactive' };

    await client.query(
      `UPDATE users
          SET password_hash = $1, password_changed_at = NOW(), updated_at = NOW()
        WHERE id = $2`,
      [passwordHash, token.user_id],
    );
    await client.query(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
      [token.id],
    );
    await client.query(
      `UPDATE password_reset_tokens
          SET used_at = NOW(), metadata = metadata || '{"invalidated_after_password_change":true}'::jsonb
        WHERE user_id = $1 AND used_at IS NULL`,
      [token.user_id],
    );
    await client.query(
      `UPDATE auth_sessions SET revoked_at = NOW()
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [token.user_id],
    );
    return { status: 'reset', userId: token.user_id };
  });
}

async function createEmailLog(input) {
  const { rows } = await query(
    `INSERT INTO email_delivery_logs(
       user_id, email_to, email_type, provider, status, metadata
     ) VALUES ($1,$2,$3,$4,'queued',$5)
     RETURNING id`,
    [
      input.userId || null,
      input.emailTo,
      input.emailType,
      input.provider,
      JSON.stringify(input.metadata || {}),
    ],
  );
  return rows[0];
}

async function updateEmailLog(logId, input) {
  await query(
    `UPDATE email_delivery_logs
        SET status = $2,
            provider_message_id = $3,
            error_message = $4,
            sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END
      WHERE id = $1`,
    [logId, input.status, input.providerMessageId || null, input.errorMessage || null],
  );
}

module.exports = {
  findActiveUserByEmail,
  findTargetUser,
  countRecentTokens,
  replaceUnusedToken,
  findTokenByHash,
  consumeTokenAndResetPassword,
  createEmailLog,
  updateEmailLog,
};
