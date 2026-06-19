const { query, withTransaction } = require('../config/database');
const { AppError } = require('../utils/errors');
const { emitToConversation } = require('./socketService');
const { assertLeadCommunicationAccess } = require('./leadCommunicationAccess');
const { getOrCreateLeadConversation, insertLeadSystemMessage } = require('./leadConversationService');
const { getCallProvider, getCallProviderMode } = require('./callProvider');

const VALID_LOG_STATUSES = new Set(['initiated', 'ringing', 'connected', 'completed', 'failed', 'missed', 'cancelled']);

async function listLeadCalls({ leadId, user }) {
  await assertLeadCommunicationAccess(user, leadId);
  const { rows } = await query(`
    SELECT c.*, u.full_name AS user_name, u.role AS user_role
      FROM lead_call_logs c
      JOIN users u ON u.id = c.user_id
     WHERE c.lead_id = $1
     ORDER BY c.created_at DESC
     LIMIT 100
  `, [leadId]);
  return rows;
}

async function startLeadCall({ leadId, user }) {
  const providerMode = getCallProviderMode();
  const provider = getCallProvider();

  return withTransaction(async (client) => {
    const lead = await assertLeadCommunicationAccess(user, leadId, client);
    if (!lead.phone) throw new AppError(400, 'LEAD_PHONE_REQUIRED', 'Lead phone number is required to start a call');

    const { rows: [call] } = await client.query(`
      INSERT INTO lead_call_logs(lead_id, user_id, provider, status, started_at)
      VALUES ($1, $2, $3, 'initiated', NOW())
      RETURNING *
    `, [leadId, user.id, providerMode]);

    let providerResult;
    try {
      providerResult = await provider.initiateLeadCall({ lead, user, call });
    } catch (err) {
      await client.query(
        `UPDATE lead_call_logs
            SET status = 'failed', failure_reason = $1, updated_at = NOW()
          WHERE id = $2`,
        [err.message, call.id],
      );
      throw err;
    }

    const nextStatus = normalizeCallStatus(providerResult?.status || 'initiated');
    const { rows: [updated] } = await client.query(`
      UPDATE lead_call_logs
         SET provider_call_id = $1,
             status = $2,
             updated_at = NOW()
       WHERE id = $3
       RETURNING *
    `, [providerResult?.providerCallId || null, nextStatus, call.id]);

    const { conversationId } = await getOrCreateLeadConversation({ leadId, user, runner: client });
    const systemMessage = await insertLeadSystemMessage(
      client,
      conversationId,
      user.id,
      `Call initiated by ${user.full_name || 'user'}.`,
      { lead_call_log_id: updated.id, status: updated.status, provider: providerMode },
    );

    emitToConversation(conversationId, 'message:new', {
      ...systemMessage,
      sender_name: user.full_name,
      sender_role: user.role,
      attachments: [],
      reactions: [],
      is_starred: false,
    });
    emitToConversation(conversationId, 'lead:call:created', updated);

    return { call: updated, providerMode, conversationId };
  });
}

async function logLeadCall({ leadId, user, input }) {
  const status = normalizeCallStatus(input.status || 'completed');
  const duration = input.duration_seconds === undefined || input.duration_seconds === null || input.duration_seconds === ''
    ? null
    : Math.max(0, Number.parseInt(input.duration_seconds, 10) || 0);
  const notes = String(input.notes || input.note || '').trim() || null;

  return withTransaction(async (client) => {
    await assertLeadCommunicationAccess(user, leadId, client);

    const { rows: [call] } = await client.query(`
      INSERT INTO lead_call_logs(
        lead_id, user_id, provider, provider_call_id, direction, status,
        started_at, ended_at, duration_seconds, recording_url, notes, failure_reason
      )
      VALUES ($1, $2, $3, $4, COALESCE($5, 'outbound'), $6,
              COALESCE($7::timestamptz, NOW()), COALESCE($8::timestamptz, NOW()),
              $9, $10, $11, $12)
      RETURNING *
    `, [
      leadId,
      user.id,
      input.provider || getCallProviderMode(),
      input.provider_call_id || null,
      input.direction || 'outbound',
      status,
      input.started_at || null,
      input.ended_at || null,
      duration,
      input.recording_url || null,
      notes,
      input.failure_reason || null,
    ]);

    await client.query(`
      INSERT INTO lead_remarks(lead_id, user_id, remark, call_status, next_followup_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      leadId,
      user.id,
      notes || `Call logged: ${status}`,
      mapCallStatusToLeadStatus(status),
      input.next_followup_at || null,
    ]);

    await client.query(`
      UPDATE leads
         SET last_call_at = NOW(),
             call_attempts = call_attempts + 1,
             call_status = COALESCE($2, call_status),
             next_followup_at = COALESCE($3, next_followup_at),
             updated_at = NOW()
       WHERE id = $1
    `, [leadId, mapCallStatusToLeadStatus(status), input.next_followup_at || null]);

    const { conversationId } = await getOrCreateLeadConversation({ leadId, user, runner: client });
    const text = notes ? `Call completed: ${status}. Notes: ${notes}` : `Call completed: ${status}.`;
    const systemMessage = await insertLeadSystemMessage(
      client,
      conversationId,
      user.id,
      text,
      { lead_call_log_id: call.id, status },
    );

    emitToConversation(conversationId, 'message:new', {
      ...systemMessage,
      sender_name: user.full_name,
      sender_role: user.role,
      attachments: [],
      reactions: [],
      is_starred: false,
    });
    emitToConversation(conversationId, 'lead:call:updated', call);

    return { call, conversationId };
  });
}

function normalizeCallStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (!VALID_LOG_STATUSES.has(normalized)) {
    throw new AppError(400, 'INVALID_CALL_STATUS', 'Invalid call status');
  }
  return normalized;
}

function mapCallStatusToLeadStatus(status) {
  if (status === 'connected' || status === 'completed') return 'interested';
  if (status === 'missed') return 'rnr';
  if (status === 'failed' || status === 'cancelled') return 'not_called';
  return null;
}

module.exports = {
  listLeadCalls,
  startLeadCall,
  logLeadCall,
};
