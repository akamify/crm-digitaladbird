const { query, withTransaction } = require('../../config/database');
const config = require('../../config/env');
const logger = require('../../utils/logger');
const mapper = require('./waspMessageMapper');
const { addSessionHours, getChatSessionState } = require('../chat/chatSessionService');
const { emitToUser, emitToConversation } = require('../socketService');
const notifications = require('../notificationService');

function phoneVariants(phone, waId) {
  const d = mapper.normalizeWaId(waId, phone);
  const variants = new Set([phone, d, d ? `+${d}` : null]);
  if (d?.startsWith(config.wasp.defaultCountryCode)) variants.add(d.slice(config.wasp.defaultCountryCode.length));
  return [...variants].filter(Boolean);
}

async function findLead(normalized) {
  const variants = phoneVariants(normalized.customer_phone, normalized.customer_wa_id);
  const { rows } = await query(
    `SELECT l.id, l.full_name, l.phone, l.email, l.category, l.campaign_name,
            l.assigned_to_user_id, u.full_name AS assigned_to_name, u.report_to_id
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to_user_id
      WHERE l.deleted_at IS NULL
        AND regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g') = ANY($1)
      ORDER BY CASE WHEN l.assigned_to_user_id IS NOT NULL THEN 0 ELSE 1 END, l.created_at DESC
      LIMIT 1`,
    [variants.map(v => v.replace(/\D/g, ''))],
  );
  return rows[0] || null;
}

async function activeAdmins(client) {
  const { rows } = await client.query(
    `SELECT id, full_name, email, role
       FROM users
      WHERE role IN ('super_admin', 'admin')
        AND deleted_at IS NULL
        AND COALESCE(status, 'active') = 'active'`,
  );
  return rows;
}

async function ensureParticipants(client, conversationId, ids) {
  for (const id of [...new Set(ids.filter(Boolean))]) {
    await client.query(
      `INSERT INTO chat_participants(conversation_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [conversationId, id],
    );
  }
}

async function findOrCreateConversation(client, normalized, lead) {
  const params = [];
  let existingSql = `
    SELECT * FROM chat_conversations
     WHERE is_deleted = FALSE
       AND provider = 'wasp'
       AND channel = 'whatsapp'`;
  if (normalized.external_conversation_id) {
    params.push(normalized.external_conversation_id);
    existingSql += ` AND external_conversation_id = $${params.length}`;
  } else if (lead?.id) {
    params.push(lead.id);
    existingSql += ` AND lead_id = $${params.length}`;
  } else {
    params.push(normalized.customer_phone, normalized.customer_wa_id);
    existingSql += ` AND (customer_phone = $${params.length - 1} OR customer_wa_id = $${params.length})`;
  }
  existingSql += ` ORDER BY updated_at DESC LIMIT 1`;
  const { rows: existing } = await client.query(existingSql, params);
  if (existing[0]) return existing[0];

  const admins = lead ? [] : await activeAdmins(client);
  const createdBy = lead?.assigned_to_user_id || admins[0]?.id || null;
  if (!createdBy) {
    throw Object.assign(new Error('No active admin is available to own this external WhatsApp conversation.'), {
      code: 'WASP_EXTERNAL_CHAT_NO_ADMIN',
    });
  }
  const { rows: [conversation] } = await client.query(
    `INSERT INTO chat_conversations(
       type, title, lead_id, created_by, channel, provider, customer_phone, customer_wa_id,
       external_conversation_id, session_status, is_external_unknown, provider_metadata
     ) VALUES ($1,$2,$3,$4,'whatsapp','wasp',$5,$6,$7,'open',$8,$9)
     RETURNING *`,
    [
      lead ? 'lead' : 'direct',
      lead ? `WhatsApp: ${lead.full_name || normalized.customer_phone}` : `External WhatsApp: ${normalized.customer_phone || normalized.customer_wa_id}`,
      lead?.id || null,
      createdBy,
      normalized.customer_phone,
      normalized.customer_wa_id,
      normalized.external_conversation_id || null,
      !lead,
      JSON.stringify({ source: 'wasp_inbound' }),
    ],
  );
  return conversation;
}

async function notifyInbound({ normalized, lead, conversation, message, participants }) {
  const session = getChatSessionState(conversation);
  const payload = {
    conversation_id: conversation.id,
    lead_id: lead?.id || null,
    direction: 'inbound',
    channel: 'whatsapp',
    provider: 'wasp',
    message,
    session,
    play_sound: config.wasp.newMessageSoundEnabled,
  };
  emitToConversation(conversation.id, 'chat:message:new', payload);
  emitToConversation(conversation.id, 'message:new', message);
  for (const id of participants) emitToUser(id, 'conversation:updated', { conversation_id: conversation.id });

  if (lead?.assigned_to_user_id) {
    await notifications.createUserNotification({
      userId: lead.assigned_to_user_id,
      type: 'whatsapp_inbound_message',
      title: 'New WhatsApp Message from Lead',
      body: `${lead.full_name || 'Lead'} sent a new WhatsApp message.`,
      metadata: {
        event_type: 'whatsapp_inbound_message',
        lead_id: lead.id,
        conversation_id: conversation.id,
        lead_category: lead.category || 'unknown',
        campaign_name: lead.campaign_name || null,
        external_message_id: normalized.external_message_id || null,
      },
      eventType: 'whatsapp_inbound_message',
      entityType: 'chat_conversation',
      entityId: conversation.id,
      dedupeKey: `wasp_inbound:${normalized.external_message_id || message.id}:${lead.assigned_to_user_id}`,
      email: {
        subject: `New WhatsApp message from ${lead.full_name || 'Lead'}`,
        html: `<p>${lead.full_name || 'Lead'} sent a new WhatsApp message.</p><p><a href="${config.email.frontendUrl}/chat?leadId=${lead.id}">Open chat</a></p><p>This is an automated notification from DigitalADbird CRM.</p>`,
        text: `${lead.full_name || 'Lead'} sent a new WhatsApp message.\n${config.email.frontendUrl}/chat?leadId=${lead.id}`,
      },
      emailType: 'whatsapp_inbound_message',
      emailEnabled: config.wasp.inboundEmailNotifyAssignee,
    });
  } else {
    const admins = await activeAdmins({ query });
    for (const admin of admins) {
      await notifications.createUserNotification({
        userId: admin.id,
        type: 'whatsapp_external_inbound',
        title: 'New External WhatsApp Message',
        body: 'A WhatsApp message was received from an unknown contact.',
        metadata: {
          event_type: 'whatsapp_external_inbound',
          conversation_id: conversation.id,
          customer_phone: normalized.customer_phone,
          external_message_id: normalized.external_message_id || null,
        },
        eventType: 'whatsapp_external_inbound',
        entityType: 'chat_conversation',
        entityId: conversation.id,
        dedupeKey: `wasp_external:${normalized.external_message_id || message.id}:${admin.id}`,
        email: {
          subject: 'New external WhatsApp message',
          html: `<p>A WhatsApp message was received from an unknown contact.</p><p><a href="${config.email.frontendUrl}/chat?external=true">Open chat inbox</a></p><p>This is an automated notification from DigitalADbird CRM.</p>`,
          text: `A WhatsApp message was received from an unknown contact.\n${config.email.frontendUrl}/chat?external=true`,
        },
        emailType: 'whatsapp_external_inbound',
      });
    }
  }
}

async function handleInboundWaspMessage(payload) {
  const event = mapper.eventType(payload);
  if (event === 'message.status_updated') {
    return handleWaspStatusUpdate(payload);
  }
  if (event && event !== 'message.created') {
    return logNonMessageEvent(payload, event);
  }

  const normalized = mapper.normalizeInbound(payload);
  if (!normalized.customer_phone && !normalized.customer_wa_id) {
    throw Object.assign(new Error('Inbound payload missing customer phone/wa_id'), { code: 'WASP_PAYLOAD_INVALID' });
  }

  const logPayload = {
    event_type: 'message',
    external_message_id: normalized.external_message_id || null,
    external_conversation_id: normalized.external_conversation_id || null,
    customer_phone: normalized.customer_phone,
    customer_wa_id: normalized.customer_wa_id,
    payload: JSON.stringify(payload || {}),
  };

  return withTransaction(async (client) => {
    const { rows: [log] } = await client.query(
      `INSERT INTO wasp_webhook_logs(event_type, external_message_id, external_conversation_id, customer_phone, customer_wa_id, payload)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [logPayload.event_type, logPayload.external_message_id, logPayload.external_conversation_id, logPayload.customer_phone, logPayload.customer_wa_id, logPayload.payload],
    );

    if (normalized.external_message_id) {
      const { rows: [dup] } = await client.query(
        `SELECT id, conversation_id FROM chat_messages WHERE provider = 'wasp' AND external_message_id = $1 LIMIT 1`,
        [normalized.external_message_id],
      );
      if (dup) {
        await client.query(
          `UPDATE wasp_webhook_logs SET processing_status = 'duplicate', matched_conversation_id = $1 WHERE id = $2`,
          [dup.conversation_id, log.id],
        );
        return { status: 'duplicate', conversationId: dup.conversation_id };
      }
    }

    const lead = await findLead(normalized);
    if (!lead && config.wasp.createLeadFromUnknownInbound) {
      logger.warn('[Wasp] WASP_CREATE_LEAD_FROM_UNKNOWN_INBOUND ignored; CRM policy keeps unknown inbound admin-only');
    }

    const conversation = await findOrCreateConversation(client, normalized, lead);
    const inboundAt = normalized.timestamp || new Date().toISOString();
    const expiresAt = addSessionHours(inboundAt);
    await client.query(
      `UPDATE chat_conversations
          SET channel = 'whatsapp',
              provider = 'wasp',
              customer_phone = COALESCE(customer_phone, $2),
              customer_wa_id = COALESCE(customer_wa_id, $3),
              external_conversation_id = COALESCE(NULLIF(external_conversation_id, ''), $4),
              session_status = 'open',
              last_inbound_at = $5,
              session_expires_at = $6,
              updated_at = NOW()
        WHERE id = $1`,
      [conversation.id, normalized.customer_phone, normalized.customer_wa_id, normalized.external_conversation_id || null, inboundAt, expiresAt],
    );
    const { rows: [updatedConversation] } = await client.query(`SELECT * FROM chat_conversations WHERE id = $1`, [conversation.id]);

    const admins = lead ? await activeAdmins(client) : await activeAdmins(client);
    const participantIds = lead
      ? [lead.assigned_to_user_id, lead.report_to_id, ...admins.map(a => a.id)]
      : admins.map(a => a.id);
    await ensureParticipants(client, conversation.id, participantIds);

    const { rows: [message] } = await client.query(
      `INSERT INTO chat_messages(
         conversation_id, sender_id, body, message_type, metadata, channel, provider, direction,
         sender_type, external_message_id, external_conversation_id, delivery_status, provider_payload, created_at
       ) VALUES ($1,NULL,$2,$3,$4,'whatsapp','wasp','inbound','customer',$5,$6,'received',$7,$8)
       RETURNING *`,
      [
        conversation.id,
        normalized.text || '[Unsupported WhatsApp message]',
        ['text', 'image', 'audio', 'video', 'document'].includes(normalized.message_type) ? normalized.message_type : 'text',
        JSON.stringify({ customer_phone: normalized.customer_phone, customer_wa_id: normalized.customer_wa_id }),
        normalized.external_message_id || null,
        normalized.external_conversation_id || null,
        JSON.stringify(normalized.raw_payload || {}),
        inboundAt,
      ],
    );

    await client.query(
      `UPDATE wasp_webhook_logs
          SET processing_status = 'processed',
              matched_lead_id = $1,
              matched_conversation_id = $2
        WHERE id = $3`,
      [lead?.id || null, conversation.id, log.id],
    );

    setImmediate(() => {
      notifyInbound({ normalized, lead, conversation: updatedConversation, message, participants: participantIds.filter(Boolean) })
        .catch(err => logger.warn({ err: err.message, conversationId: conversation.id }, '[Wasp] inbound notification failed'));
    });
    return { status: 'processed', conversationId: conversation.id, leadId: lead?.id || null, messageId: message.id };
  });
}

async function handleWaspStatusUpdate(payload) {
  const normalized = mapper.normalizeStatusUpdate(payload);
  if (!normalized.external_message_id) {
    throw Object.assign(new Error('Status webhook missing message id'), { code: 'WASP_STATUS_PAYLOAD_INVALID' });
  }
  return withTransaction(async (client) => {
    const { rows: [log] } = await client.query(
      `INSERT INTO wasp_webhook_logs(event_type, external_message_id, external_conversation_id, customer_phone, payload)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id`,
      [normalized.event_type || 'message.status_updated', normalized.external_message_id, normalized.external_conversation_id || null, normalized.customer_phone || null, JSON.stringify(payload || {})],
    );
    const { rows: [message] } = await client.query(
      `UPDATE chat_messages
          SET delivery_status = COALESCE(NULLIF($2, ''), delivery_status),
              external_conversation_id = COALESCE(NULLIF($3, ''), external_conversation_id),
              provider_payload = COALESCE(provider_payload, '{}'::jsonb) || $4::jsonb,
              status_updated_at = NOW()
        WHERE provider = 'wasp'
          AND external_message_id = $1
        RETURNING *`,
      [
        normalized.external_message_id,
        normalized.status || null,
        normalized.external_conversation_id || null,
        JSON.stringify({ last_status_webhook: payload || {} }),
      ],
    );
    await client.query(
      `UPDATE wasp_webhook_logs
          SET processing_status = $1,
              matched_conversation_id = $2
        WHERE id = $3`,
      [message ? 'processed' : 'unmatched', message?.conversation_id || null, log.id],
    );
    if (message?.conversation_id) {
      setImmediate(() => {
        emitToConversation(message.conversation_id, 'message:delivered', {
          message_id: message.id,
          delivery_status: message.delivery_status,
          provider: 'wasp',
        });
        emitToConversation(message.conversation_id, 'message:status_updated', message);
      });
    }
    return { status: message ? 'processed' : 'unmatched', messageId: message?.id || null, conversationId: message?.conversation_id || null };
  });
}

async function logNonMessageEvent(payload, event) {
  const normalized = mapper.normalizeStatusUpdate(payload);
  const { rows: [log] } = await query(
    `INSERT INTO wasp_webhook_logs(event_type, external_message_id, external_conversation_id, customer_phone, customer_wa_id, payload, processing_status)
     VALUES ($1,$2,$3,$4,$5,$6,'ignored')
     RETURNING id`,
    [event, normalized.external_message_id || null, normalized.external_conversation_id || null, normalized.customer_phone || null, null, JSON.stringify(payload || {})],
  );
  return { status: 'ignored', event, logId: log.id };
}

module.exports = {
  handleInboundWaspMessage,
  handleWaspStatusUpdate,
  findLead,
};
