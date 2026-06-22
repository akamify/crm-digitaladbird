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

function toIsoDate(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(Number(value) && String(value).length <= 10 ? Number(value) * 1000 : value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function pick(payload, keys) {
  for (const key of keys) {
    const value = key.split('.').reduce((acc, part) => acc?.[part], payload);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function eventType(payload = {}, headers = {}) {
  return String(
    payload.type
    || payload.event
    || payload.event_type
    || headers['x-waspakamify-event']
    || headers['X-Waspakamify-Event']
    || ''
  ).trim();
}

function unwrapMessage(payload = {}) {
  const data = payload.data || payload;
  return data.message || data.item || payload.message || payload.messages?.[0]
    || payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    || data;
}

function normalizeMedia(data = {}) {
  const media = data.media || data.attachment || data.file || null;
  if (!media) return null;
  return {
    url: pick(media, ['url', 'link', 'downloadUrl', 'download_url']),
    mime_type: pick(media, ['mime_type', 'mimeType', 'type']),
    file_name: pick(media, ['filename', 'file_name', 'name']),
    id: pick(media, ['id', 'media_id', 'mediaId']),
  };
}

function normalizeInbound(payload = {}) {
  const data = unwrapMessage(payload);
  const contact = payload.contact || payload.contacts?.[0] || payload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0] || {};
  const phone = normalizePhone(pick(data, ['customer_phone', 'phone', 'from', 'to', 'sender', 'wa_id']) || contact.wa_id || contact.phone);
  const waId = normalizeWaId(pick(data, ['customer_wa_id', 'wa_id', 'from', 'to']) || contact.wa_id, phone);
  const text = pick(data, ['text.body', 'text', 'message', 'body', 'content', 'caption']) || '';
  const media = normalizeMedia(data);
  const type = pick(data, ['message_type', 'type']) || (media?.mime_type?.split('/')?.[0]) || (text ? 'text' : 'unknown');
  const timestamp = pick(data, ['createdAt', 'created_at', 'timestamp', 'time']) || payload.timestamp || new Date().toISOString();

  return {
    provider: 'wasp',
    event_type: eventType(payload),
    external_message_id: String(pick(data, ['whatsappMessageId', 'message_id', 'id', 'external_message_id']) || ''),
    external_conversation_id: String(pick(data, ['conversation.id', 'conversationId', 'chat_id', 'conversation_id', 'external_conversation_id', 'thread_id']) || ''),
    direction: String(pick(data, ['direction']) || 'inbound').toLowerCase(),
    status: String(pick(data, ['status', 'delivery_status']) || 'received').toLowerCase(),
    customer_phone: phone,
    customer_wa_id: waId,
    message_type: String(type || 'text').toLowerCase(),
    text: String(text || '').trim(),
    media,
    timestamp: toIsoDate(timestamp),
    raw_payload: payload,
  };
}

function normalizeOutboundResponse(response = {}) {
  const data = response.data?.message || response.data || response.message || response;
  return {
    success: response.success !== false,
    external_message_id: String(pick(data, ['whatsappMessageId', 'message_id', 'id', 'external_message_id']) || ''),
    external_conversation_id: String(pick(data, ['conversation.id', 'conversationId', 'chat_id', 'conversation_id', 'external_conversation_id']) || ''),
    status: String(pick(data, ['status', 'delivery_status']) || 'sent'),
    raw_response: response,
  };
}

function normalizeStatusUpdate(payload = {}) {
  const data = unwrapMessage(payload);
  return {
    provider: 'wasp',
    event_type: eventType(payload),
    external_message_id: String(pick(data, ['whatsappMessageId', 'message_id', 'id', 'external_message_id']) || ''),
    external_conversation_id: String(pick(data, ['conversation.id', 'conversationId', 'chat_id', 'conversation_id', 'external_conversation_id']) || ''),
    customer_phone: normalizePhone(pick(data, ['phone', 'to', 'from', 'customer_phone'])),
    status: String(pick(data, ['status', 'delivery_status']) || '').toLowerCase(),
    timestamp: toIsoDate(pick(data, ['updatedAt', 'updated_at', 'createdAt', 'created_at', 'timestamp'])),
    raw_payload: payload,
  };
}

module.exports = {
  normalizePhone,
  normalizeWaId,
  normalizeInbound,
  normalizeOutboundResponse,
  normalizeStatusUpdate,
  eventType,
};
