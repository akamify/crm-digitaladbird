const { query, withTransaction } = require('../../config/database');
const config = require('../../config/env');
const logger = require('../../utils/logger');
const client = require('./waspChatClient');
const mapper = require('./waspMessageMapper');
const inbound = require('./waspInboundService');
const { addSessionHours } = require('../chat/chatSessionService');

const MAX_CONVERSATIONS_PER_SYNC = 50;
const MAX_MESSAGES_PER_CONVERSATION = 30;

async function upsertExternalMessage(db, conversation, normalized) {
  if (normalized.external_message_id) {
    const { rows: [existing] } = await db.query(
      `SELECT id FROM chat_messages WHERE provider = 'wasp' AND external_message_id = $1 LIMIT 1`,
      [normalized.external_message_id],
    );
    if (existing) return { created: false, id: existing.id };
  }

  const body = normalized.text || (normalized.media?.url ? `[${normalized.message_type || 'media'}] ${normalized.media.url}` : '[Unsupported WhatsApp message]');
  const { rows: [message] } = await db.query(
    `INSERT INTO chat_messages(
       conversation_id, sender_id, body, message_type, metadata, channel, provider, direction,
       sender_type, external_message_id, external_conversation_id, delivery_status, provider_payload, created_at
     ) VALUES ($1,NULL,$2,$3,$4,'whatsapp','wasp',$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      conversation.id,
      body,
      ['text', 'image', 'audio', 'video', 'document'].includes(normalized.message_type) ? normalized.message_type : 'text',
      JSON.stringify({
        customer_phone: normalized.customer_phone,
        customer_wa_id: normalized.customer_wa_id,
        media: normalized.media || null,
        synced_from_external_chat_api: true,
      }),
      normalized.direction === 'outbound' ? 'outbound' : 'inbound',
      normalized.sender_type || (normalized.direction === 'outbound' ? 'user' : 'customer'),
      normalized.external_message_id || null,
      normalized.external_conversation_id || conversation.external_conversation_id || null,
      normalized.status || (normalized.direction === 'outbound' ? 'sent' : 'received'),
      JSON.stringify(normalized.raw_payload || {}),
      normalized.timestamp || new Date().toISOString(),
    ],
  );
  return { created: true, id: message.id };
}

async function syncConversationMessages(db, externalConversation, localConversation, options = {}) {
  const phone = externalConversation.customer_wa_id || externalConversation.customer_phone;
  if (!phone) return { fetched: 0, created: 0 };

  const payload = await client.listConversationMessages(phone, {
    limit: options.messageLimit || MAX_MESSAGES_PER_CONVERSATION,
  });
  const rows = mapper.unwrapList(payload, ['messages', 'data.messages', 'data.items', 'items']);
  let created = 0;
  for (const row of rows) {
    const normalized = mapper.normalizeExternalMessage(row, externalConversation);
    const result = await upsertExternalMessage(db, localConversation, normalized);
    if (result.created) created += 1;
  }
  return { fetched: rows.length, created };
}

async function syncExternalInbox(options = {}) {
  if (!config.wasp.enabled) {
    return { enabled: false, conversations_fetched: 0, conversations_synced: 0, messages_fetched: 0, messages_created: 0 };
  }

  const limit = options.limit || MAX_CONVERSATIONS_PER_SYNC;
  const maxPages = options.maxPages || 20;
  const externalRows = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await client.listConversations({ limit, page });
    const rows = mapper.unwrapList(payload, ['conversations', 'data.conversations', 'data.items', 'items']);
    externalRows.push(...rows);
    const pagination = payload?.data?.pagination || payload?.pagination || {};
    const hasNextPage = Boolean(pagination.hasNextPage || pagination.has_next_page || pagination.next);
    logger.info({
      page,
      count: rows.length,
      total: pagination.total || null,
      hasNextPage,
    }, '[Wasp] external inbox conversations page fetched');
    if (!hasNextPage || !rows.length) break;
  }
  const deduped = new Map();
  externalRows
    .map(mapper.normalizeExternalConversation)
    .filter(row => row.customer_phone || row.customer_wa_id)
    .forEach((row) => {
      const key = row.external_conversation_id || row.customer_wa_id || row.customer_phone;
      if (!deduped.has(key)) deduped.set(key, row);
    });
  const externalConversations = [...deduped.values()];

  let conversationsSynced = 0;
  let messagesFetched = 0;
  let messagesCreated = 0;
  const errors = [];

  for (const externalConversation of externalConversations) {
    try {
      const result = await withTransaction(async (db) => {
        const lead = await inbound.findLead({
          customer_phone: externalConversation.customer_phone,
          customer_wa_id: externalConversation.customer_wa_id,
        });
        const conversation = await inbound.findOrCreateConversation(db, externalConversation, lead);
        const admins = await inbound.activeAdmins(db);
        const participantIds = lead
          ? [lead.assigned_to_user_id, lead.report_to_id, ...admins.map(admin => admin.id)]
          : admins.map(admin => admin.id);
        await inbound.ensureParticipants(db, conversation.id, participantIds);

        const lastInboundAt = externalConversation.last_customer_message_at || externalConversation.last_message_at || new Date().toISOString();
        const sessionExpiresAt = externalConversation.customer_service_window_expires_at
          || (externalConversation.can_reply === true ? addSessionHours(lastInboundAt) : null);
        const sessionStatus = externalConversation.service_window_status === 'open' || externalConversation.can_reply === true ? 'open' : 'closed';
        await db.query(
          `UPDATE chat_conversations
              SET channel = 'whatsapp',
                  provider = 'wasp',
                  customer_phone = COALESCE(customer_phone, $2),
                  customer_wa_id = COALESCE(customer_wa_id, $3),
                  external_conversation_id = COALESCE(NULLIF(external_conversation_id, ''), $4),
                  session_status = $5,
                  last_inbound_at = COALESCE($6, last_inbound_at),
                  session_expires_at = $7,
                  provider_metadata = COALESCE(provider_metadata, '{}'::jsonb) || $8::jsonb,
                  updated_at = NOW()
            WHERE id = $1`,
          [
            conversation.id,
            externalConversation.customer_phone,
            externalConversation.customer_wa_id,
            externalConversation.external_conversation_id || null,
            sessionStatus,
            externalConversation.last_customer_message_at,
            sessionExpiresAt,
            JSON.stringify({
              external_chat_api_last_sync_at: new Date().toISOString(),
              service_window_status: externalConversation.service_window_status || null,
              can_reply: externalConversation.can_reply,
              remaining_window_ms: externalConversation.remaining_window_ms,
              external_conversation: externalConversation.raw_payload || {},
            }),
          ],
        );

        const messageStats = await syncConversationMessages(db, externalConversation, conversation, options);
        return { conversationId: conversation.id, ...messageStats };
      });
      conversationsSynced += 1;
      messagesFetched += result.fetched;
      messagesCreated += result.created;
    } catch (error) {
      errors.push({
        phone: externalConversation.customer_phone || externalConversation.customer_wa_id,
        message: error.message,
        code: error.code || null,
      });
      logger.warn({ phone: externalConversation.customer_phone, code: error.code, message: error.message }, '[Wasp] external inbox conversation sync failed');
    }
  }

  return {
    enabled: true,
    conversations_fetched: externalConversations.length,
    conversations_synced: conversationsSynced,
    messages_fetched: messagesFetched,
    messages_created: messagesCreated,
    errors,
  };
}

async function markExternalConversationRead(conversationId) {
  const { rows: [conversation] } = await query(
    `SELECT customer_wa_id, customer_phone FROM chat_conversations WHERE id = $1 AND provider = 'wasp'`,
    [conversationId],
  );
  if (!conversation) return null;
  return client.markConversationRead(conversation.customer_wa_id || conversation.customer_phone);
}

module.exports = {
  syncExternalInbox,
  markExternalConversationRead,
};
