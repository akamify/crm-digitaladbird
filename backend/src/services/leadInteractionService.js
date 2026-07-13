const { query } = require('../config/database');
const { AppError } = require('../utils/errors');
const { validateCallStatus, validateLeadStage } = require('../constants/leadStatusOptions');
const {
  normalizeWorkflowRemarkStatus,
  isWorkflowRemarkCompleted,
  saveWorkflowRemark,
} = require('./leadWorkflowRemarkService');

const callStatusEnumCache = { values: null, loadedAt: 0 };

function humanizeValue(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function buildRemarkText({ note, status, stage, nextFollowupAt }) {
  const remark = String(note || '').trim();
  if (remark) return remark;
  const parts = [];
  if (status) parts.push(`Status: ${humanizeValue(status)}`);
  if (stage) parts.push(`Stage: ${humanizeValue(stage)}`);
  if (nextFollowupAt) parts.push('Follow-up scheduled');
  return parts.length ? parts.join(' | ') : 'Lead activity updated';
}

async function getDbCallStatusValues(client) {
  const now = Date.now();
  if (callStatusEnumCache.values && now - callStatusEnumCache.loadedAt < 5 * 60 * 1000) {
    return callStatusEnumCache.values;
  }
  const runner = client || { query };
  const { rows } = await runner.query(
    `SELECT enumlabel FROM pg_enum WHERE enumtypid = 'call_status'::regtype`,
  );
  callStatusEnumCache.values = new Set(rows.map(row => row.enumlabel));
  callStatusEnumCache.loadedAt = now;
  return callStatusEnumCache.values;
}

async function toDbCallStatus(client, status) {
  if (!status) return null;
  const allowed = await getDbCallStatusValues(client);
  if (allowed.has(status)) return status;
  const fallbackMap = {
    communication_completed: 'interested',
    respond_hi: 'interested',
    talk_response: 'interested',
    recall: 'callback_requested',
    cb: 'busy',
    in: 'invalid_number',
    session_730_attend: 'follow_up',
    session_after_730: 'follow_up',
    yes_after_730_session: 'follow_up',
    custom_remark: null,
  };
  const fallback = Object.prototype.hasOwnProperty.call(fallbackMap, status) ? fallbackMap[status] : null;
  return fallback && allowed.has(fallback) ? fallback : null;
}

async function assertLeadWriteAccess(client, leadId, user) {
  const { rows: [lead] } = await client.query(
    `SELECT l.id, l.assigned_to_user_id, assigned_user.report_to_id AS assigned_user_rm_id
       FROM leads l
       LEFT JOIN users assigned_user ON assigned_user.id = l.assigned_to_user_id
      WHERE l.id = $1 AND l.deleted_at IS NULL`,
    [leadId],
  );
  if (!lead) throw new AppError(404, 'NOT_FOUND', 'Lead not found');
  if (user.role === 'super_admin' || user.role === 'admin') return lead;
  if ((user.role === 'member' || user.role === 'partner') && lead.assigned_to_user_id === user.id) return lead;
  if (user.role === 'rm' && lead.assigned_user_rm_id === user.id) return lead;
  throw new AppError(403, 'REASSIGNED_LEAD_READ_ONLY', 'This lead has been reassigned. You can view it, but cannot edit it.');
}

function validateInteractionInput({ status, stage }) {
  const normalizedStatus = status ? validateCallStatus(status) : '';
  const normalizedStage = stage ? validateLeadStage(stage) : '';
  if ((status && normalizedStatus === null) || (stage && normalizedStage === null)) {
    throw new AppError(400, 'INVALID_LEAD_STATUS_VALUE', 'Invalid status value. Please select one of the available CRM statuses.');
  }
  return { normalizedStatus, normalizedStage };
}

async function createLeadInteraction({
  client,
  user,
  leadId,
  note,
  status,
  stage,
  nextFollowupAt,
  source = 'manual',
  workflowStep = null,
  syncWorkflowStep1 = false,
  releaseLock = true,
}) {
  const { normalizedStatus, normalizedStage } = validateInteractionInput({ status, stage });
  const dbCallStatus = await toDbCallStatus(client, normalizedStatus);
  await assertLeadWriteAccess(client, leadId, user);
  await client.query(`SELECT id FROM leads WHERE id = $1 FOR UPDATE`, [leadId]);

  const remarkText = buildRemarkText({
    note,
    status: normalizedStatus,
    stage: normalizedStage,
    nextFollowupAt,
  });
  const workflowStatus = normalizeWorkflowRemarkStatus(normalizedStatus);
  const completed = isWorkflowRemarkCompleted(workflowStatus);

  const { rows: [remark] } = await client.query(
    `INSERT INTO lead_remarks(
       lead_id, user_id, remark, call_status, stage, next_followup_at,
       source, workflow_step, is_completed_response
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      leadId,
      user.id,
      remarkText,
      dbCallStatus,
      normalizedStage || null,
      nextFollowupAt || null,
      source,
      workflowStep,
      completed,
    ],
  );

  let workflow = null;
  if (syncWorkflowStep1 && workflowStatus) {
    workflow = await saveWorkflowRemark({
      leadId,
      userId: user.id,
      remarkStatus: workflowStatus,
      client,
      source,
    });
  }

  const updates = ['updated_at = NOW()'];
  const params = [leadId];
  if (dbCallStatus) {
    params.push(dbCallStatus);
    updates.push(`call_status = $${params.length}`);
    updates.push('last_call_at = NOW()');
    updates.push('call_attempts = call_attempts + 1');
  } else if (normalizedStatus) {
    updates.push('last_call_at = NOW()');
    updates.push('call_attempts = call_attempts + 1');
  }
  if (nextFollowupAt) {
    params.push(nextFollowupAt);
    updates.push(`next_followup_at = $${params.length}`);
  }
  if (normalizedStage) {
    params.push(normalizedStage);
    updates.push(`stage = $${params.length}`);
  }
  if (releaseLock !== false) updates.push('locked_by_user_id = NULL', 'locked_until = NULL');
  await client.query(`UPDATE leads SET ${updates.join(', ')} WHERE id = $1`, params);

  return {
    remark,
    workflow,
    normalizedStatus,
    normalizedStage,
    dbCallStatus,
    isCompletedResponse: completed,
  };
}

module.exports = {
  assertLeadWriteAccess,
  buildRemarkText,
  createLeadInteraction,
  validateInteractionInput,
};
