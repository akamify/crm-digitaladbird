const { query } = require('../config/database');
const { AppError } = require('../utils/errors');

const WORKFLOW_REMARK_OPTIONS = [
  'communication_completed', 'respond_hi', 'interested', 'converted',
  'recall', 'cnr', 'so', 'cw', 'nn', 'nc', 'ni', 'in', 'cb', 'rnr', 'busy',
  'call_cut_busy',
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

function normalizeWorkflowRemarkStatuses(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const normalized = [...new Set(values
    .map(item => normalizeWorkflowRemarkStatus(item))
    .filter(Boolean))];
  if (values.length > 0 && normalized.length !== values.map(item => String(item || '').trim()).filter(Boolean).length) {
    throw new AppError(400, 'INVALID_WORKFLOW_REMARK', 'Select valid workflow remark statuses.');
  }
  return normalized;
}

function isWorkflowRemarkCompleted(value) {
  return STEP_TWO_UNLOCKING_REMARKS.has(normalizeWorkflowRemarkStatus(value));
}

function isAnyWorkflowRemarkCompleted(value) {
  return normalizeWorkflowRemarkStatuses(value).some(status => STEP_TWO_UNLOCKING_REMARKS.has(status));
}

function run(client, sql, params) {
  return client ? client.query(sql, params) : query(sql, params);
}

async function saveWorkflowRemark({ leadId, userId, remarkStatus, remarkStatuses, client, source = 'workflow' }) {
  const statuses = normalizeWorkflowRemarkStatuses(remarkStatuses || remarkStatus);
  const normalized = statuses[0] || null;
  if (!normalized) {
    throw new AppError(400, 'INVALID_WORKFLOW_REMARK', 'Select a valid workflow remark status.');
  }

  const { rows: [existing] } = await run(client,
    `SELECT remark_status, step_1_statuses FROM lead_workflow WHERE lead_id = $1 FOR UPDATE`,
    [leadId],
  );
  const previousStatuses = normalizeWorkflowRemarkStatuses(
    Array.isArray(existing?.step_1_statuses) && existing.step_1_statuses.length ? existing.step_1_statuses : existing?.remark_status,
  );
  const previous = previousStatuses.join(',');
  const nextValue = statuses.join(',');

  const { rows: [workflow] } = await run(client, `
    INSERT INTO lead_workflow (lead_id, user_id, remark_status, step_1_statuses, remark_saved_at)
    VALUES ($1, $2, $3, $4::jsonb, NOW())
    ON CONFLICT (lead_id) DO UPDATE SET
      remark_status = EXCLUDED.remark_status,
      step_1_statuses = EXCLUDED.step_1_statuses,
      remark_saved_at = NOW(),
      updated_at = NOW()
    RETURNING *
  `, [leadId, userId, normalized, JSON.stringify(statuses)]);

  if (previous !== nextValue) {
    await run(client, `
      INSERT INTO lead_workflow_history (lead_id, user_id, step, action, old_value, new_value, metadata)
      VALUES ($1, $2, 1, $3, $4, $5, $6::jsonb)
    `, [
      leadId,
      userId,
      previous ? 'remark_changed' : 'remark_saved',
      previous || null,
      nextValue,
      JSON.stringify({ source, step_1_statuses: statuses }),
    ]);
  }

  return workflow;
}

module.exports = {
  WORKFLOW_REMARK_OPTIONS,
  STEP_TWO_UNLOCKING_REMARKS,
  normalizeWorkflowRemarkStatus,
  normalizeWorkflowRemarkStatuses,
  isWorkflowRemarkCompleted,
  isAnyWorkflowRemarkCompleted,
  saveWorkflowRemark,
};
