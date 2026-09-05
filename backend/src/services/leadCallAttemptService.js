const { query } = require('../config/database');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');
const { logActivity } = require('../utils/auditLog');
const { createLeadInteraction } = require('./leadInteractionService');
const { saveWorkflowRemark } = require('./leadWorkflowRemarkService');

const BUSINESS_TIMEZONE = process.env.PROCESS_TZ || 'Asia/Kolkata';
const BUSINESS_HOURS = { startHour: 9, startMinute: 0, endHour: 19, endMinute: 0 };
const GRACE_MINUTES = 30;
const MAX_ATTEMPTS_PER_SEQUENCE = 4;
const FINAL_RECOVERY_DELAY_DAYS = 10;
const BUSINESS_OFFSET_MINUTES = 330;
const CALL_ATTEMPT_MONITORING_WINDOW_HOURS = Number(process.env.CALL_ATTEMPT_MONITORING_HOURS || 48);

const RETRYABLE_WORKFLOW_STATUSES = new Set([
  'cnr',
  'recall',
  'busy',
  'cb',
  'rnr',
  'cw',
  'nn',
  'so',
  'nc',
  'call_cut_busy',
]);
const CALL_ISSUE_WORKFLOW_STATUSES = new Set([
  ...RETRYABLE_WORKFLOW_STATUSES,
  'ni',
  'in',
]);

const ATTEMPT_OUTCOME_ALIASES = {
  cr: 'call_received',
  call_received: 'call_received',
  received: 'call_received',
  cnr: 'cnr',
  recall: 'recall',
  busy: 'busy',
  cb: 'cb',
  rnr: 'rnr',
  cw: 'cw',
  nn: 'nn',
  so: 'so',
  nc: 'nc',
  call_cut_busy: 'call_cut_busy',
  call_cut: 'call_cut_busy',
  call_cut_busy_issue: 'call_cut_busy',
  in: 'in',
  invalid_number: 'in',
  invalid_number_issue: 'in',
  not_interested: 'not_interested',
  callback_requested: 'callback_requested',
  follow_up: 'follow_up',
};

const RETRY_POLICY_DEFAULTS = {
  recall: { label: 'Recall', retryDelayMinutes: 180 },
  cnr: { label: 'CNR', retryDelayMinutes: 180 },
  busy: { label: 'Busy', retryDelayMinutes: 30 },
  cb: { label: 'Call Busy', retryDelayMinutes: 30 },
  cw: { label: 'Call Waiting', retryDelayMinutes: 30 },
  call_cut_busy: { label: 'Call Cut / Busy', retryDelayMinutes: 45 },
  rnr: { label: 'Ringing No Response', retryDelayMinutes: 150 },
  nn: { label: 'No Network', retryDelayMinutes: 120 },
  so: { label: 'Switch Off', retryDelayMinutes: 180 },
  nc: { label: 'Not Connected', retryDelayMinutes: 120 },
};

const SEQUENCE_CANCELLING_WORKFLOW_STATUSES = new Set([
  'communication_completed',
  'respond_hi',
  'session_730_attend',
  'yes_after_730_session',
  'interested',
  'converted',
  'not_interested',
  'callback_requested',
  'follow_up',
  'in',
  'ni',
]);

const SEQUENCE_CANCELLING_CALL_STATUSES = new Set([
  'communication_completed',
  'respond_hi',
  'interested',
  'converted',
  'not_interested',
  'callback_requested',
  'follow_up',
  'invalid_number',
  'in',
  'wrong_number',
  'language_barrier',
  'session_730_attend',
  'yes_after_730_session',
]);

function run(client, sql, params) {
  return client ? client.query(sql, params) : query(sql, params);
}

function shouldEmitCallAttemptMonitoring(now = new Date()) {
  if (String(process.env.CALL_ATTEMPT_MONITORING_ENABLED || '').trim().toLowerCase() === 'false') {
    return false;
  }

  const untilRaw = String(process.env.CALL_ATTEMPT_MONITORING_UNTIL || '').trim();
  if (!untilRaw) return true;

  const until = new Date(untilRaw);
  if (Number.isNaN(until.getTime())) return true;
  return cloneDate(now).getTime() <= until.getTime();
}

function buildAuditContext(auditContext, user) {
  if (auditContext) return auditContext;
  return { user: user || null, ip: null, headers: {} };
}

async function emitCallAttemptMonitoring({
  auditContext = null,
  user = null,
  action,
  leadId = null,
  sequenceId = null,
  attemptId = null,
  error = null,
  metadata = {},
  now = new Date(),
}) {
  if (!action || !shouldEmitCallAttemptMonitoring(now)) return;

  const payload = {
    monitoring_scope: 'call_attempt_launch_window',
    monitoring_window_hours: CALL_ATTEMPT_MONITORING_WINDOW_HOURS,
    monitoring_until: process.env.CALL_ATTEMPT_MONITORING_UNTIL || null,
    lead_id: leadId || null,
    sequence_id: sequenceId || null,
    attempt_id: attemptId || null,
    error_code: error?.code || null,
    error_message: error?.message || null,
    ...metadata,
  };

  try {
    const logLevel = /FAILED|ERROR/.test(action) ? 'error' : 'warn';
    logger[logLevel](
      {
        action,
        leadId,
        sequenceId,
        attemptId,
        actorId: user?.id || auditContext?.user?.id || null,
        metadata: payload,
      },
      '[call-attempt-monitoring] event captured',
    );
  } catch (loggingError) {
    try {
      logger.warn({ err: loggingError?.message, action }, '[call-attempt-monitoring] logger write failed');
    } catch { /* never block business flow on monitoring logger failure */ }
  }

  void logActivity(buildAuditContext(auditContext, user), {
    entity: 'lead_call_attempt',
    entity_id: attemptId || sequenceId || leadId || null,
    action,
    new_value: metadata?.requested_outcome || metadata?.next_trigger_reason || error?.message || null,
    metadata: payload,
  }).catch((loggingError) => {
    try {
      logger.warn({ err: loggingError?.message, action }, '[call-attempt-monitoring] activity log enqueue failed');
    } catch { /* never block business flow on monitoring logger failure */ }
  });
}

function normalizeAttemptOutcome(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ATTEMPT_OUTCOME_ALIASES[normalized] || null;
}

function isRetryableWorkflowStatus(value) {
  return RETRYABLE_WORKFLOW_STATUSES.has(String(value || '').trim().toLowerCase());
}

function getSingleRetryableWorkflowStatus(statuses) {
  const list = Array.isArray(statuses) ? statuses : statuses ? [statuses] : [];
  const retryable = [...new Set(list
    .map(status => String(status || '').trim().toLowerCase())
    .filter(status => RETRYABLE_WORKFLOW_STATUSES.has(status)))];
  if (retryable.length > 1) {
    throw new AppError(400, 'MULTIPLE_CALL_ISSUES', 'Select one call issue at a time.');
  }
  return retryable[0] || null;
}

function getSingleCallIssueStatus(statuses) {
  const list = Array.isArray(statuses) ? statuses : statuses ? [statuses] : [];
  const issues = [...new Set(list
    .map(status => String(status || '').trim().toLowerCase())
    .filter(status => CALL_ISSUE_WORKFLOW_STATUSES.has(status)))];
  if (issues.length > 1) {
    throw new AppError(400, 'MULTIPLE_CALL_ISSUES', 'Select one call issue at a time.');
  }
  return issues[0] || null;
}

function shouldCancelAttemptSequencesForWorkflowStatuses(statuses) {
  const list = Array.isArray(statuses) ? statuses : statuses ? [statuses] : [];
  return list.some(status => SEQUENCE_CANCELLING_WORKFLOW_STATUSES.has(String(status || '').trim().toLowerCase()));
}

function shouldCancelAttemptSequencesForCallStatuses(statuses) {
  const list = Array.isArray(statuses) ? statuses : statuses ? [statuses] : [];
  return list.some(status => SEQUENCE_CANCELLING_CALL_STATUSES.has(String(status || '').trim().toLowerCase()));
}

function cloneDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError(400, 'INVALID_DATE', 'Invalid date supplied.');
  return date;
}

function toBusinessWallClock(value) {
  return new Date(cloneDate(value).getTime() + BUSINESS_OFFSET_MINUTES * 60 * 1000);
}

function fromBusinessWallClock(value) {
  return new Date(cloneDate(value).getTime() - BUSINESS_OFFSET_MINUTES * 60 * 1000);
}

function buildBusinessDate(year, monthIndex, day, hour, minute = 0) {
  return fromBusinessWallClock(new Date(Date.UTC(year, monthIndex, day, hour, minute, 0, 0)));
}

function getBusinessParts(value) {
  const date = toBusinessWallClock(value);
  return {
    year: date.getUTCFullYear(),
    monthIndex: date.getUTCMonth(),
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function addMinutes(value, minutes) {
  return new Date(cloneDate(value).getTime() + minutes * 60 * 1000);
}

function addBusinessDays(value, days) {
  const wallClock = toBusinessWallClock(value);
  wallClock.setUTCDate(wallClock.getUTCDate() + days);
  return fromBusinessWallClock(wallClock);
}

function startOfBusinessDay(value) {
  const parts = getBusinessParts(value);
  return buildBusinessDate(parts.year, parts.monthIndex, parts.day, BUSINESS_HOURS.startHour, BUSINESS_HOURS.startMinute);
}

function snapIntoBusinessHours(value) {
  const date = cloneDate(value);
  const parts = getBusinessParts(date);
  const minuteOfDay = parts.hour * 60 + parts.minute;
  const startMinute = BUSINESS_HOURS.startHour * 60 + BUSINESS_HOURS.startMinute;
  const endMinute = BUSINESS_HOURS.endHour * 60 + BUSINESS_HOURS.endMinute;

  if (minuteOfDay < startMinute) {
    return buildBusinessDate(parts.year, parts.monthIndex, parts.day, BUSINESS_HOURS.startHour, BUSINESS_HOURS.startMinute);
  }
  if (minuteOfDay >= endMinute) {
    const nextDay = addBusinessDays(buildBusinessDate(parts.year, parts.monthIndex, parts.day, 12, 0), 1);
    return startOfBusinessDay(nextDay);
  }
  return date;
}

function scheduleNextBusinessDayAt(value, hour, minute = 0) {
  const parts = getBusinessParts(value);
  const nextDay = addBusinessDays(buildBusinessDate(parts.year, parts.monthIndex, parts.day, hour, minute), 1);
  const nextParts = getBusinessParts(nextDay);
  return buildBusinessDate(nextParts.year, nextParts.monthIndex, nextParts.day, hour, minute);
}

function scheduleFinalRecoveryAttempt(value) {
  const parts = getBusinessParts(value);
  const target = buildBusinessDate(parts.year, parts.monthIndex, parts.day, parts.hour, parts.minute);
  return snapIntoBusinessHours(addBusinessDays(target, FINAL_RECOVERY_DELAY_DAYS));
}

function getRetryPolicy(issueType) {
  const normalized = String(issueType || '').trim().toLowerCase();
  return RETRY_POLICY_DEFAULTS[normalized] || null;
}

function toLeadCallStatusValue(outcome) {
  if (outcome === 'cb') return 'busy';
  return outcome;
}

async function syncCurrentWorkflowCallIssue(client, { leadId, userId, outcome }) {
  const { rows: [workflow] } = await run(client, `
    SELECT remark_status, step_1_statuses
      FROM lead_workflow
     WHERE lead_id = $1
     FOR UPDATE
  `, [leadId]);
  const existing = Array.isArray(workflow?.step_1_statuses) && workflow.step_1_statuses.length
    ? workflow.step_1_statuses
    : workflow?.remark_status ? [workflow.remark_status] : [];
  const statuses = [...new Set([
    ...existing.filter(status => !CALL_ISSUE_WORKFLOW_STATUSES.has(String(status || '').toLowerCase())),
    outcome,
  ])];

  await saveWorkflowRemark({
    client,
    leadId,
    userId,
    remarkStatus: outcome,
    remarkStatuses: statuses,
    source: 'call_attempt_outcome',
  });
}

function calculateNextCallTime({
  issueType,
  attemptNumber,
  attemptedAt,
  explicitFollowupAt,
  businessHours = BUSINESS_HOURS,
  timezone = BUSINESS_TIMEZONE,
}) {
  void businessHours;
  void timezone;

  const normalizedIssue = String(issueType || '').trim().toLowerCase();
  if (!RETRYABLE_WORKFLOW_STATUSES.has(normalizedIssue)) return null;

  const currentAttemptNumber = Number(attemptNumber || 0);
  if (currentAttemptNumber >= MAX_ATTEMPTS_PER_SEQUENCE) return null;

  const nextAttemptNumber = currentAttemptNumber + 1;
  const baseAttemptedAt = cloneDate(attemptedAt || new Date());
  const policy = getRetryPolicy(normalizedIssue);

  if (normalizedIssue === 'recall' && explicitFollowupAt) {
    return snapIntoBusinessHours(explicitFollowupAt);
  }

  if (normalizedIssue === 'cnr') {
    if (nextAttemptNumber === 2) return snapIntoBusinessHours(addMinutes(baseAttemptedAt, 180));
    if (nextAttemptNumber === 3) return scheduleNextBusinessDayAt(baseAttemptedAt, 11, 0);
    if (nextAttemptNumber === 4) return scheduleFinalRecoveryAttempt(baseAttemptedAt);
    return null;
  }

  if (!policy) return null;

  if (nextAttemptNumber === 2 || nextAttemptNumber === 3) {
    return snapIntoBusinessHours(addMinutes(baseAttemptedAt, policy.retryDelayMinutes));
  }
  if (nextAttemptNumber === 4) {
    return scheduleFinalRecoveryAttempt(baseAttemptedAt);
  }

  return null;
}

function getColdLeadLevelForCategory(category) {
  const normalized = String(category || '').trim().toLowerCase();
  if (normalized === 'partner') return 'cold_partner';
  if (normalized === 'trader') return 'cold_trader';
  return 'cold_lead';
}

function deriveAttemptState(attempt, now = new Date()) {
  if (!attempt) return null;

  const scheduledAt = attempt.scheduled_at ? new Date(attempt.scheduled_at) : null;
  const attemptedAt = attempt.attempted_at ? new Date(attempt.attempted_at) : null;
  const response = {
    ...attempt,
    is_due: false,
    is_overdue: false,
    is_locked: false,
    available_in_minutes: null,
    overdue_by_minutes: null,
    ui_state: attempt.status,
    can_complete: false,
    grace_minutes: GRACE_MINUTES,
    business_timezone: BUSINESS_TIMEZONE,
  };

  if (attempt.status === 'completed' || attempt.status === 'cancelled' || !scheduledAt) {
    response.ui_state = attempt.status;
    return response;
  }

  const diffMinutes = Math.floor((cloneDate(now).getTime() - scheduledAt.getTime()) / 60000);
  if (diffMinutes < 0) {
    response.is_locked = true;
    response.available_in_minutes = Math.abs(diffMinutes);
    response.ui_state = 'locked';
    return response;
  }

  response.is_due = true;
  response.can_complete = true;
  if (diffMinutes > 0) {
    response.is_overdue = true;
    response.overdue_by_minutes = diffMinutes;
    response.ui_state = 'overdue';
  } else {
    response.ui_state = 'due';
  }

  if (attemptedAt && attempt.status === 'completed') {
    response.delay_minutes = Math.max(0, Math.round((attemptedAt.getTime() - scheduledAt.getTime()) / 60000));
  }

  return response;
}

async function recordWorkflowHistory(client, {
  leadId,
  userId,
  action,
  newValue = null,
  oldValue = null,
  metadata = null,
}) {
  await run(client, `
    INSERT INTO lead_workflow_history (lead_id, user_id, step, action, old_value, new_value, metadata)
    VALUES ($1, $2, 1, $3, $4, $5, $6::jsonb)
  `, [
    leadId,
    userId || null,
    action,
    oldValue,
    newValue,
    metadata ? JSON.stringify(metadata) : null,
  ]);
}

async function getLeadRow(client, leadId, { forUpdate = false } = {}) {
  const { rows: [lead] } = await run(client, `
    SELECT id, assigned_to_user_id, category, deleted_at, call_status, stage
      FROM leads
     WHERE id = $1 AND deleted_at IS NULL
     ${forUpdate ? 'FOR UPDATE' : ''}
  `, [leadId]);
  if (!lead) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found');
  return lead;
}

async function getSequenceRow(client, leadId, { forUpdate = false, activeOnly = false } = {}) {
  const { rows } = await run(client, `
    SELECT *
      FROM lead_call_attempt_sequences
     WHERE lead_id = $1
       ${activeOnly ? `AND status = 'active'` : ''}
     ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, updated_at DESC, created_at DESC
     LIMIT 1
     ${forUpdate ? 'FOR UPDATE' : ''}
  `, [leadId]);
  return rows[0] || null;
}

async function getSequenceAttempts(client, sequenceId, { forUpdate = false } = {}) {
  const { rows } = await run(client, `
    SELECT *
      FROM lead_call_attempts
     WHERE sequence_id = $1
     ORDER BY attempt_number ASC, created_at ASC
     ${forUpdate ? 'FOR UPDATE' : ''}
  `, [sequenceId]);
  return rows;
}

async function getCurrentScheduledAttempt(client, sequenceId, { forUpdate = false } = {}) {
  const { rows } = await run(client, `
    SELECT *
      FROM lead_call_attempts
     WHERE sequence_id = $1
       AND status = 'scheduled'
     ORDER BY attempt_number ASC
     LIMIT 1
     ${forUpdate ? 'FOR UPDATE' : ''}
  `, [sequenceId]);
  return rows[0] || null;
}

async function createAttemptRow(client, payload) {
  const { rows: [attempt] } = await run(client, `
    INSERT INTO lead_call_attempts (
      sequence_id,
      lead_id,
      attempt_number,
      trigger_reason,
      outcome,
      status,
      scheduled_at,
      attempted_at,
      responsible_user_id,
      completed_by_user_id,
      delay_minutes,
      is_final_attempt,
      remark_id,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()
    )
    RETURNING *
  `, [
    payload.sequenceId,
    payload.leadId,
    payload.attemptNumber,
    payload.triggerReason,
    payload.outcome || null,
    payload.status,
    payload.scheduledAt,
    payload.attemptedAt || null,
    payload.responsibleUserId || null,
    payload.completedByUserId || null,
    payload.delayMinutes ?? null,
    !!payload.isFinalAttempt,
    payload.remarkId || null,
  ]);
  return attempt;
}

async function updateSequenceTimestamp(client, sequenceId) {
  await run(client, `
    UPDATE lead_call_attempt_sequences
       SET updated_at = NOW()
     WHERE id = $1
  `, [sequenceId]);
}

async function getOrCreateActiveSequence(client, { leadId, userId, triggerReason }) {
  const existing = await getSequenceRow(client, leadId, { forUpdate: true, activeOnly: true });
  if (existing) return existing;

  const { rows: [sequence] } = await run(client, `
    INSERT INTO lead_call_attempt_sequences (
      lead_id,
      status,
      opened_by_user_id,
      initial_trigger_reason,
      created_at,
      updated_at
    )
    VALUES ($1, 'active', $2, $3, NOW(), NOW())
    RETURNING *
  `, [leadId, userId || null, triggerReason]);
  return sequence;
}

async function scheduleNextAttempt(client, {
  sequence,
  lead,
  currentAttempt,
  nextTriggerReason,
  explicitFollowupAt,
  userId,
  auditContext = null,
  now = new Date(),
}) {
  const nextScheduledAt = calculateNextCallTime({
    issueType: nextTriggerReason,
    attemptNumber: currentAttempt.attempt_number,
    attemptedAt: currentAttempt.attempted_at || now,
    explicitFollowupAt,
  });

  if (!nextScheduledAt) return null;

  const nextAttemptNumber = Number(currentAttempt.attempt_number) + 1;
  try {
    const nextAttempt = await createAttemptRow(client, {
      sequenceId: sequence.id,
      leadId: lead.id,
      attemptNumber: nextAttemptNumber,
      triggerReason: nextTriggerReason,
      status: 'scheduled',
      scheduledAt: nextScheduledAt,
      responsibleUserId: lead.assigned_to_user_id || userId || null,
      isFinalAttempt: nextAttemptNumber === MAX_ATTEMPTS_PER_SEQUENCE,
    });

    await updateSequenceTimestamp(client, sequence.id);
    await recordWorkflowHistory(client, {
      leadId: lead.id,
      userId,
      action: 'call_attempt_scheduled',
      newValue: nextTriggerReason,
      metadata: {
        sequence_id: sequence.id,
        attempt_id: nextAttempt.id,
        attempt_number: nextAttempt.attempt_number,
        trigger_reason: nextTriggerReason,
        scheduled_at: nextAttempt.scheduled_at,
        is_final_attempt: nextAttempt.is_final_attempt,
        business_timezone: BUSINESS_TIMEZONE,
      },
    });

    return nextAttempt;
  } catch (error) {
    error.callAttemptMonitoringLogged = true;
    await emitCallAttemptMonitoring({
      auditContext,
      user: userId ? { id: userId } : null,
      action: 'CALL_ATTEMPT_NEXT_SCHEDULE_FAILED',
      leadId: lead?.id || null,
      sequenceId: sequence?.id || null,
      attemptId: currentAttempt?.id || null,
      error,
      metadata: {
        current_attempt_number: currentAttempt?.attempt_number || null,
        next_attempt_number: nextAttemptNumber,
        next_trigger_reason: nextTriggerReason,
        explicit_followup_at: explicitFollowupAt || null,
      },
      now,
    });
    throw error;
  }
}

async function cancelFutureAttempts(sequenceId, reason, client, userId = null) {
  const result = await run(client, `
    UPDATE lead_call_attempts
       SET status = 'cancelled',
           updated_at = NOW()
     WHERE sequence_id = $1
       AND status = 'scheduled'
    RETURNING id, attempt_number, scheduled_at
  `, [sequenceId]);

  if (result.rows.length) {
    const leadId = (await run(client, `SELECT lead_id FROM lead_call_attempt_sequences WHERE id = $1`, [sequenceId])).rows[0]?.lead_id;
    if (leadId) {
      await recordWorkflowHistory(client, {
        leadId,
        userId,
        action: 'call_attempts_cancelled',
        newValue: reason,
        metadata: {
          sequence_id: sequenceId,
          cancelled_attempt_ids: result.rows.map(row => row.id),
          cancelled_attempt_numbers: result.rows.map(row => row.attempt_number),
        },
      });
    }
  }

  return result.rows;
}

async function closeSequence(client, sequenceId, status, closedReason) {
  const { rows: [sequence] } = await run(client, `
    UPDATE lead_call_attempt_sequences
       SET status = $2,
           closed_reason = $3,
           closed_at = NOW(),
           updated_at = NOW()
     WHERE id = $1
    RETURNING *
  `, [sequenceId, status, closedReason]);
  return sequence;
}

async function cancelLeadActiveAttemptSequences({ client, leadId, reason, userId = null }) {
  const sequence = await getSequenceRow(client, leadId, { forUpdate: true, activeOnly: true });
  if (!sequence) return { cancelled: false, sequence: null };
  await cancelFutureAttempts(sequence.id, reason, client, userId);
  const closed = await closeSequence(client, sequence.id, 'cancelled', reason);
  return { cancelled: true, sequence: closed };
}

async function applyColdLeadLevel(client, {
  leadId,
  userId,
  leadCategory,
  sequenceId,
  attemptId,
  attemptNumber,
  auditContext = null,
}) {
  try {
    const coldLevel = getColdLeadLevelForCategory(leadCategory);
    const { rows: [existing] } = await run(client, `
      SELECT lead_level, step_2_statuses
        FROM lead_workflow
       WHERE lead_id = $1
       FOR UPDATE
    `, [leadId]);

    const nextStatuses = Array.isArray(existing?.step_2_statuses)
      ? existing.step_2_statuses.filter(value => !['cold_lead', 'cold_partner', 'cold_trader', 'hot_lead', 'hot_partner', 'hot_trader'].includes(String(value)))
      : [];
    nextStatuses.unshift(coldLevel);
    const uniqueStatuses = [...new Set(nextStatuses)];

    await run(client, `
      INSERT INTO lead_workflow (lead_id, user_id, lead_level, step_2_statuses, lead_level_saved_at, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
      ON CONFLICT (lead_id) DO UPDATE SET
        lead_level = EXCLUDED.lead_level,
        step_2_statuses = EXCLUDED.step_2_statuses,
        lead_level_saved_at = NOW(),
        updated_at = NOW()
    `, [leadId, userId || null, coldLevel, JSON.stringify(uniqueStatuses)]);

    await recordWorkflowHistory(client, {
      leadId,
      userId,
      action: 'auto_cold_level_applied',
      newValue: coldLevel,
      metadata: {
        sequence_id: sequenceId,
        attempt_id: attemptId,
        attempt_number: attemptNumber,
      },
    });

    return coldLevel;
  } catch (error) {
    error.callAttemptMonitoringLogged = true;
    await emitCallAttemptMonitoring({
      auditContext,
      user: userId ? { id: userId } : null,
      action: 'CALL_ATTEMPT_FINAL_COLD_TRANSITION_FAILED',
      leadId,
      sequenceId,
      attemptId,
      error,
      metadata: {
        attempt_number: attemptNumber,
        lead_category: leadCategory || null,
        target_cold_status: getColdLeadLevelForCategory(leadCategory),
      },
    });
    throw error;
  }
}

async function startAttemptSequenceFromRemark({
  client,
  leadId,
  user,
  triggerReason,
  remarkId = null,
  explicitFollowupAt = null,
  auditContext = null,
  now = new Date(),
}) {
  const normalizedTriggerReason = String(triggerReason || '').trim().toLowerCase();
  if (!isRetryableWorkflowStatus(normalizedTriggerReason)) return null;
  let sequence = null;

  try {
    const lead = await getLeadRow(client, leadId, { forUpdate: true });
    sequence = await getOrCreateActiveSequence(client, {
      leadId,
      userId: user?.id || null,
      triggerReason: normalizedTriggerReason,
    });

    const existingAttempts = await getSequenceAttempts(client, sequence.id, { forUpdate: true });
    if (existingAttempts.length > 0) {
      return sequence;
    }

    const attempt = await createAttemptRow(client, {
      sequenceId: sequence.id,
      leadId,
      attemptNumber: 1,
      triggerReason: normalizedTriggerReason,
      outcome: normalizedTriggerReason,
      status: 'completed',
      scheduledAt: now,
      attemptedAt: now,
      responsibleUserId: lead.assigned_to_user_id || user?.id || null,
      completedByUserId: user?.id || null,
      delayMinutes: 0,
      isFinalAttempt: false,
      remarkId,
    });

    await recordWorkflowHistory(client, {
      leadId,
      userId: user?.id || null,
      action: 'call_attempt_completed',
      newValue: normalizedTriggerReason,
      metadata: {
        sequence_id: sequence.id,
        attempt_id: attempt.id,
        attempt_number: 1,
        scheduled_at: attempt.scheduled_at,
        attempted_at: attempt.attempted_at,
        delay_minutes: 0,
        origin: 'workflow_remark',
      },
    });

    await scheduleNextAttempt(client, {
      sequence,
      lead,
      currentAttempt: attempt,
      nextTriggerReason: normalizedTriggerReason,
      explicitFollowupAt,
      userId: user?.id || null,
      auditContext,
      now,
    });

    await run(client, `
      UPDATE leads
         SET call_status = $2,
             last_call_at = $3,
             call_attempts = call_attempts + 1,
             updated_at = NOW(),
             locked_by_user_id = NULL,
             locked_until = NULL
       WHERE id = $1
    `, [leadId, toLeadCallStatusValue(normalizedTriggerReason), now]);

    // Keep the live Step 1 issue in sync with the sequence without touching remark history.
    await syncCurrentWorkflowCallIssue(client, {
      leadId,
      userId: user?.id || null,
      outcome: normalizedTriggerReason,
    });

    return sequence;
  } catch (error) {
    if (!error.callAttemptMonitoringLogged) {
      await emitCallAttemptMonitoring({
        auditContext,
        user,
        action: 'CALL_ATTEMPT_SEQUENCE_CREATE_FAILED',
        leadId,
        sequenceId: sequence?.id || null,
        error,
        metadata: {
          trigger_reason: normalizedTriggerReason,
          remark_id: remarkId || null,
          explicit_followup_at: explicitFollowupAt || null,
        },
        now,
      });
    }
    throw error;
  }
}

async function completeAttemptAsLeadInteraction(client, {
  leadId,
  user,
  outcome,
  attemptNumber,
  note,
}) {
  return createLeadInteraction({
    client,
    user,
    leadId,
    note: note || `Call attempt ${attemptNumber} outcome: ${String(outcome || '').replace(/_/g, ' ')}`,
    status: outcome,
    statuses: [outcome],
    source: 'workflow_step_1_attempt',
    workflowStep: 1,
    syncWorkflowStep1: ['communication_completed', 'not_interested', 'in', 'callback_requested', 'follow_up'].includes(outcome),
  });
}

async function completeScheduledAttempt({
  client,
  leadId,
  attemptId,
  user,
  outcome,
  explicitFollowupAt = null,
  auditContext = null,
  now = new Date(),
}) {
  const normalizedOutcome = normalizeAttemptOutcome(outcome);
  if (!normalizedOutcome) {
    throw new AppError(400, 'INVALID_ATTEMPT_OUTCOME', 'Select a valid call attempt outcome.');
  }

  const lead = await getLeadRow(client, leadId, { forUpdate: true });
  const sequence = await getSequenceRow(client, leadId, { forUpdate: true, activeOnly: true });
  if (!sequence) {
    throw new AppError(409, 'NO_ACTIVE_CALL_ATTEMPT_SEQUENCE', 'No active call attempt sequence was found.');
  }

  const { rows: attemptRows } = await run(client, `
    SELECT *
      FROM lead_call_attempts
     WHERE id = $1
       AND sequence_id = $2
       AND lead_id = $3
     FOR UPDATE
  `, [attemptId, sequence.id, leadId]);
  const attempt = attemptRows[0];
  if (!attempt) throw new AppError(404, 'CALL_ATTEMPT_NOT_FOUND', 'Call attempt not found.');
  if (attempt.status === 'completed' || attempt.status === 'cancelled') {
    await emitCallAttemptMonitoring({
      auditContext,
      user,
      action: 'CALL_ATTEMPT_DUPLICATE_COMPLETION',
      leadId,
      sequenceId: sequence.id,
      attemptId: attempt.id,
      metadata: {
        attempt_number: attempt.attempt_number,
        current_status: attempt.status,
        requested_outcome: normalizedOutcome,
        scheduled_at: attempt.scheduled_at,
        attempted_at: attempt.attempted_at || null,
      },
      now,
    });
    return { attempt, sequence, alreadyProcessed: true };
  }

  const scheduledAt = new Date(attempt.scheduled_at);
  const attemptedAt = cloneDate(now);
  if (attempt.attempt_number > 1 && attemptedAt.getTime() < scheduledAt.getTime()) {
    const error = new AppError(409, 'CALL_ATTEMPT_LOCKED', 'This attempt is locked until its scheduled time.');
    await emitCallAttemptMonitoring({
      auditContext,
      user,
      action: 'CALL_ATTEMPT_LOCKED',
      leadId,
      sequenceId: sequence.id,
      attemptId: attempt.id,
      error,
      metadata: {
        attempt_number: attempt.attempt_number,
        requested_outcome: normalizedOutcome,
        scheduled_at: attempt.scheduled_at,
        available_in_minutes: Math.max(0, Math.ceil((scheduledAt.getTime() - attemptedAt.getTime()) / 60000)),
      },
      now: attemptedAt,
    });
    throw error;
  }

  const delayMinutes = Math.max(0, Math.round((attemptedAt.getTime() - scheduledAt.getTime()) / 60000));
  const { rows: [completedAttempt] } = await run(client, `
    UPDATE lead_call_attempts
       SET outcome = $2,
           status = 'completed',
           attempted_at = $3,
           completed_by_user_id = $4,
           delay_minutes = $5,
           updated_at = NOW()
     WHERE id = $1
    RETURNING *
  `, [attempt.id, normalizedOutcome, attemptedAt, user.id, delayMinutes]);

  await recordWorkflowHistory(client, {
    leadId,
    userId: user.id,
    action: 'call_attempt_completed',
    newValue: normalizedOutcome,
    metadata: {
      sequence_id: sequence.id,
      attempt_id: completedAttempt.id,
      attempt_number: completedAttempt.attempt_number,
      scheduled_at: completedAttempt.scheduled_at,
      attempted_at: completedAttempt.attempted_at,
      delay_minutes: delayMinutes,
      overdue: delayMinutes > 0,
    },
  });

  if (normalizedOutcome === 'call_received') {
    await cancelFutureAttempts(sequence.id, 'call_received', client, user.id);
    await closeSequence(client, sequence.id, 'completed', 'call_received');
    await completeAttemptAsLeadInteraction(client, {
      leadId,
      user,
      outcome: 'communication_completed',
      attemptNumber: completedAttempt.attempt_number,
      note: `Call received on Attempt ${completedAttempt.attempt_number}. Communication Completed applied automatically.`,
    });
    await recordWorkflowHistory(client, {
      leadId,
      userId: user.id,
      action: 'auto_communication_completed',
      newValue: 'communication_completed',
      metadata: {
        sequence_id: sequence.id,
        attempt_id: completedAttempt.id,
        attempt_number: completedAttempt.attempt_number,
      },
    });
    return { attempt: completedAttempt, sequence, closed: true, outcome: normalizedOutcome };
  }

  if (isRetryableWorkflowStatus(normalizedOutcome)) {
    const leadCallStatus = toLeadCallStatusValue(normalizedOutcome);
    await run(client, `
      UPDATE leads
         SET call_status = $2,
             last_call_at = $3,
             call_attempts = call_attempts + 1,
             updated_at = NOW(),
             locked_by_user_id = NULL,
             locked_until = NULL
       WHERE id = $1
    `, [leadId, leadCallStatus, attemptedAt]);

    if (completedAttempt.attempt_number >= MAX_ATTEMPTS_PER_SEQUENCE) {
      await cancelFutureAttempts(sequence.id, 'max_attempts_reached', client, user.id);
      await closeSequence(client, sequence.id, 'cold_closed', `final_${normalizedOutcome}`);
      await applyColdLeadLevel(client, {
        leadId,
        userId: user.id,
        leadCategory: lead.category,
        sequenceId: sequence.id,
        attemptId: completedAttempt.id,
        attemptNumber: completedAttempt.attempt_number,
        auditContext,
      });
      await syncCurrentWorkflowCallIssue(client, {
        leadId,
        userId: user.id,
        outcome: normalizedOutcome,
      });
      return { attempt: completedAttempt, sequence, closed: true, outcome: normalizedOutcome };
    }

    const nextAttempt = await scheduleNextAttempt(client, {
      sequence,
      lead,
      currentAttempt: completedAttempt,
      nextTriggerReason: normalizedOutcome,
      explicitFollowupAt,
      userId: user.id,
      auditContext,
      now: attemptedAt,
    });
    await syncCurrentWorkflowCallIssue(client, {
      leadId,
      userId: user.id,
      outcome: normalizedOutcome,
    });
    return { attempt: completedAttempt, sequence, nextAttempt, outcome: normalizedOutcome };
  }

  await cancelFutureAttempts(sequence.id, `terminal_${normalizedOutcome}`, client, user.id);
  await closeSequence(client, sequence.id, 'cancelled', `terminal_${normalizedOutcome}`);

  const workflowStatus = normalizedOutcome === 'in' || normalizedOutcome === 'not_interested' || normalizedOutcome === 'callback_requested' || normalizedOutcome === 'follow_up'
    ? normalizedOutcome
    : null;
  if (workflowStatus) {
    await completeAttemptAsLeadInteraction(client, {
      leadId,
      user,
      outcome: workflowStatus,
      attemptNumber: completedAttempt.attempt_number,
      note: `Call attempt ${completedAttempt.attempt_number} closed with ${workflowStatus.replace(/_/g, ' ')}.`,
    });
  } else {
    await run(client, `
      UPDATE leads
         SET last_call_at = $2,
             call_attempts = call_attempts + 1,
             updated_at = NOW(),
             locked_by_user_id = NULL,
             locked_until = NULL
       WHERE id = $1
    `, [leadId, attemptedAt]);
  }

  return { attempt: completedAttempt, sequence, closed: true, outcome: normalizedOutcome };
}

async function reconcileWorkflowRemarkWithCallAttempts({
  client,
  leadId,
  user,
  triggerStatus,
  remarkId = null,
  explicitFollowupAt = null,
  auditContext = null,
  now = new Date(),
}) {
  const normalizedTriggerStatus = String(triggerStatus || '').trim().toLowerCase();
  if (!normalizedTriggerStatus) return null;

  if (isRetryableWorkflowStatus(normalizedTriggerStatus)) {
    const sequence = await getSequenceRow(client, leadId, { forUpdate: true, activeOnly: true });
    if (!sequence) {
      await startAttemptSequenceFromRemark({
        client,
        leadId,
        user,
        triggerReason: normalizedTriggerStatus,
        remarkId,
        explicitFollowupAt,
        auditContext,
        now,
      });
      return { mode: 'sequence_started' };
    }

    const currentAttempt = await getCurrentScheduledAttempt(client, sequence.id, { forUpdate: true });
    if (!currentAttempt) return { mode: 'sequence_exists' };
    if (new Date(currentAttempt.scheduled_at).getTime() > cloneDate(now).getTime()) {
      const error = new AppError(409, 'CALL_ATTEMPT_LOCKED', 'This attempt is locked until its scheduled time.');
      await emitCallAttemptMonitoring({
        auditContext,
        user,
        action: 'CALL_ATTEMPT_LOCKED',
        leadId,
        sequenceId: sequence.id,
        attemptId: currentAttempt.id,
        error,
        metadata: {
          attempt_number: currentAttempt.attempt_number,
          requested_outcome: normalizedTriggerStatus,
          scheduled_at: currentAttempt.scheduled_at,
          available_in_minutes: Math.max(0, Math.ceil((new Date(currentAttempt.scheduled_at).getTime() - cloneDate(now).getTime()) / 60000)),
          source: 'workflow_remark',
        },
        now,
      });
      throw error;
    }

    await completeScheduledAttempt({
      client,
      leadId,
      attemptId: currentAttempt.id,
      user,
      outcome: normalizedTriggerStatus,
      explicitFollowupAt,
      auditContext,
      now,
    });
    return { mode: 'sequence_advanced' };
  }

  await cancelLeadActiveAttemptSequences({
    client,
    leadId,
    reason: `workflow_${normalizedTriggerStatus}`,
    userId: user?.id || null,
  });
  return { mode: 'sequence_cancelled' };
}

function buildNextScheduledCallSummary(attempt, now = new Date()) {
  if (!attempt || attempt.status !== 'scheduled') return null;
  const derived = deriveAttemptState(attempt, now);
  return {
    attempt_id: attempt.id,
    attempt_number: attempt.attempt_number,
    scheduled_at: attempt.scheduled_at,
    trigger_reason: attempt.trigger_reason,
    is_final_attempt: !!attempt.is_final_attempt,
    is_due: derived.is_due,
    is_overdue: derived.is_overdue,
    available_in_minutes: derived.available_in_minutes,
    overdue_by_minutes: derived.overdue_by_minutes,
    status: derived.ui_state,
  };
}

async function getLeadCallAttemptView({ client, leadId, now = new Date() }) {
  const sequence = await getSequenceRow(client, leadId, { activeOnly: false });
  if (!sequence) {
    return {
      call_attempt_sequence: null,
      call_attempts: [],
      next_scheduled_call: null,
      call_attempt_state: null,
    };
  }

  const attempts = await getSequenceAttempts(client, sequence.id);
  const derivedAttempts = attempts.map(attempt => deriveAttemptState(attempt, now));
  const currentAttempt = sequence.status === 'active'
    ? derivedAttempts.find(attempt => attempt.status === 'scheduled') || null
    : null;
  const nextScheduledCall = buildNextScheduledCallSummary(currentAttempt, now);

  return {
    call_attempt_sequence: {
      ...sequence,
      business_timezone: BUSINESS_TIMEZONE,
      business_hours: BUSINESS_HOURS,
      max_attempts: MAX_ATTEMPTS_PER_SEQUENCE,
      has_active_sequence: sequence.status === 'active',
    },
    call_attempts: derivedAttempts,
    next_scheduled_call: nextScheduledCall,
    call_attempt_state: {
      has_active_sequence: sequence.status === 'active',
      sequence_status: sequence.status,
      grace_minutes: GRACE_MINUTES,
      max_attempts: MAX_ATTEMPTS_PER_SEQUENCE,
      anchor_status: sequence.initial_trigger_reason,
      active_attempt_id: currentAttempt?.id || null,
      active_attempt_number: currentAttempt?.attempt_number || null,
      is_due: !!currentAttempt?.is_due,
      is_overdue: !!currentAttempt?.is_overdue,
      available_in_minutes: currentAttempt?.available_in_minutes ?? null,
      overdue_by_minutes: currentAttempt?.overdue_by_minutes ?? null,
    },
  };
}

async function reassignLeadActiveAttempts({ client, leadId, toUserId }) {
  const { rowCount } = await run(client, `
    UPDATE lead_call_attempts
       SET responsible_user_id = $2,
           updated_at = NOW()
     WHERE lead_id = $1
       AND status = 'scheduled'
  `, [leadId, toUserId || null]);
  return rowCount;
}

module.exports = {
  BUSINESS_TIMEZONE,
  BUSINESS_HOURS,
  GRACE_MINUTES,
  MAX_ATTEMPTS_PER_SEQUENCE,
  RETRYABLE_WORKFLOW_STATUSES,
  ATTEMPT_OUTCOME_ALIASES,
  getRetryPolicy,
  calculateNextCallTime,
  deriveAttemptState,
  normalizeAttemptOutcome,
  isRetryableWorkflowStatus,
  getSingleRetryableWorkflowStatus,
  getSingleCallIssueStatus,
  shouldCancelAttemptSequencesForWorkflowStatuses,
  shouldCancelAttemptSequencesForCallStatuses,
  startAttemptSequenceFromRemark,
  reconcileWorkflowRemarkWithCallAttempts,
  completeScheduledAttempt,
  cancelFutureAttempts,
  cancelLeadActiveAttemptSequences,
  getLeadCallAttemptView,
  buildNextScheduledCallSummary,
  getColdLeadLevelForCategory,
  reassignLeadActiveAttempts,
};
