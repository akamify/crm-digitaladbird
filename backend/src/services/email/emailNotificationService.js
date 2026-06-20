const config = require('../../config/env');
const logger = require('../../utils/logger');
const repository = require('../../repositories/passwordResetRepository');
const brevo = require('./brevoClient');

function safeError(error) {
  return String(error?.message || 'Email delivery failed').slice(0, 500);
}

async function sendNotificationEmail({ user, emailType, subject, html, text, metadata = {} }) {
  if (!user?.email) return { status: 'skipped', reason: 'missing_email' };

  const provider = config.email?.provider || 'brevo';
  let log = null;
  try {
    log = await repository.createEmailLog({
      userId: user.id,
      emailTo: user.email,
      emailType,
      provider,
      metadata,
    });
  } catch (err) {
    logger.warn({ err: err.message, userId: user.id, emailType }, '[NotificationEmail] email log create failed');
  }

  if (!brevo.isConfigured()) {
    if (log?.id) {
      await repository.updateEmailLog(log.id, {
        status: 'skipped',
        errorMessage: 'Email provider is not configured.',
      }).catch(() => {});
    }
    return { status: 'skipped', reason: 'provider_not_configured' };
  }

  try {
    const result = await brevo.sendTransactionalEmail({
      to: { email: user.email, name: user.full_name },
      subject,
      html,
      text,
    });
    if (log?.id) {
      await repository.updateEmailLog(log.id, {
        status: 'sent',
        providerMessageId: result.messageId,
      }).catch(() => {});
    }
    return { status: 'sent', providerMessageId: result.messageId };
  } catch (error) {
    const message = safeError(error);
    if (log?.id) {
      await repository.updateEmailLog(log.id, { status: 'failed', errorMessage: message }).catch(() => {});
    }
    logger.warn({ userId: user.id, emailType, provider, code: error.code || 'EMAIL_SEND_FAILED' }, '[NotificationEmail] send failed');
    return { status: 'failed', error: message };
  }
}

module.exports = { sendNotificationEmail };

