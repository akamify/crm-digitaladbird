const { query, withTransaction } = require('../config/database');
const { assertLeadCommunicationAccess } = require('./leadCommunicationAccess');

const LEAD_CONVERSATION_COLUMNS = `
  id, type, title, lead_id, created_by, is_pinned, is_archived, is_deleted,
  channel, provider, customer_phone, customer_wa_id, external_conversation_id,
  session_status, last_inbound_at, last_outbound_at, session_expires_at,
  is_external_unknown, provider_metadata, created_at, updated_at
`;

function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function phoneMatchVariants(value) {
  const raw = phoneDigits(value);
  if (!raw) return [];
  const variants = new Set([raw]);
  if (raw.length === 10) variants.add(`91${raw}`);
  if (raw.startsWith('91') && raw.length === 12) variants.add(raw.slice(2));
  return [...variants];
}

async function getOrCreateLeadConversation({ leadId, user, runner = null }) {
  const exec = runner || { query };
  const lead = await assertLeadCommunicationAccess(user, leadId, exec);

  const { rows: existing } = await exec.query(
    `SELECT ${LEAD_CONVERSATION_COLUMNS}
       FROM chat_conversations
      WHERE type = 'lead' AND lead_id = $1 AND is_deleted = FALSE
      ORDER BY
        CASE WHEN COALESCE(channel, 'internal') = 'whatsapp' THEN 0 ELSE 1 END,
        CASE WHEN COALESCE(session_status, 'closed') = 'open' AND session_expires_at > NOW() THEN 0 ELSE 1 END,
        updated_at DESC NULLS LAST,
        created_at DESC
      LIMIT 1`,
    [leadId],
  );

  if (existing.length) {
    const conversation = existing[0];
    await ensureLeadParticipants(exec, conversation.id, lead, user);
    return { conversationId: conversation.id, conversation, lead, existing: true };
  }

  const phoneVariants = phoneMatchVariants(lead.phone);
  if (phoneVariants.length) {
    const { rows: externalMatches } = await exec.query(
      `UPDATE chat_conversations
          SET type = 'lead',
              lead_id = $1,
              title = $2,
              is_external_unknown = FALSE,
              updated_at = NOW()
        WHERE id = (
          SELECT id
            FROM chat_conversations
           WHERE is_deleted = FALSE
             AND channel = 'whatsapp'
             AND provider = 'wasp'
             AND lead_id IS NULL
             AND (
               regexp_replace(COALESCE(customer_phone, ''), '\\D', '', 'g') = ANY($3::text[])
               OR regexp_replace(COALESCE(customer_wa_id, ''), '\\D', '', 'g') = ANY($3::text[])
             )
           ORDER BY
             CASE WHEN COALESCE(session_status, 'closed') = 'open' AND session_expires_at > NOW() THEN 0 ELSE 1 END,
             updated_at DESC NULLS LAST,
             created_at DESC
           LIMIT 1
        )
        RETURNING ${LEAD_CONVERSATION_COLUMNS}`,
      [leadId, `WhatsApp: ${lead.full_name || lead.phone || 'Lead'}`, phoneVariants],
    );

    if (externalMatches.length) {
      const conversation = externalMatches[0];
      await ensureLeadParticipants(exec, conversation.id, lead, user);
      return { conversationId: conversation.id, conversation, lead, existing: true, adoptedExternal: true };
    }
  }

  const create = async (client) => {
    const { rows: [conversation] } = await client.query(
      `INSERT INTO chat_conversations (type, lead_id, title, created_by)
       VALUES ('lead', $1, $2, $3)
       RETURNING ${LEAD_CONVERSATION_COLUMNS}`,
      [leadId, `Lead: ${lead.full_name || 'Unknown'}`, user.id],
    );
    await ensureLeadParticipants(client, conversation.id, lead, user);
    return { conversationId: conversation.id, conversation, lead, existing: false };
  };

  return runner ? create(exec) : withTransaction(create);
}

async function ensureLeadParticipants(runner, conversationId, lead, actor) {
  const participantIds = new Set();
  if (lead.assigned_to_user_id) participantIds.add(lead.assigned_to_user_id);
  if (actor?.id) participantIds.add(actor.id);

  for (const userId of participantIds) {
    await runner.query(
      `INSERT INTO chat_participants (conversation_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [conversationId, userId],
    );
  }
}

async function insertLeadSystemMessage(runner, conversationId, senderId, body, metadata = {}) {
  const { rows: [message] } = await runner.query(
    `INSERT INTO chat_messages (conversation_id, sender_id, body, message_type, metadata)
     VALUES ($1, $2, $3, 'system', $4)
     RETURNING *`,
    [conversationId, senderId, body, JSON.stringify(metadata)],
  );
  await runner.query(`UPDATE chat_conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);
  return message;
}

module.exports = {
  getOrCreateLeadConversation,
  insertLeadSystemMessage,
  ensureLeadParticipants,
};
