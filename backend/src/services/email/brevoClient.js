const config = require('../../config/env');
const { AppError } = require('../../utils/errors');

function isConfigured() {
  return config.email.provider === 'brevo'
    && Boolean(config.email.brevoApiKey && config.email.senderEmail);
}

async function sendTransactionalEmail(message) {
  if (!isConfigured()) {
    throw new AppError(503, 'EMAIL_PROVIDER_NOT_CONFIGURED', 'Email provider is not configured.');
  }

  const payload = {
    sender: { email: config.email.senderEmail, name: config.email.senderName },
    to: [{ email: message.to.email, name: message.to.name || undefined }],
    subject: message.subject,
    htmlContent: message.html,
    textContent: message.text,
  };
  if (message.templateId) {
    delete payload.subject;
    delete payload.htmlContent;
    delete payload.textContent;
    payload.templateId = Number(message.templateId);
    payload.params = message.params || {};
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': config.email.brevoApiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `Brevo request failed with status ${response.status}`);
    error.code = 'BREVO_SEND_FAILED';
    error.status = response.status;
    throw error;
  }
  return { messageId: body.messageId || null };
}

module.exports = { isConfigured, sendTransactionalEmail };
