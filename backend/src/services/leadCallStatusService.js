const { AppError } = require('../utils/errors');

const FINAL_STAGES = new Set(['won', 'lost', 'dropped']);
const FINAL_CALL_STATUSES = new Set(['converted', 'not_interested', 'wrong_number', 'invalid_number']);

const CALL_STATUS_MAP = {
  initiated: { callStatus: null, stage: null },
  ringing: { callStatus: null, stage: null },
  completed: { callStatus: 'interested', stage: 'contacted' },
  connected: { callStatus: 'interested', stage: 'contacted' },
  answered: { callStatus: 'interested', stage: 'contacted' },
  interested: { callStatus: 'interested', stage: 'qualified' },
  talk_response: { callStatus: 'talk_response', stage: 'contacted' },
  missed: { callStatus: 'rnr', stage: null },
  not_answered: { callStatus: 'rnr', stage: null },
  no_answer: { callStatus: 'rnr', stage: null },
  rnr: { callStatus: 'rnr', stage: null },
  cnr: { callStatus: 'cnr', stage: null },
  busy: { callStatus: 'busy', stage: null },
  switched_off: { callStatus: 'switched_off', stage: null },
  so: { callStatus: 'so', stage: null },
  failed: { callStatus: null, stage: null },
  cancelled: { callStatus: null, stage: null },
  callback_requested: { callStatus: 'callback_requested', stage: 'follow_up' },
  callback: { callStatus: 'callback_requested', stage: 'follow_up' },
  ccb: { callStatus: 'ccb', stage: 'follow_up' },
  follow_up: { callStatus: 'follow_up', stage: 'follow_up' },
  converted: { callStatus: 'converted', stage: 'won' },
  not_interested: { callStatus: 'not_interested', stage: 'lost' },
  ni: { callStatus: 'ni', stage: 'lost' },
  wrong_number: { callStatus: 'wrong_number', stage: 'lost' },
  invalid_number: { callStatus: 'invalid_number', stage: 'lost' },
  language_barrier: { callStatus: 'language_barrier', stage: null },
  custom_remark: { callStatus: 'custom_remark', stage: null },
};

let leadsColumnsCache = null;

function normalizeOutcome(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized || !CALL_STATUS_MAP[normalized]) {
    throw new AppError(400, 'INVALID_CALL_STATUS', 'Invalid call status.');
  }
  return normalized;
}

function resolveLeadCallStatus(status, hasFollowup) {
  const normalized = normalizeOutcome(status);
  const mapped = { ...CALL_STATUS_MAP[normalized] };
  if (hasFollowup && (!mapped.stage || !FINAL_CALL_STATUSES.has(mapped.callStatus))) {
    mapped.stage = 'follow_up';
    if (!mapped.callStatus || mapped.callStatus === 'rnr') mapped.callStatus = 'callback_requested';
  }
  return { outcome: normalized, ...mapped };
}

async function getLeadsColumns(client) {
  if (leadsColumnsCache) return leadsColumnsCache;
  const { rows } = await client.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'leads'
  `);
  leadsColumnsCache = new Set(rows.map((row) => row.column_name));
  return leadsColumnsCache;
}

function shouldUpdateStage(currentStage, nextStage) {
  if (!nextStage) return false;
  if (!currentStage) return true;
  if (!FINAL_STAGES.has(currentStage)) return true;
  return FINAL_STAGES.has(nextStage);
}

async function updateLeadFromCallLog(client, {
  leadId,
  userId,
  status,
  nextFollowupAt,
  note,
}) {
  const hasFollowup = !!nextFollowupAt;
  const mapped = resolveLeadCallStatus(status, hasFollowup);
  const columns = await getLeadsColumns(client);

  const { rows: [currentLead] } = await client.query(
    `SELECT id, stage, call_status FROM leads WHERE id = $1 FOR UPDATE`,
    [leadId],
  );
  if (!currentLead) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found');

  const updates = [];
  const params = [leadId];
  const add = (column, value) => {
    if (!columns.has(column)) return;
    params.push(value);
    updates.push(`${column} = $${params.length}`);
  };

  if (mapped.callStatus) add('call_status', mapped.callStatus);
  if (shouldUpdateStage(currentLead.stage, mapped.stage)) add('stage', mapped.stage);

  if (columns.has('last_call_at')) updates.push('last_call_at = NOW()');
  if (columns.has('call_attempts')) updates.push('call_attempts = COALESCE(call_attempts, 0) + 1');
  if (hasFollowup) add('next_followup_at', nextFollowupAt);
  add('last_call_by_user_id', userId);
  add('last_call_note', note || null);
  if (columns.has('status_updated_at') && (mapped.callStatus || mapped.stage)) {
    updates.push('status_updated_at = NOW()');
  }
  if (columns.has('stage_updated_at') && mapped.stage) {
    updates.push('stage_updated_at = NOW()');
  }
  if (columns.has('updated_at')) updates.push('updated_at = NOW()');

  if (updates.length === 0) {
    const { rows: [lead] } = await client.query(`SELECT * FROM leads WHERE id = $1`, [leadId]);
    return lead;
  }

  const { rows: [lead] } = await client.query(`
    UPDATE leads
       SET ${updates.join(', ')}
     WHERE id = $1
     RETURNING *
  `, params);

  return lead;
}

module.exports = {
  normalizeOutcome,
  resolveLeadCallStatus,
  updateLeadFromCallLog,
};
