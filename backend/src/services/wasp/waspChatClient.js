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

async function requestJson(path, { method = 'GET', body, headers } = {}) {
  ensureConfigured();
  const response = await fetch(buildUrl(path), {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || payload?.message || `WaspAkamify API failed (${response.status})`);
    error.code = payload?.error?.code || 'WASP_API_FAILED';
    error.status = response.status;
    error.payload = payload;
    logger.warn({ path, status: response.status, code: error.code }, '[Wasp] API request failed');
    throw error;
  }
  return payload;
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
  const body = {
    to: mapper.normalizeWaId(to || waId),
    text,
    contact: contact || undefined,
    metadata: { crm: 'digitaladbird', ...(metadata || {}) },
  };
  const payload = await requestJson(config.wasp.sendMessagePath, { method: 'POST', body });
  return mapper.normalizeOutboundResponse(payload);
}

async function listConversations(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  const suffix = query.toString() ? `?${query}` : '';
  return requestJson(`${config.wasp.fetchMessagesPath}${suffix}`);
}

async function listConversationMessages(phone, params = {}) {
  const normalized = mapper.normalizeWaId(phone);
  if (!normalized) {
    const error = new Error('Conversation phone is required.');
    error.code = 'WASP_PHONE_REQUIRED';
    throw error;
  }
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  const suffix = query.toString() ? `?${query}` : '';
  return requestJson(`/external/chat/conversations/${encodeURIComponent(normalized)}/messages${suffix}`);
}

async function markConversationRead(phone) {
  const normalized = mapper.normalizeWaId(phone);
  if (!normalized) return null;
  return requestJson(`/external/chat/conversations/${encodeURIComponent(normalized)}/read`, { method: 'POST' });
}

module.exports = {
  verifyWebhook,
  sendTextMessage,
  listConversations,
  listConversationMessages,
  markConversationRead,
  requestJson,
  buildUrl,
};
