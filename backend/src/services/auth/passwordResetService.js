const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../../config/env');
const { AppError } = require('../../utils/errors');
const { logActivity } = require('../../utils/auditLog');
const repository = require('../../repositories/passwordResetRepository');
const emailService = require('../email/emailService');

const PURPOSES = new Set(['password_reset', 'new_user_setup', 'admin_forced_reset']);
const COMMON_PASSWORDS = new Set(['password', 'password123', 'admin123', 'qwerty123', 'welcome123']);

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return '***';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

function validatePassword(password, confirmPassword) {
  if (password !== confirmPassword) throw new AppError(400, 'PASSWORD_MISMATCH', 'Passwords do not match.');
  if (typeof password !== 'string' || password.length < 8
      || !/[A-Z]/.test(password) || !/[a-z]/.test(password)
      || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new AppError(400, 'PASSWORD_WEAK', 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.');
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    throw new AppError(400, 'PASSWORD_WEAK', 'Choose a less common password.');
  }
}

function buildResetUrl(token) {
  return `${config.email.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

async function createPasswordResetToken(input) {
  if (!PURPOSES.has(input.purpose)) throw new AppError(400, 'RESET_PURPOSE_INVALID', 'Invalid reset purpose.');
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await repository.countRecentTokens(input.userId, since);
  if (recent >= config.email.resetMaxPerHour) {
    throw new AppError(429, 'RESET_RATE_LIMITED', 'Too many reset links requested. Please try again later.');
  }

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.email.resetTtlMinutes * 60 * 1000);
  await repository.replaceUnusedToken({
    userId: input.userId,
    tokenHash: tokenHash(rawToken),
    purpose: input.purpose,
    requestedByUserId: input.requestedByUserId,
    expiresAt,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    metadata: input.metadata,
  });
  await logActivity({
    user: input.requestedByUserId ? { id: input.requestedByUserId } : null,
    ip: input.ipAddress,
    headers: { 'user-agent': input.userAgent },
  }, {
    entity: 'user', entity_id: input.userId, action: 'password_reset_token_created',
    metadata: { purpose: input.purpose, expires_at: expiresAt.toISOString() },
  });
  return { rawToken, expiresAt, resetUrl: buildResetUrl(rawToken) };
}

async function requestPasswordResetByEmail({ email, ipAddress, userAgent }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) return;
  const user = await repository.findActiveUserByEmail(normalizedEmail);
  if (!user || user.status !== 'active') return;

  try {
    const reset = await createPasswordResetToken({
      userId: user.id,
      purpose: 'password_reset',
      ipAddress,
      userAgent,
      metadata: { source: 'public_forgot_password' },
    });
    await emailService.sendPasswordResetEmail({ user, resetUrl: reset.resetUrl });
    await logActivity({ user: null, ip: ipAddress, headers: { 'user-agent': userAgent } }, {
      entity: 'user', entity_id: user.id, action: 'forgot_password_requested',
      metadata: { email_masked: maskEmail(user.email), provider: config.email.provider },
    });
  } catch (error) {
    await logActivity({ user: null, ip: ipAddress, headers: { 'user-agent': userAgent } }, {
      entity: 'user', entity_id: user.id, action: 'password_reset_email_failed',
      metadata: { code: error.code || 'EMAIL_SEND_FAILED' },
    });
  }
}

function assertManagerCanTarget(actor, target) {
  if (!actor) throw new AppError(401, 'NO_USER', 'Not authenticated');
  if (actor.role === 'super_admin' || actor.role === 'admin') return;
  if (actor.role === 'rm' && target.report_to_id === actor.id) return;
  throw new AppError(403, 'FORBIDDEN', 'You can send reset links only to users in your team.');
}

async function getAuthorizedTarget(targetUserId, actor) {
  const target = await repository.findTargetUser(targetUserId);
  if (!target) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
  assertManagerCanTarget(actor, target);
  if (!target.email) throw new AppError(400, 'USER_EMAIL_MISSING', 'User has no registered email.');
  if (target.status !== 'active') throw new AppError(400, 'USER_INACTIVE', 'Account inactive or blocked.');
  return target;
}

async function adminSendResetLink({ targetUserId, adminUser, ipAddress, userAgent }) {
  const user = await getAuthorizedTarget(targetUserId, adminUser);
  const reset = await createPasswordResetToken({
    userId: user.id,
    purpose: 'admin_forced_reset',
    requestedByUserId: adminUser.id,
    ipAddress,
    userAgent,
    metadata: { source: 'admin_user_action' },
  });
  try {
    await emailService.sendAdminResetLinkEmail({ user, resetUrl: reset.resetUrl, requestedBy: adminUser });
  } catch (error) {
    await logActivity({ user: adminUser, ip: ipAddress, headers: { 'user-agent': userAgent } }, {
      entity: 'user', entity_id: user.id, action: 'admin_reset_email_failed',
      metadata: { code: error.code || 'EMAIL_SEND_FAILED' },
    });
    throw error;
  }
  await logActivity({ user: adminUser, ip: ipAddress, headers: { 'user-agent': userAgent } }, {
    entity: 'user', entity_id: user.id, action: 'admin_reset_link_sent',
    metadata: { email_masked: maskEmail(user.email), provider: config.email.provider },
  });
  return { message: 'Reset link sent.' };
}

async function sendNewUserSetupLink({ userId, createdByUser, ipAddress, userAgent }) {
  const user = await getAuthorizedTarget(userId, createdByUser);
  const reset = await createPasswordResetToken({
    userId: user.id,
    purpose: 'new_user_setup',
    requestedByUserId: createdByUser.id,
    ipAddress,
    userAgent,
    metadata: { source: 'user_onboarding' },
  });
  try {
    await emailService.sendNewUserOnboardingEmail({ user, resetUrl: reset.resetUrl, createdBy: createdByUser });
  } catch (error) {
    await logActivity({ user: createdByUser, ip: ipAddress, headers: { 'user-agent': userAgent } }, {
      entity: 'user', entity_id: user.id, action: 'onboarding_email_failed',
      metadata: { code: error.code || 'EMAIL_SEND_FAILED' },
    });
    throw error;
  }
  await logActivity({ user: createdByUser, ip: ipAddress, headers: { 'user-agent': userAgent } }, {
    entity: 'user', entity_id: user.id, action: 'onboarding_email_sent',
    metadata: { email_masked: maskEmail(user.email), provider: config.email.provider },
  });
  return { message: 'Onboarding email sent.' };
}

async function verifyResetToken(rawToken) {
  if (!rawToken || String(rawToken).length < 32) return null;
  const token = await repository.findTokenByHash(tokenHash(String(rawToken)));
  if (!token || token.used_at || token.deleted_at || token.status !== 'active' || new Date(token.expires_at) <= new Date()) return null;
  return { valid: true, email: maskEmail(token.email), expiresAt: token.expires_at };
}

async function resetPasswordWithToken({ token, newPassword, confirmPassword, ipAddress, userAgent }) {
  validatePassword(newPassword, confirmPassword);
  const activeToken = await verifyResetToken(token);
  if (!activeToken) throw new AppError(400, 'RESET_TOKEN_INVALID', 'This reset link is invalid or expired.');
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const result = await repository.consumeTokenAndResetPassword({ tokenHash: tokenHash(String(token || '')), passwordHash });
  if (result.status !== 'reset') throw new AppError(400, 'RESET_TOKEN_INVALID', 'This reset link is invalid or expired.');
  await logActivity({ user: { id: result.userId }, ip: ipAddress, headers: { 'user-agent': userAgent } }, {
    entity: 'user', entity_id: result.userId, action: 'password_reset_completed',
    metadata: { sessions_revoked: true },
  });
  return { message: 'Password reset successfully. Please login again.' };
}

module.exports = {
  createPasswordResetToken,
  buildResetUrl,
  requestPasswordResetByEmail,
  adminSendResetLink,
  sendNewUserSetupLink,
  resetPasswordWithToken,
  verifyResetToken,
  validatePassword,
};
