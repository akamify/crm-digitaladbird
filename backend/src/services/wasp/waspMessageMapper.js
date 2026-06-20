const config = require('../../config/env');

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizePhone(value) {
  const raw = digits(value);
  if (!raw) return null;
  if (raw.length === 10) return `+${config.wasp.defaultCountryCode}${raw}`;
  if (raw.startsWith(config.wasp.defaultCountryCode) && raw.length >= 12) return `+${raw}`;
  return raw.startsWith('+') ? raw : `+${raw}`;
}

function normalizeWaId(value, phone) {
  return digits(value || phone);
}

function pick(payload, keys) {
  for (const key of keys) {
    const value = key.split('.').reduce((acc, part) => acc?.[part], payload);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function normalizeInbound(payload = {}) {
  const data = payload.data || payload.message || payload.messages?.[0] || payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0] || payload;
  const contact = payload.contact || payload.contacts?.[0] || payload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0] || {};
  const phone = normalizePhone(pick(data, ['customer_phone', 'phone', 'from', 'sender', 'wa_id']) || contact.wa_id || contact.phone);
  const waId = normalizeWaId(pick(data, ['customer_wa_id', 'wa_id', 'from']) || contact.wa_id, phone);
  const text = pick(data, ['text.body', 'text', 'message', 'body', 'content', 'caption']) || '';
  const type = pick(data, ['type', 'message_type']) || (text ? 'text' : 'unknown');
  const timestamp = pick(data, ['timestamp', 'created_at', 'time']) || payload.timestamp || new Date().toISOString();

  return {
    provider: 'wasp',
    external_message_id: String(pick(data, ['message_id', 'id', 'external_message_id']) || ''),
    external_conversation_id: String(pick(data, ['chat_id', 'conversation_id', 'external_conversation_id', 'thread_id']) || ''),
    direction: 'inbound',
    customer_phone: phone,
    customer_wa_id: waId,
    message_type: String(type || 'text').toLowerCase(),
    text: String(text || '').trim(),
    timestamp: new Date(Number(timestamp) && String(timestamp).length <= 10 ? Number(timestamp) * 1000 : timestamp).toISOString(),
    raw_payload: payload,
  };
}

function normalizeOutboundResponse(response = {}) {
  const data = response.data || response.message || response;
  return {
    success: response.success !== false,
    external_message_id: String(pick(data, ['message_id', 'id', 'external_message_id']) || ''),
    external_conversation_id: String(pick(data, ['chat_id', 'conversation_id', 'external_conversation_id']) || ''),
    status: String(pick(data, ['status', 'delivery_status']) || 'sent'),
    raw_response: response,
  };
}

module.exports = {
  normalizePhone,
  normalizeWaId,
  normalizeInbound,
  normalizeOutboundResponse,
};

