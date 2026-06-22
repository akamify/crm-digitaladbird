const crypto = require('crypto');
const config = require('../../config/env');
const logger = require('../../utils/logger');
const mapper = require('./waspMessageMapper');

function ensureConfigured() {
  if (!config.wasp.enabled) {
    const error = new Error('WaspAkamify chat is disabled.');
    error.code = 'WASP_CHAT_DISABLED';
    throw error;
  }
  if (!config.wasp.apiKey) {
    const error = new Error('WaspAkamify API key is not configured.');
    error.code = 'WASP_API_KEY_MISSING';
    throw error;
  }
}

function buildUrl(path) {
  return `${config.wasp.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function authHeaders() {
  const header = config.wasp.apiKeyHeader || 'X-API-Key';
  const headers = /^authorization$/i.test(header)
    ? { Authorization: `Bearer ${config.wasp.apiKey}` }
    : { [header]: config.wasp.apiKey };
  if (config.wasp.workspaceId) headers['x-workspace-id'] = config.wasp.workspaceId;
  return headers;
}

function verifyWebhook(req) {
  if (!config.wasp.webhookSecret) return true;
  const provided = req.get('x-wasp-secret') || req.get('x-webhook-secret') || req.query.secret;
  if (provided) {
    const a = Buffer.from(String(provided));
    const b = Buffer.from(config.wasp.webhookSecret);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }

  const signature = req.get('x-waspakamify-signature') || req.get('x-wasp-signature') || req.get('x-hub-signature-256');
  const timestamp = req.get('x-waspakamify-timestamp');
  const rawBuffer = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody || JSON.stringify(req.body || {})));
  const raw = rawBuffer.toString('utf8');
  if (!signature) return false;
  const signedPayload = timestamp ? `${timestamp}.${raw}` : raw;
  const digest = `sha256=${crypto.createHmac('sha256', config.wasp.webhookSecret).update(signedPayload).digest('hex')}`;
  const received = /^sha256=/i.test(signature) ? signature : `sha256=${signature}`;
  try {
    return Buffer.byteLength(received) === Buffer.byteLength(digest)
      && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(digest));
  } catch {
    return false;
  }
}

async function sendTextMessage({ to, waId, text, contact, metadata }) {
  ensureConfigured();
  const body = {
    to: mapper.normalizeWaId(to || waId),
    text,
    contact: contact || undefined,
    metadata: { crm: 'digitaladbird', ...(metadata || {}) },
  };
  const response = await fetch(buildUrl(config.wasp.sendMessagePath), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || payload?.message || `WaspAkamify send failed (${response.status})`);
    error.code = 'WASP_SEND_FAILED';
    error.status = response.status;
    logger.warn({ status: response.status, code: error.code }, '[Wasp] send failed');
    throw error;
  }
  return mapper.normalizeOutboundResponse(payload);
}

module.exports = {
  verifyWebhook,
  sendTextMessage,
  buildUrl,
};
