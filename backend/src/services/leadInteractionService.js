const { query } = require('../config/database');
const { AppError } = require('../utils/errors');
const {
  validateCallStatus,
  validateLeadStage,
  validateLeadRemarkNoteType,
  validateLeadRemarkCategory,
  validateLeadRemarkPriority,
  validateLeadRemarkCustomerInterest,
} = require('../constants/leadStatusOptions');
const {
  normalizeWorkflowRemarkStatus,
  normalizeWorkflowRemarkStatuses,
  isWorkflowRemarkCompleted,
  isAnyWorkflowRemarkCompleted,
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
    call_cut_busy: 'busy',
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

function normalizeOptionalText(value, maxLength) {
  const text = String(value || '').trim();
  if (!text) return null;
  return maxLength ? text.slice(0, maxLength) : text;
}

function normalizeStructuredRemarkMeta({ noteType, category, title, priority, customerInterest }) {
  const normalizedNoteType = noteType ? validateLeadRemarkNoteType(noteType) : 'general';
  const normalizedCategory = category ? validateLeadRemarkCategory(category) : '';
  const normalizedPriority = priority ? validateLeadRemarkPriority(priority) : '';
  const normalizedCustomerInterest = customerInterest ? validateLeadRemarkCustomerInterest(customerInterest) : '';

  if ((noteType && normalizedNoteType === null)
    || (category && normalizedCategory === null)
    || (priority && normalizedPriority === null)
    || (customerInterest && normalizedCustomerInterest === null)) {
    throw new AppError(400, 'INVALID_REMARK_METADATA', 'Invalid structured remark value. Please select one of the available CRM options.');
  }

  return {
    normalizedNoteType: normalizedNoteType || 'general',
    normalizedCategory: normalizedCategory || null,
    normalizedTitle: normalizeOptionalText(title, 255),
    normalizedPriority: normalizedPriority || null,
    normalizedCustomerInterest: normalizedCustomerInterest || null,
  };
}

function assertStructuredRemarkPermission(user, normalizedNoteType) {
  if (!normalizedNoteType) return;
  if (user.role === 'member' || user.role === 'partner') {
    if (!['general', 'counselor_update'].includes(normalizedNoteType)) {
      throw new AppError(403, 'FORBIDDEN_NOTE_TYPE', 'Members can only add general or counselor updates.');
    }
    return;
  }
  if (user.role === 'rm' && normalizedNoteType !== 'rm_update') {
    throw new AppError(403, 'FORBIDDEN_NOTE_TYPE', 'RM users can only add RM updates from this workflow.');
  }
}

function validateInteractionInput({ status, stage }) {
  const normalizedStatus = status ? validateCallStatus(status) : '';
  const normalizedStage = stage ? validateLeadStage(stage) : '';
  if ((status && normalizedStatus === null) || (stage && normalizedStage === null)) {
    throw new AppError(400, 'INVALID_LEAD_STATUS_VALUE', 'Invalid status value. Please select one of the available CRM statuses.');
  }
  return { normalizedStatus, normalizedStage };
}

function normalizeInteractionStatuses(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const normalized = [...new Set(values.map(item => validateCallStatus(item)).filter(Boolean))];
  if (values.length > 0 && normalized.length !== values.map(item => String(item || '').trim()).filter(Boolean).length) {
    throw new AppError(400, 'INVALID_LEAD_STATUS_VALUE', 'Invalid status value. Please select one of the available CRM statuses.');
  }
  return normalized;
}

function isLeadRemarkSchemaCompatibilityError(error) {
  if (!error) return false;
  return ['42703', '42704', '42P01'].includes(error.code);
}

async function insertLeadRemarkRecord(client, {
  leadId,
  userId,
  remarkText,
  dbCallStatus,
  normalizedStage,
  nextFollowupAt,
  source,
  workflowStep,
  completed,
  normalizedStatuses,
  normalizedNoteType,
  normalizedCategory,
  normalizedTitle,
  normalizedPriority,
  normalizedCustomerInterest,
  nextFollowup,
}) {
  const attempts = [
    {
      sql: `INSERT INTO lead_remarks(
         lead_id, user_id, remark, call_status, stage, next_followup_at,
         source, workflow_step, is_completed_response, call_statuses,
         note_type, category, title, priority, customer_interest, next_followup
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      params: [
        leadId,
        userId,
        remarkText,
        dbCallStatus,
        normalizedStage || null,
        nextFollowupAt || null,
        source,
        workflowStep,
        completed,
        JSON.stringify(normalizedStatuses),
        normalizedNoteType,
        normalizedCategory,
        normalizedTitle,
        normalizedPriority,
        normalizedCustomerInterest,
        nextFollowup || nextFollowupAt || null,
      ],
    },
    {
      sql: `INSERT INTO lead_remarks(
         lead_id, user_id, remark, call_status, stage, next_followup_at,
         source, workflow_step, is_completed_response, call_statuses
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       RETURNING *`,
      params: [
        leadId,
        userId,
        remarkText,
        dbCallStatus,
        normalizedStage || null,
        nextFollowupAt || null,
        source,
        workflowStep,
        completed,
        JSON.stringify(normalizedStatuses),
      ],
    },
    {
      sql: `INSERT INTO lead_remarks(
         lead_id, user_id, remark, call_status, next_followup_at
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      params: [
        leadId,
        userId,
        remarkText,
        dbCallStatus,
        nextFollowupAt || null,
      ],
    },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const { rows } = await client.query(attempt.sql, attempt.params);
      const row = rows[0] || {};
      return {
        ...row,
        lead_id: row.lead_id || leadId,
        user_id: row.user_id || userId,
        remark: row.remark ?? remarkText,
        call_status: row.call_status ?? dbCallStatus ?? null,
        stage: row.stage ?? normalizedStage ?? null,
        next_followup_at: row.next_followup_at ?? nextFollowupAt ?? null,
        source: row.source ?? source,
        workflow_step: row.workflow_step ?? workflowStep ?? null,
        is_completed_response: typeof row.is_completed_response === 'boolean' ? row.is_completed_response : completed,
        call_statuses: row.call_statuses ?? normalizedStatuses,
        note_type: row.note_type ?? normalizedNoteType,
        category: row.category ?? normalizedCategory,
        title: row.title ?? normalizedTitle,
        priority: row.priority ?? normalizedPriority,
        customer_interest: row.customer_interest ?? normalizedCustomerInterest,
        next_followup: row.next_followup ?? nextFollowup ?? nextFollowupAt ?? null,
      };
    } catch (error) {
      lastError = error;
      if (!isLeadRemarkSchemaCompatibilityError(error)) throw error;
    }
  }

  throw lastError;
}

async function createLeadInteraction({
  client,
  user,
  leadId,
  note,
  status,
  statuses,
  stage,
  nextFollowupAt,
  source = 'manual',
  workflowStep = null,
  syncWorkflowStep1 = false,
  releaseLock = true,
  noteType = 'general',
  category = null,
  title = null,
  priority = null,
  customerInterest = null,
  nextFollowup = null,
}) {
  const normalizedStatuses = normalizeInteractionStatuses(statuses || status);
  const normalizedStatus = normalizedStatuses[0] || '';
  const { normalizedStage } = validateInteractionInput({ status: normalizedStatus, stage });
  const {
    normalizedNoteType,
    normalizedCategory,
    normalizedTitle,
    normalizedPriority,
    normalizedCustomerInterest,
  } = normalizeStructuredRemarkMeta({ noteType, category, title, priority, customerInterest });
  assertStructuredRemarkPermission(user, normalizedNoteType);
  const dbCallStatus = await toDbCallStatus(client, normalizedStatus);
  await assertLeadWriteAccess(client, leadId, user);
  await client.query(`SELECT id FROM leads WHERE id = $1 FOR UPDATE`, [leadId]);

  const remarkText = buildRemarkText({
    note,
    status: normalizedStatus,
    stage: normalizedStage,
    nextFollowupAt,
  });
  const workflowStatuses = normalizeWorkflowRemarkStatuses(normalizedStatuses);
  const workflowStatus = workflowStatuses[0] || normalizeWorkflowRemarkStatus(normalizedStatus);
  const completed = isAnyWorkflowRemarkCompleted(workflowStatuses.length ? workflowStatuses : workflowStatus);

  const remark = await insertLeadRemarkRecord(client, {
    leadId,
    userId: user.id,
    remarkText,
    dbCallStatus,
    normalizedStage,
    nextFollowupAt,
    source,
    workflowStep,
    completed,
    normalizedStatuses,
    normalizedNoteType,
    normalizedCategory,
    normalizedTitle,
    normalizedPriority,
    normalizedCustomerInterest,
    nextFollowup,
  });

  let workflow = null;
  if (syncWorkflowStep1 && workflowStatus) {
    workflow = await saveWorkflowRemark({
      leadId,
      userId: user.id,
      remarkStatus: workflowStatus,
      remarkStatuses: workflowStatuses.length ? workflowStatuses : [workflowStatus],
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
  } else if (nextFollowup) {
    params.push(nextFollowup);
    updates.push(`next_followup_at = $${params.length}`);
  }
  if (normalizedStage) {
    params.push(normalizedStage);
    updates.push(`stage = $${params.length}`);
  }
  if (releaseLock !== false) updates.push('locked_by_user_id = NULL', 'locked_until = NULL');
  await client.query(`UPDATE leads SET ${updates.join(', ')} WHERE id = $1`, params);

  return {
    remark: {
      ...remark,
      created_by: user.id,
      author_name: user.full_name || user.name || 'CRM user',
      by_name: user.full_name || user.name || 'CRM user',
      author_role: user.role,
      note: remark.remark,
    },
    workflow,
    normalizedStatus,
    normalizedStatuses,
    normalizedStage,
    dbCallStatus,
    isCompletedResponse: completed,
    normalizedNoteType,
  };
}

module.exports = {
  assertLeadWriteAccess,
  buildRemarkText,
  createLeadInteraction,
  validateInteractionInput,
};
