const { query, withTransaction } = require('../config/database');
const { assertLeadCommunicationAccess } = require('./leadCommunicationAccess');

async function getOrCreateLeadConversation({ leadId, user, runner = null }) {
  const exec = runner || { query };
  const lead = await assertLeadCommunicationAccess(user, leadId, exec);

  const { rows: existing } = await exec.query(
    `SELECT id FROM chat_conversations
      WHERE type = 'lead' AND lead_id = $1 AND is_deleted = FALSE
      ORDER BY
        CASE WHEN COALESCE(channel, 'internal') = 'whatsapp' THEN 0 ELSE 1 END,
        updated_at DESC NULLS LAST,
        created_at DESC
      LIMIT 1`,
    [leadId],
  );

  if (existing.length) {
    const convId = existing[0].id;
    await ensureLeadParticipants(exec, convId, lead, user);
    return { conversationId: convId, lead, existing: true };
  }

  const create = async (client) => {
    const { rows: [conversation] } = await client.query(
      `INSERT INTO chat_conversations (type, lead_id, title, created_by)
       VALUES ('lead', $1, $2, $3)
       RETURNING id`,
      [leadId, `Lead: ${lead.full_name || 'Unknown'}`, user.id],
    );
    await ensureLeadParticipants(client, conversation.id, lead, user);
    return { conversationId: conversation.id, lead, existing: false };
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
