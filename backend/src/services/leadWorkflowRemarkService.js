const { query } = require('../config/database');
const { AppError } = require('../utils/errors');

const WORKFLOW_REMARK_OPTIONS = [
  'communication_completed', 'respond_hi', 'interested', 'converted',
  'recall', 'cnr', 'so', 'cw', 'nn', 'nc', 'ni', 'in', 'cb', 'rnr', 'busy',
  'session_730_attend', 'yes_after_730_session',
  'not_interested', 'callback_requested', 'follow_up', 'custom_remark',
];

const STEP_TWO_UNLOCKING_REMARKS = new Set([
  'communication_completed',
  'respond_hi',
  'session_730_attend',
  'yes_after_730_session',
]);

const REMARK_ALIASES = {
  session_after_730: 'yes_after_730_session',
};

function normalizeWorkflowRemarkStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const canonical = REMARK_ALIASES[normalized] || normalized;
  return WORKFLOW_REMARK_OPTIONS.includes(canonical) ? canonical : null;
}

function isWorkflowRemarkCompleted(value) {
  return STEP_TWO_UNLOCKING_REMARKS.has(normalizeWorkflowRemarkStatus(value));
}

function run(client, sql, params) {
  return client ? client.query(sql, params) : query(sql, params);
}

async function saveWorkflowRemark({ leadId, userId, remarkStatus, client, source = 'workflow' }) {
  const normalized = normalizeWorkflowRemarkStatus(remarkStatus);
  if (!normalized) {
    throw new AppError(400, 'INVALID_WORKFLOW_REMARK', 'Select a valid workflow remark status.');
  }

  const { rows: [existing] } = await run(client,
    `SELECT remark_status FROM lead_workflow WHERE lead_id = $1 FOR UPDATE`,
    [leadId],
  );
  const previous = existing?.remark_status || null;

  if (isWorkflowRemarkCompleted(previous) && previous !== normalized) {
    throw new AppError(409, 'WORKFLOW_REMARK_LOCKED', 'This completed remark is locked and cannot be changed.');
  }

  const { rows: [workflow] } = await run(client, `
    INSERT INTO lead_workflow (lead_id, user_id, remark_status, remark_saved_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (lead_id) DO UPDATE SET
      remark_status = EXCLUDED.remark_status,
      remark_saved_at = NOW(),
      updated_at = NOW()
    RETURNING *
  `, [leadId, userId, normalized]);

  if (previous !== normalized) {
    await run(client, `
      INSERT INTO lead_workflow_history (lead_id, user_id, step, action, old_value, new_value, metadata)
      VALUES ($1, $2, 1, $3, $4, $5, $6::jsonb)
    `, [
      leadId,
      userId,
      previous ? 'remark_changed' : 'remark_saved',
      previous,
      normalized,
      JSON.stringify({ source }),
    ]);
  }

  return workflow;
}

module.exports = {
  WORKFLOW_REMARK_OPTIONS,
  STEP_TWO_UNLOCKING_REMARKS,
  normalizeWorkflowRemarkStatus,
  isWorkflowRemarkCompleted,
  saveWorkflowRemark,
};
