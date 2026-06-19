const config = require('../../config/env');
const logger = require('../../utils/logger');
const repository = require('../../repositories/passwordResetRepository');
const brevo = require('./brevoClient');
const templates = require('./emailTemplates');

function safeError(error) {
  return String(error?.message || 'Email delivery failed').slice(0, 500);
}

async function deliver({ user, emailType, templateId, template, params, metadata }) {
  const provider = config.email.provider || 'brevo';
  const log = await repository.createEmailLog({
    userId: user.id,
    emailTo: user.email,
    emailType,
    provider,
    metadata,
  });

  if (!brevo.isConfigured()) {
    await repository.updateEmailLog(log.id, {
      status: 'skipped',
      errorMessage: 'Email provider is not configured.',
    });
    const error = new Error('Email provider is not configured.');
    error.code = 'EMAIL_PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  try {
    const result = await brevo.sendTransactionalEmail({
      to: { email: user.email, name: user.full_name },
      ...template,
      templateId: templateId || null,
      params,
    });
    await repository.updateEmailLog(log.id, {
      status: 'sent',
      providerMessageId: result.messageId,
    });
    return result;
  } catch (error) {
    const message = safeError(error);
    await repository.updateEmailLog(log.id, { status: 'failed', errorMessage: message });
    logger.warn({ userId: user.id, emailType, provider, code: error.code || 'EMAIL_SEND_FAILED' }, 'Email delivery failed');
    throw error;
  }
}

function commonParams(user, resetUrl, requestedBy) {
  return {
    USER_NAME: user.full_name,
    USER_EMAIL: user.email,
    USER_PHONE: user.phone || '',
    CP_ID: user.cp_id,
    USER_ROLE: user.role,
    RESET_URL: resetUrl,
    LOGIN_URL: `${config.email.frontendUrl}/login`,
    EXPIRES_MINUTES: config.email.resetTtlMinutes,
    REQUESTED_BY: requestedBy?.full_name || requestedBy?.name || '',
  };
}

async function sendPasswordResetEmail({ user, resetUrl }) {
  return deliver({
    user,
    emailType: 'password_reset',
    templateId: config.email.resetTemplateId,
    template: templates.resetEmail({ user, resetUrl, expiresMinutes: config.email.resetTtlMinutes }),
    params: commonParams(user, resetUrl),
    metadata: { purpose: 'password_reset' },
  });
}

async function sendNewUserOnboardingEmail({ user, resetUrl, createdBy }) {
  return deliver({
    user,
    emailType: 'new_user_onboarding',
    templateId: config.email.onboardingTemplateId,
    template: templates.onboardingEmail({
      user,
      resetUrl,
      loginUrl: `${config.email.frontendUrl}/login`,
      expiresMinutes: config.email.resetTtlMinutes,
    }),
    params: commonParams(user, resetUrl, createdBy),
    metadata: { purpose: 'new_user_setup', created_by_user_id: createdBy?.id || null },
  });
}

async function sendAdminResetLinkEmail({ user, resetUrl, requestedBy }) {
  return deliver({
    user,
    emailType: 'admin_reset_link',
    templateId: config.email.adminResetTemplateId,
    template: templates.adminResetEmail({ user, resetUrl, requestedBy, expiresMinutes: config.email.resetTtlMinutes }),
    params: commonParams(user, resetUrl, requestedBy),
    metadata: { purpose: 'admin_forced_reset', requested_by_user_id: requestedBy?.id || null },
  });
}

module.exports = {
  isConfigured: brevo.isConfigured,
  sendPasswordResetEmail,
  sendNewUserOnboardingEmail,
  sendAdminResetLinkEmail,
};
