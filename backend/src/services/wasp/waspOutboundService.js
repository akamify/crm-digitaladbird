const { query } = require('../../config/database');
const { AppError } = require('../../utils/errors');
const client = require('./waspChatClient');
const { getChatSessionState } = require('../chat/chatSessionService');
const { emitToConversation } = require('../socketService');

async function loadConversation(conversationId) {
  const { rows: [conversation] } = await query(
    `SELECT c.*, l.assigned_to_user_id, au.report_to_id AS assigned_user_rm_id,
            l.full_name AS lead_name, l.phone AS lead_phone
       FROM chat_conversations c
       LEFT JOIN leads l ON l.id = c.lead_id AND l.deleted_at IS NULL
       LEFT JOIN users au ON au.id = l.assigned_to_user_id
      WHERE c.id = $1 AND c.is_deleted = FALSE`,
    [conversationId],
  );
  return conversation || null;
}

function assertAccess(user, conversation) {
  if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
  if (conversation.is_external_unknown) {
    if (user.role === 'super_admin' || user.role === 'admin') return;
    throw new AppError(403, 'ADMIN_ONLY_EXTERNAL_CHAT', 'This conversation is not linked to a lead and can be handled only by admin.');
  }
  if (user.role === 'super_admin' || user.role === 'admin') return;
  if ((user.role === 'member' || user.role === 'partner') && conversation.assigned_to_user_id === user.id) return;
  if (user.role === 'rm' && conversation.assigned_user_rm_id === user.id) return;
  throw new AppError(403, 'CHAT_ACCESS_FORBIDDEN', 'You do not have access to this conversation.');
}

async function sendWaspTextMessage({ conversationId, user, text }) {
  const body = String(text || '').trim();
  if (!body) throw new AppError(400, 'EMPTY_MESSAGE', 'Message body is required');
  const conversation = await loadConversation(conversationId);
  assertAccess(user, conversation);
  const session = getChatSessionState(conversation);
  if (!session.can_send_whatsapp) {
    throw new AppError(400, session.status === 'expired' ? 'CHAT_SESSION_EXPIRED' : 'CHAT_SESSION_NOT_OPEN', session.disabled_reason || 'WhatsApp chat window is not open.');
  }

  const { rows: [message] } = await query(
    `INSERT INTO chat_messages(
       conversation_id, sender_id, body, message_type, channel, provider, direction, sender_type,
       external_conversation_id, delivery_status, metadata
     ) VALUES ($1,$2,$3,'text','whatsapp','wasp','outbound','user',$4,'queued',$5)
     RETURNING *`,
    [
      conversationId,
      user.id,
      body,
      conversation.external_conversation_id || null,
      JSON.stringify({ crm_user_id: user.id }),
    ],
  );

  try {
    const sent = await client.sendTextMessage({
      to: conversation.customer_phone || conversation.lead_phone,
      waId: conversation.customer_wa_id,
      text: body,
      contact: {
        name: conversation.lead_name || undefined,
        tags: ['crm', 'digitaladbird'],
        attributes: {
          crm_conversation_id: conversationId,
          crm_lead_id: conversation.lead_id || undefined,
          crm_owner_id: conversation.assigned_to_user_id || undefined,
        },
      },
      metadata: {
        lead_id: conversation.lead_id,
        conversation_id: conversationId,
        message_id: message.id,
      },
    });
    const { rows: [updated] } = await query(
      `UPDATE chat_messages
          SET external_message_id = $2,
              external_conversation_id = COALESCE($3, external_conversation_id),
              delivery_status = $4,
              provider_payload = $5,
              status_updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [message.id, sent.external_message_id || null, sent.external_conversation_id || null, sent.status || 'sent', JSON.stringify(sent.raw_response || {})],
    );
    await query(
      `UPDATE chat_conversations
          SET external_conversation_id = COALESCE($2, external_conversation_id),
              last_outbound_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [conversationId, sent.external_conversation_id || null],
    );
    emitToConversation(conversationId, 'chat:message:new', {
      conversation_id: conversationId,
      lead_id: conversation.lead_id,
      direction: 'outbound',
      channel: 'whatsapp',
      provider: 'wasp',
      message: updated,
      session,
      play_sound: false,
    });
    emitToConversation(conversationId, 'message:new', updated);
    return { message: updated, session };
  } catch (err) {
    const { rows: [failed] } = await query(
      `UPDATE chat_messages
          SET delivery_status = 'failed',
              delivery_error = $2,
              status_updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [message.id, String(err.message || 'WaspAkamify send failed').slice(0, 500)],
    );
    emitToConversation(conversationId, 'message:new', failed);
    throw err;
  }
}

module.exports = {
  sendWaspTextMessage,
  loadConversation,
};
