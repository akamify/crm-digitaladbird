const { query, withTransaction } = require('../config/database');
const { AppError } = require('../utils/errors');
const { getVisibleUserIds } = require('../middleware/rbac');
const { assertLeadCommunicationAccess } = require('./leadCommunicationAccess');
const { normalizeScope: normalizeAnalyticsScope, buildAnalyticsFilters } = require('./leadDistributionAnalyticsService');

const IST_OFFSET = '+05:30';
const TERMINAL_STATES = new Set(['converted', 'cold']);
const JOURNEY_STAGES = new Set(['new', 'response', 'common_meeting', 'tte', 'personal_meeting', 'quotation']);
const ACTION_TYPES = new Set([
  'first_contact', 'responded_next_action', 'common_meeting', 'common_meeting_outcome',
  'recontact', 'tte', 'tte_outcome', 'personal_meeting', 'personal_meeting_outcome',
  'quotation', 'callback', 'follow_up', 'manager_escalation', 'lifecycle_review', 'other',
]);
const EVENT_TYPES = new Set([
  'call_result', 'responded', 'communication_completed', 'common_meeting_scheduled',
  'common_meeting_attended', 'common_meeting_missed', 'tte_scheduled', 'tte_attended',
  'tte_missed', 'tte_completed', 'personal_meeting_scheduled', 'personal_meeting_attended',
  'personal_meeting_missed', 'personal_meeting_completed', 'quotation_sent',
  'follow_up_scheduled', 'callback_scheduled', 'other',
]);
const COLD_REASONS = new Set([
  'not_interested', 'budget_issue', 'no_response_after_full_cycle', 'requirement_mismatch',
  'purchased_elsewhere', 'timing_issue', 'duplicate', 'invalid_lead', 'other', 'legacy_import',
]);
const QUALIFYING_EVENTS = [
  'call_result', 'responded', 'communication_completed', 'common_meeting_attended',
  'common_meeting_missed', 'tte_attended', 'tte_missed', 'tte_completed',
  'personal_meeting_attended', 'personal_meeting_missed', 'personal_meeting_completed',
  'quotation_sent', 'action_completed', 'lifecycle_closed',
];
const WORKSPACE_VIEWS = new Set([
  'received', 'new', 'worked', 'pending', 'unworked', 'reassigned', 'call_issues',
  'follow_up', 'responses', 'common_meeting', 'tte', 'personal_meeting', 'quotation',
  'converted', 'cold',
]);
const LEGACY_RETRYABLE_RESULTS = new Set([
  'cnr', 'recall', 'so', 'cw', 'nn', 'nc', 'cb', 'rnr', 'busy', 'call_cut_busy',
]);
const LEGACY_CALL_ISSUE_RESULTS = new Set([...LEGACY_RETRYABLE_RESULTS, 'ni', 'in']);
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function text(value) {
  return String(value ?? '').trim();
}

function positiveInt(value, fallback, max = 100000) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? Math.min(number, max) : fallback;
}

function settingValue(rows, key, fallback) {
  const row = rows.find(item => item.key === key);
  return row ? row.value : fallback;
}

async function getSettings(runner = { query }) {
  const { rows } = await runner.query(`SELECT key, value, label, updated_at FROM workflow_settings ORDER BY key`);
  return {
    enabled: settingValue(rows, 'lifecycle_v2_enabled', false) === true,
    pilotUserIds: Array.isArray(settingValue(rows, 'lifecycle_v2_pilot_user_ids', []))
      ? settingValue(rows, 'lifecycle_v2_pilot_user_ids', []).map(String)
      : [],
    firstContactSlaMinutes: positiveInt(settingValue(rows, 'first_contact_sla_minutes', 15), 15, 1440),
    respondedSlaMinutes: positiveInt(settingValue(rows, 'responded_sla_minutes', 15), 15, 1440),
    callWindowStart: text(settingValue(rows, 'call_window_start', '09:00')) || '09:00',
    callWindowEnd: text(settingValue(rows, 'call_window_end', '20:00')) || '20:00',
    workingDays: Array.isArray(settingValue(rows, 'working_days', [1, 2, 3, 4, 5, 6]))
      ? settingValue(rows, 'working_days', [1, 2, 3, 4, 5, 6]).map(Number).filter(day => day >= 1 && day <= 7)
      : [1, 2, 3, 4, 5, 6],
    commonMeetingStart: text(settingValue(rows, 'common_meeting_start', '21:00')) || '21:00',
    commonMeetingEnd: text(settingValue(rows, 'common_meeting_end', '21:30')) || '21:30',
    commonMeetingOutcomeDeadline: text(settingValue(rows, 'common_meeting_outcome_deadline', '11:00')) || '11:00',
    stageFollowupMaxAttempts: positiveInt(settingValue(rows, 'stage_followup_max_attempts', 4), 4, 20),
    raw: rows,
  };
}

function isEnabledFor(settings, user) {
  return settings.enabled || settings.pilotUserIds.includes(String(user?.id || ''));
}

function assertEnabled(settings, user) {
  if (!isEnabledFor(settings, user)) {
    throw new AppError(409, 'LIFECYCLE_V2_DISABLED', 'Lifecycle V2 is not enabled for this account yet.');
  }
}

function businessDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoWeekday(dateString) {
  const day = new Date(`${dateString}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function nextWorkingDate(dateString, settings, includeCurrent = false) {
  let current = includeCurrent ? dateString : addDays(dateString, 1);
  const days = settings.workingDays.length ? settings.workingDays : [1, 2, 3, 4, 5, 6, 7];
  for (let index = 0; index < 8; index += 1) {
    if (days.includes(isoWeekday(current))) return current;
    current = addDays(current, 1);
  }
  return current;
}

function atIst(dateString, hhmm) {
  const value = new Date(`${dateString}T${hhmm}:00${IST_OFFSET}`);
  if (Number.isNaN(value.getTime())) throw new AppError(400, 'INVALID_ACTION_TIME', 'Enter a valid action date and time.');
  return value;
}

function clampToCallWindow(input, settings) {
  const candidate = new Date(input);
  if (Number.isNaN(candidate.getTime())) throw new AppError(400, 'INVALID_ACTION_TIME', 'Enter a valid action date and time.');
  let day = businessDate(candidate);
  const currentMinutes = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(candidate).replace(':', ''));
  const [startHour, startMinute] = settings.callWindowStart.split(':').map(Number);
  const [endHour, endMinute] = settings.callWindowEnd.split(':').map(Number);
  const start = startHour * 100 + startMinute;
  const end = endHour * 100 + endMinute;
  if (!settings.workingDays.includes(isoWeekday(day))) {
    day = nextWorkingDate(day, settings, true);
    return atIst(day, settings.callWindowStart);
  }
  if (currentMinutes < start) return atIst(day, settings.callWindowStart);
  if (currentMinutes > end) return atIst(nextWorkingDate(day, settings), settings.callWindowStart);
  return candidate;
}

function nextWorkingDeadline(now, settings, time = settings.commonMeetingOutcomeDeadline) {
  return atIst(nextWorkingDate(businessDate(now), settings), time);
}

function validateExpectedVersion(state, expectedVersion) {
  if (expectedVersion == null) return;
  const expected = Number(expectedVersion);
  if (!Number.isInteger(expected) || expected !== Number(state.version)) {
    throw new AppError(409, 'LIFECYCLE_VERSION_CONFLICT', 'This lead changed in another session. Refresh and try again.');
  }
}

async function ensureState(client, leadId) {
  await client.query(`
    INSERT INTO lead_lifecycle_state(lead_id, journey_stage, terminal_state, cold_reason, closed_at)
    SELECT l.id,
      CASE
        WHEN EXISTS (SELECT 1 FROM customer_notes pm WHERE pm.lead_id = l.id AND pm.note_kind = 'personal_meeting' AND pm.deleted_at IS NULL) THEN 'personal_meeting'
        WHEN COALESCE(l.call_status::text, 'not_called') <> 'not_called' OR l.last_call_at IS NOT NULL THEN 'response'
        ELSE 'new'
      END,
      CASE WHEN l.stage::text = 'won' OR l.call_status::text = 'converted' THEN 'converted'
           WHEN l.stage::text IN ('lost', 'dropped') OR l.call_status::text = 'not_interested' THEN 'cold' END,
      CASE WHEN l.stage::text IN ('lost', 'dropped') OR l.call_status::text = 'not_interested' THEN 'legacy_import' END,
      CASE WHEN l.stage::text IN ('won', 'lost', 'dropped') OR l.call_status::text IN ('converted', 'not_interested') THEN COALESCE(l.updated_at, NOW()) END
    FROM leads l WHERE l.id = $1 AND l.deleted_at IS NULL
    ON CONFLICT (lead_id) DO NOTHING`, [leadId]);
  const { rows: [state] } = await client.query(`SELECT * FROM lead_lifecycle_state WHERE lead_id = $1 FOR UPDATE`, [leadId]);
  if (!state) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found');
  return state;
}

async function findIdempotentEvent(client, leadId, key) {
  if (!key) return null;
  const { rows: [row] } = await client.query(`
    SELECT id FROM lead_lifecycle_events
     WHERE lead_id = $1 AND metadata->>'idempotency_key' = $2
     LIMIT 1`, [leadId, key]);
  return row || null;
}

async function cancelPrimaryAction(client, leadId, reason) {
  await client.query(`
    UPDATE lead_actions
       SET status = 'cancelled', outcome = COALESCE(outcome, $2), updated_at = NOW()
     WHERE lead_id = $1 AND is_primary = TRUE AND status IN ('scheduled', 'in_progress', 'paused', 'overdue')`, [leadId, reason]);
}

async function createPrimaryAction(client, {
  leadId, userId, actionType, reason, parentStage, parentActionId = null, dueAt,
  scheduledAt = null, stageFollowupAttempt = null, stageFollowupMax = null, idempotencyKey = null, metadata = {},
}) {
  if (!ACTION_TYPES.has(actionType)) throw new AppError(400, 'INVALID_ACTION_TYPE', 'Select a valid next action.');
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) throw new AppError(400, 'INVALID_ACTION_TIME', 'Next action date and time are required.');
  await cancelPrimaryAction(client, leadId, 'replaced_by_next_action');
  const { rows: [action] } = await client.query(`
    INSERT INTO lead_actions(
      lead_id, action_type, reason, parent_stage, parent_action_id, responsible_user_id,
      stage_followup_attempt, stage_followup_max, scheduled_at, due_at, idempotency_key,
      metadata, created_by_user_id
    ) VALUES ($1,$2::varchar,$3,$4,$5,(
      SELECT CASE WHEN $2::varchar='manager_escalation' THEN COALESCE(u.report_to_id,l.assigned_to_user_id) ELSE l.assigned_to_user_id END
        FROM leads l LEFT JOIN users u ON u.id=l.assigned_to_user_id WHERE l.id=$1
    ),$6,$7,COALESCE($12::timestamptz,NOW()),$8,$9,$10::jsonb,$11)
    RETURNING *`, [
    leadId, actionType, reason, parentStage || null, parentActionId,
    stageFollowupAttempt, stageFollowupMax, due.toISOString(), idempotencyKey,
    JSON.stringify(metadata || {}), userId, scheduledAt ? new Date(scheduledAt).toISOString() : null,
  ]);
  return action;
}

function journeyStageForEvent(eventType, currentStage) {
  if (['responded', 'communication_completed'].includes(eventType)) return 'response';
  if (eventType.startsWith('common_meeting_')) return 'common_meeting';
  if (eventType.startsWith('tte_')) return 'tte';
  if (eventType.startsWith('personal_meeting_')) return 'personal_meeting';
  if (eventType === 'quotation_sent') return 'quotation';
  return currentStage;
}

function normalizeNextAction(input, state, settings, now) {
  if (!input) return null;
  const actionType = text(input.action_type).toLowerCase();
  if (!ACTION_TYPES.has(actionType)) throw new AppError(400, 'INVALID_ACTION_TYPE', 'Select a valid next action.');
  let dueAt = input.due_at ? new Date(input.due_at) : null;
  const callTypes = new Set(['first_contact', 'responded_next_action', 'recontact', 'callback', 'follow_up']);
  if (actionType === 'common_meeting') dueAt = nextWorkingDeadline(now, settings);
  if (!dueAt || Number.isNaN(dueAt.getTime())) {
    throw new AppError(400, 'NEXT_ACTION_REQUIRED', 'Select the next action date and time.');
  }
  if (callTypes.has(actionType)) dueAt = clampToCallWindow(dueAt, settings);
  const isStageFollowup = actionType === 'follow_up' && ['tte', 'personal_meeting', 'quotation'].includes(state.journey_stage);
  return {
    actionType: actionType === 'common_meeting' ? 'common_meeting_outcome' : actionType,
    reason: text(input.reason) || `post_${state.journey_stage}`,
    parentStage: text(input.parent_stage) || state.journey_stage,
    parentActionId: input.parent_action_id || null,
    dueAt,
    scheduledAt: null,
    stageFollowupAttempt: isStageFollowup ? positiveInt(input.stage_followup_attempt, 1, settings.stageFollowupMaxAttempts) : null,
    stageFollowupMax: isStageFollowup ? settings.stageFollowupMaxAttempts : null,
    metadata: { ...(input.metadata || {}), ...(actionType === 'common_meeting' ? { outcome_deadline_at: dueAt.toISOString() } : {}) },
  };
}

function applyStageFollowupPolicy(action, next, settings, now = new Date()) {
  if (action.action_type !== 'follow_up') return next;
  const attempt = Number(action.stage_followup_attempt || 1);
  const maximum = Number(action.stage_followup_max || settings.stageFollowupMaxAttempts);
  if (attempt >= maximum) {
    return { actionType: 'manager_escalation', reason: 'stage_followup_exhausted', parentStage: action.parent_stage, dueAt: now };
  }
  if (!next) throw new AppError(400, 'NEXT_ACTION_REQUIRED', 'Schedule the next follow-up or choose a final outcome.');
  if (next.actionType === 'follow_up') {
    return { ...next, stageFollowupAttempt: attempt + 1, stageFollowupMax: maximum };
  }
  return next;
}

async function loadLifecycle(leadId, runner = { query }) {
  const { rows: [state] } = await runner.query(`
    SELECT ls.*,
      row_to_json(active_action) AS current_action,
      row_to_json(active_sequence) AS active_call_retry,
      COALESCE((SELECT COUNT(*) FROM lead_lifecycle_events pe WHERE pe.lead_id=ls.lead_id AND pe.event_type='pending_started'),0)::int AS pending_occurrences,
      COALESCE((SELECT SUM((pe.metadata->>'delay_minutes')::int) FROM lead_lifecycle_events pe WHERE pe.lead_id=ls.lead_id AND pe.event_type='action_completed'),0)::int AS total_delay_minutes,
      COALESCE((SELECT MAX((pe.metadata->>'delay_minutes')::int) FROM lead_lifecycle_events pe WHERE pe.lead_id=ls.lead_id AND pe.event_type='action_completed'),0)::int AS longest_delay_minutes
    FROM lead_lifecycle_state ls
    LEFT JOIN LATERAL (
      SELECT * FROM lead_actions la WHERE la.id=ls.current_primary_action_id LIMIT 1
    ) active_action ON TRUE
    LEFT JOIN LATERAL (
      SELECT seq.*, (
        SELECT row_to_json(ca) FROM lead_call_attempts ca
         WHERE ca.sequence_id=seq.id AND ca.status='scheduled'
         ORDER BY ca.attempt_number LIMIT 1
      ) AS next_attempt
      FROM lead_call_attempt_sequences seq
      WHERE seq.lead_id=ls.lead_id AND seq.status='active'
      ORDER BY seq.created_at DESC LIMIT 1
    ) active_sequence ON TRUE
    WHERE ls.lead_id=$1`, [leadId]);
  if (!state) return null;
  const { rows: events } = await runner.query(`
    SELECT e.*, u.full_name AS user_name
      FROM lead_lifecycle_events e LEFT JOIN users u ON u.id=e.user_id
     WHERE e.lead_id=$1 ORDER BY e.occurred_at DESC, e.id DESC LIMIT 200`, [leadId]);
  const { rows: actions } = await runner.query(`
    SELECT * FROM lead_actions WHERE lead_id=$1 ORDER BY created_at DESC, id DESC LIMIT 100`, [leadId]);
  return { state, events, actions };
}

async function assertLifecycleReadAccess(user, leadId) {
  if (user.role === 'super_admin' || user.role === 'admin') return;
  const visible = await getVisibleUserIds(user);
  if (!visible?.length) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found');
  const { rows: [lead] } = await query(`
    SELECT l.id FROM leads l
     WHERE l.id=$1 AND l.deleted_at IS NULL
       AND (l.assigned_to_user_id=ANY($2::uuid[]) OR EXISTS (
         SELECT 1 FROM lead_assignments la
          WHERE la.lead_id=l.id AND la.previous_user_id=ANY($2::uuid[])
            AND (l.assigned_to_user_id IS NULL OR l.assigned_to_user_id<>ALL($2::uuid[]))
       ))`, [leadId, visible]);
  if (!lead) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found');
}

async function getLifecycle(user, leadId) {
  await assertLifecycleReadAccess(user, leadId);
  const settings = await getSettings();
  await withTransaction(async client => ensureState(client, leadId));
  return { enabled: isEnabledFor(settings, user), settings: publicSettings(settings), ...(await loadLifecycle(leadId)) };
}

function publicSettings(settings) {
  return {
    first_contact_sla_minutes: settings.firstContactSlaMinutes,
    responded_sla_minutes: settings.respondedSlaMinutes,
    call_window_start: settings.callWindowStart,
    call_window_end: settings.callWindowEnd,
    common_meeting_start: settings.commonMeetingStart,
    common_meeting_end: settings.commonMeetingEnd,
    common_meeting_outcome_deadline: settings.commonMeetingOutcomeDeadline,
    stage_followup_max_attempts: settings.stageFollowupMaxAttempts,
  };
}

function legacyStageForStatuses(statuses, currentStage) {
  if (statuses.includes('session_730_attend') || statuses.includes('yes_after_730_session')) return 'common_meeting';
  if (['new', 'response'].includes(currentStage)
    && statuses.some(status => ['communication_completed', 'respond_hi', 'interested'].includes(status))) return 'response';
  return currentStage;
}

async function syncLegacyRemark({ client, user, leadId, statuses = [], remarkId = null, nextFollowupAt = null, now = new Date() }) {
  let settings;
  try {
    settings = await getSettings(client);
  } catch (error) {
    // Keeps the legacy write path available during a rolling deploy before migration 073 lands.
    if (error?.code === '42P01') return { enabled: false, migration_pending: true };
    throw error;
  }
  if (!isEnabledFor(settings, user)) return { enabled: false };

  const normalized = [...new Set((Array.isArray(statuses) ? statuses : [statuses])
    .map(value => text(value).toLowerCase()).filter(Boolean))];
  if (!normalized.length) return { enabled: true, synced: false };
  const idempotencyKey = `legacy-remark:${remarkId || normalized.join('-')}`.slice(0, 128);
  const state = await ensureState(client, leadId);
  if (await findIdempotentEvent(client, leadId, idempotencyKey)) {
    return { enabled: true, synced: false, duplicate: true };
  }

  const primaryStatus = normalized[0];
  const converted = primaryStatus === 'converted';
  const invalidLead = primaryStatus === 'in';
  const cold = primaryStatus === 'not_interested' || invalidLead;
  if (converted || cold) {
    const terminalState = converted ? 'converted' : 'cold';
    await client.query(`UPDATE lead_actions SET status='cancelled',outcome=$2,updated_at=NOW() WHERE lead_id=$1 AND status IN ('scheduled','in_progress','paused','overdue')`, [leadId, `legacy_${terminalState}`]);
    await client.query(`UPDATE lead_call_attempts SET status='cancelled',updated_at=NOW() WHERE lead_id=$1 AND status='scheduled'`, [leadId]);
    await client.query(`UPDATE lead_call_attempt_sequences SET status=$2,closed_reason=$3,closed_at=NOW(),updated_at=NOW() WHERE lead_id=$1 AND status='active'`, [leadId, cold ? 'cold_closed' : 'completed', `legacy_${terminalState}`]);
    const coldReason = invalidLead ? 'invalid_lead' : cold ? 'not_interested' : null;
    await client.query(`UPDATE lead_lifecycle_state SET terminal_state=$2,cold_reason=$3,cold_reason_note=NULL,current_primary_action_id=NULL,closed_at=NOW(),version=version+1,updated_at=NOW() WHERE lead_id=$1`, [leadId, terminalState, coldReason]);
    await client.query(`UPDATE leads SET stage=$2,next_followup_at=NULL,updated_at=NOW() WHERE id=$1`, [leadId, converted ? 'won' : 'lost']);
    await client.query(`INSERT INTO lead_lifecycle_events(lead_id,user_id,event_type,stage_before,stage_after,reason,metadata) VALUES($1,$2,'lifecycle_closed',$3,$3,$4,$5::jsonb)`, [leadId, user.id, state.journey_stage, `legacy_${terminalState}`, JSON.stringify({ idempotency_key: idempotencyKey, source: 'legacy_workflow', terminal_state: terminalState })]);
    return { enabled: true, synced: true, terminal_state: terminalState };
  }

  if (state.terminal_state) return { enabled: true, synced: false, closed: true };
  const callIssueResult = LEGACY_CALL_ISSUE_RESULTS.has(primaryStatus) ? primaryStatus : null;
  const retryResult = LEGACY_RETRYABLE_RESULTS.has(primaryStatus) ? primaryStatus : null;
  const schedulesCommonMeeting = primaryStatus === 'communication_completed' || primaryStatus === 'respond_hi';
  let activeSequence = null;
  if (callIssueResult) {
    const { rows: [sequence] } = await client.query(`SELECT id,originating_action_id FROM lead_call_attempt_sequences WHERE lead_id=$1 AND status='active' LIMIT 1`, [leadId]);
    activeSequence = sequence || null;
  }
  const stageAfter = schedulesCommonMeeting ? 'common_meeting' : legacyStageForStatuses(normalized, state.journey_stage);
  let action = null;
  const needsCommonMeetingOutcome = primaryStatus === 'session_730_attend';
  const needsNextDecision = primaryStatus === 'yes_after_730_session';
  const needsGeneralNextAction = ['interested', 'custom_remark', 'ni'].includes(primaryStatus);
  const followupStatus = primaryStatus === 'callback_requested' ? 'callback' : primaryStatus === 'follow_up' ? 'follow_up' : null;
  const hasCurrentAction = Boolean(state.current_primary_action_id);
  let currentAction = null;
  if (hasCurrentAction && (needsCommonMeetingOutcome || needsNextDecision)) {
    const { rows: [existingAction] } = await client.query(`
      SELECT id,action_type,due_at,scheduled_at,status
        FROM lead_actions WHERE id=$1 AND lead_id=$2
        LIMIT 1`, [state.current_primary_action_id, leadId]);
    currentAction = existingAction || null;
  }
  const replacesCurrentAction = schedulesCommonMeeting || needsCommonMeetingOutcome || needsNextDecision
    || needsGeneralNextAction || Boolean(followupStatus);

  if ((replacesCurrentAction || !hasCurrentAction) && !(retryResult && activeSequence)) {
    let actionInput = null;
    if (schedulesCommonMeeting) {
      actionInput = {
        actionType: 'common_meeting_outcome', reason: 'common_meeting_outcome_not_updated',
        parentStage: 'common_meeting', dueAt: nextWorkingDeadline(now, settings),
      };
    } else if (needsCommonMeetingOutcome) {
      actionInput = {
        actionType: 'common_meeting_outcome', reason: 'common_meeting_outcome_not_updated',
        parentStage: 'common_meeting',
        dueAt: currentAction?.action_type === 'common_meeting' || currentAction?.action_type === 'common_meeting_outcome'
          ? new Date(currentAction.due_at)
          : nextWorkingDeadline(now, settings),
      };
    } else if (followupStatus && nextFollowupAt) {
      actionInput = {
        actionType: followupStatus, reason: `legacy_${followupStatus}`, parentStage: stageAfter,
        dueAt: clampToCallWindow(new Date(nextFollowupAt), settings),
      };
    } else if (followupStatus) {
      actionInput = {
        actionType: followupStatus, reason: `legacy_${followupStatus}`, parentStage: stageAfter,
        dueAt: nextWorkingDeadline(now, settings),
      };
    } else if (needsNextDecision || needsGeneralNextAction || callIssueResult) {
      const preservedOutcomeDeadline = currentAction
        && ['common_meeting', 'common_meeting_outcome'].includes(currentAction.action_type)
        ? new Date(currentAction.due_at)
        : null;
      actionInput = {
        actionType: 'lifecycle_review', reason: callIssueResult ? 'call_issue_requires_resolution' : 'next_action_not_selected', parentStage: stageAfter,
        dueAt: preservedOutcomeDeadline || nextWorkingDeadline(now, settings),
      };
    }
    if (actionInput) {
      action = await createPrimaryAction(client, {
        leadId, userId: user.id, ...actionInput, idempotencyKey: `${idempotencyKey}:action`,
        metadata: { ...(actionInput.metadata || {}), source: 'legacy_workflow', remark_id: remarkId },
      });
    }
  }

  await client.query(`UPDATE lead_lifecycle_state SET journey_stage=$2,last_call_result=COALESCE($3,last_call_result),current_primary_action_id=COALESCE($4,current_primary_action_id),version=version+1,updated_at=NOW() WHERE lead_id=$1`, [leadId, stageAfter, callIssueResult || normalized[0] || null, action?.id || null]);
  await client.query(`INSERT INTO lead_lifecycle_events(lead_id,user_id,event_type,stage_before,stage_after,call_result,action_id,reason,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [
    leadId, user.id, callIssueResult ? 'call_result' : 'legacy_activity', state.journey_stage, stageAfter,
    callIssueResult || null, action?.id || null, normalized[0],
    JSON.stringify({ idempotency_key: idempotencyKey, source: 'legacy_workflow', remark_id: remarkId, statuses: normalized }),
  ]);
  if (retryResult && activeSequence) {
    await client.query(`UPDATE lead_call_attempt_sequences SET originating_action_id=COALESCE(originating_action_id,$2),updated_at=NOW() WHERE id=$1`, [activeSequence.id, state.current_primary_action_id || null]);
    if (state.current_primary_action_id) {
      await client.query(`UPDATE lead_actions SET status='paused',updated_at=NOW() WHERE id=$1 AND status IN ('scheduled','in_progress','overdue')`, [state.current_primary_action_id]);
    }
  } else if (state.current_primary_action_id) {
    await client.query(`UPDATE lead_actions SET status=CASE WHEN due_at<=NOW() THEN 'overdue' ELSE 'scheduled' END,updated_at=NOW() WHERE id=$1 AND status='paused'`, [state.current_primary_action_id]);
  }
  return { enabled: true, synced: true, action_id: action?.id || null };
}

async function syncLegacyLeadLevel({ client, user, leadId, statuses = [], historyId = null, now = new Date() }) {
  let settings;
  try {
    settings = await getSettings(client);
  } catch (error) {
    if (error?.code === '42P01') return { enabled: false, migration_pending: true };
    throw error;
  }
  if (!isEnabledFor(settings, user)) return { enabled: false };
  const normalized = [...new Set((Array.isArray(statuses) ? statuses : [statuses]).map(value => text(value).toLowerCase()).filter(Boolean))];
  if (!normalized.length) return { enabled: true, synced: false };
  const primaryStatus = normalized[0];
  const idempotencyKey = `legacy-level:${historyId || normalized.join('-')}`.slice(0, 128);
  const state = await ensureState(client, leadId);
  if (await findIdempotentEvent(client, leadId, idempotencyKey)) return { enabled: true, synced: false, duplicate: true };

  const converted = primaryStatus === 'converted' || primaryStatus === 'closed';
  const cold = ['cold_lead', 'cold_partner', 'cold_trader', 'not_interested', 'lost'].includes(primaryStatus);
  if (converted || cold) {
    const terminalState = converted ? 'converted' : 'cold';
    await client.query(`UPDATE lead_actions SET status='cancelled',outcome=$2,updated_at=NOW() WHERE lead_id=$1 AND status IN ('scheduled','in_progress','paused','overdue')`, [leadId, `legacy_level_${terminalState}`]);
    await client.query(`UPDATE lead_call_attempts SET status='cancelled',updated_at=NOW() WHERE lead_id=$1 AND status='scheduled'`, [leadId]);
    await client.query(`UPDATE lead_call_attempt_sequences SET status=$2,closed_reason=$3,closed_at=NOW(),updated_at=NOW() WHERE lead_id=$1 AND status='active'`, [leadId, cold ? 'cold_closed' : 'completed', `legacy_level_${terminalState}`]);
    await client.query(`UPDATE lead_lifecycle_state SET terminal_state=$2,cold_reason=$3,cold_reason_note=NULL,current_primary_action_id=NULL,closed_at=NOW(),version=version+1,updated_at=NOW() WHERE lead_id=$1`, [leadId, terminalState, cold ? 'legacy_import' : null]);
    await client.query(`UPDATE leads SET stage=$2,call_status=$3,next_followup_at=NULL,updated_at=NOW() WHERE id=$1`, [leadId, converted ? 'won' : 'lost', converted ? 'converted' : 'not_interested']);
    await client.query(`INSERT INTO lead_lifecycle_events(lead_id,user_id,event_type,stage_before,stage_after,reason,metadata) VALUES($1,$2,'lifecycle_closed',$3,$3,$4,$5::jsonb)`, [leadId, user.id, state.journey_stage, primaryStatus, JSON.stringify({ idempotency_key: idempotencyKey, source: 'legacy_workflow_level', terminal_state: terminalState, statuses: normalized })]);
    return { enabled: true, synced: true, terminal_state: terminalState };
  }
  if (state.terminal_state) return { enabled: true, synced: false, closed: true };

  const { rows: [activeRetry] } = await client.query(`SELECT id FROM lead_call_attempt_sequences WHERE lead_id=$1 AND status='active' LIMIT 1`, [leadId]);
  let action = null;
  if (!activeRetry) {
    const actionType = primaryStatus === 'callback_requested'
      ? 'callback'
      : ['follow_up_required', 'followup_partner', 'followup_trader'].includes(primaryStatus) ? 'follow_up' : 'lifecycle_review';
    action = await createPrimaryAction(client, {
      leadId,
      userId: user.id,
      actionType,
      reason: `lead_category_${primaryStatus}`,
      parentStage: state.journey_stage,
      dueAt: nextWorkingDeadline(now, settings),
      idempotencyKey: `${idempotencyKey}:action`,
      metadata: { source: 'legacy_workflow_level', history_id: historyId, statuses: normalized },
    });
  }
  await client.query(`UPDATE lead_lifecycle_state SET current_primary_action_id=COALESCE($2,current_primary_action_id),version=version+1,updated_at=NOW() WHERE lead_id=$1`, [leadId, action?.id || null]);
  await client.query(`INSERT INTO lead_lifecycle_events(lead_id,user_id,event_type,stage_before,stage_after,action_id,reason,metadata) VALUES($1,$2,'legacy_lead_level',$3,$3,$4,$5,$6::jsonb)`, [
    leadId, user.id, state.journey_stage, action?.id || null, primaryStatus,
    JSON.stringify({ idempotency_key: idempotencyKey, source: 'legacy_workflow_level', history_id: historyId, statuses: normalized, active_retry_preserved: Boolean(activeRetry) }),
  ]);
  return { enabled: true, synced: true, action_id: action?.id || null };
}

async function syncLegacyPersonalMeeting({ client, user, leadId, meetingId, meetingAt, outcome = null, followupAt = null, nextMeetingAt = null }) {
  if (!leadId || !meetingId) return { enabled: false };
  let settings;
  try {
    settings = await getSettings(client);
  } catch (error) {
    if (error?.code === '42P01') return { enabled: false, migration_pending: true };
    throw error;
  }
  if (!isEnabledFor(settings, user)) return { enabled: false };
  const normalizedOutcome = text(outcome).toLowerCase();
  const actionTime = nextMeetingAt || followupAt || meetingAt || '';
  const idempotencyKey = `legacy-pm:${meetingId}:${normalizedOutcome || 'scheduled'}:${actionTime}`.slice(0, 128);
  const state = await ensureState(client, leadId);
  if (state.terminal_state || await findIdempotentEvent(client, leadId, idempotencyKey)) {
    return { enabled: true, synced: false };
  }

  if (normalizedOutcome === 'converted') {
    await cancelPrimaryAction(client, leadId, 'lead_converted');
    await client.query(`UPDATE lead_call_attempts SET status='cancelled',updated_at=NOW() WHERE lead_id=$1 AND status='scheduled'`, [leadId]);
    await client.query(`UPDATE lead_call_attempt_sequences SET status='completed',closed_reason='lead_converted',closed_at=NOW(),updated_at=NOW() WHERE lead_id=$1 AND status='active'`, [leadId]);
    await client.query(`UPDATE lead_lifecycle_state SET journey_stage='personal_meeting',terminal_state='converted',current_primary_action_id=NULL,closed_at=NOW(),version=version+1,updated_at=NOW() WHERE lead_id=$1`, [leadId]);
    await client.query(`UPDATE leads SET stage='won',call_status='converted',next_followup_at=NULL,updated_at=NOW() WHERE id=$1`, [leadId]);
    await client.query(`INSERT INTO lead_lifecycle_events(lead_id,user_id,event_type,stage_before,stage_after,reason,related_entity_type,related_entity_id,metadata) VALUES($1,$2,'lifecycle_closed',$3,'personal_meeting','converted','personal_meeting',$4,$5::jsonb)`, [leadId, user.id, state.journey_stage, meetingId, JSON.stringify({ idempotency_key: idempotencyKey, terminal_state: 'converted', source: 'legacy_personal_meeting' })]);
    return { enabled: true, synced: true, terminal_state: 'converted' };
  }

  let next = null;
  if (nextMeetingAt) {
    next = { actionType: 'personal_meeting', reason: 'next_personal_meeting_required', parentStage: 'personal_meeting', dueAt: new Date(nextMeetingAt) };
  } else if (followupAt) {
    next = { actionType: 'follow_up', reason: 'post_personal_meeting', parentStage: 'personal_meeting', dueAt: clampToCallWindow(new Date(followupAt), settings), stageFollowupAttempt: 1, stageFollowupMax: settings.stageFollowupMaxAttempts };
  } else if (!normalizedOutcome && meetingAt) {
    next = { actionType: 'personal_meeting', reason: 'personal_meeting_scheduled', parentStage: 'personal_meeting', dueAt: new Date(meetingAt) };
  } else {
    next = { actionType: 'lifecycle_review', reason: normalizedOutcome === 'not_interested' ? 'cold_reason_required' : 'personal_meeting_requires_next_action', parentStage: 'personal_meeting', dueAt: new Date() };
  }
  const action = await createPrimaryAction(client, {
    leadId, userId: user.id, ...next, idempotencyKey: `${idempotencyKey}:action`,
    metadata: { source: 'legacy_personal_meeting', meeting_id: meetingId, meeting_outcome: normalizedOutcome || null },
  });
  const eventType = normalizedOutcome ? 'personal_meeting_completed' : 'personal_meeting_scheduled';
  await client.query(`UPDATE lead_lifecycle_state SET journey_stage='personal_meeting',current_primary_action_id=$2,version=version+1,updated_at=NOW() WHERE lead_id=$1`, [leadId, action.id]);
  await client.query(`INSERT INTO lead_lifecycle_events(lead_id,user_id,event_type,stage_before,stage_after,action_id,reason,related_entity_type,related_entity_id,metadata) VALUES($1,$2,$3,$4,'personal_meeting',$5,$6,'personal_meeting',$7,$8::jsonb)`, [leadId, user.id, eventType, state.journey_stage, action.id, normalizedOutcome || 'scheduled', meetingId, JSON.stringify({ idempotency_key: idempotencyKey, source: 'legacy_personal_meeting', meeting_outcome: normalizedOutcome || null })]);
  return { enabled: true, synced: true, action_id: action.id };
}

async function recordEvent(user, leadId, input = {}) {
  const eventType = text(input.event_type).toLowerCase();
  if (!EVENT_TYPES.has(eventType)) throw new AppError(400, 'INVALID_LIFECYCLE_EVENT', 'Select a valid lifecycle activity.');
  const idempotencyKey = text(input.idempotency_key).slice(0, 128);
  if (!idempotencyKey) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'An idempotency key is required.');
  const now = new Date();
  return withTransaction(async client => {
    await assertLeadCommunicationAccess(user, leadId, client);
    const settings = await getSettings(client);
    assertEnabled(settings, user);
    const state = await ensureState(client, leadId);
    const duplicate = await findIdempotentEvent(client, leadId, idempotencyKey);
    if (duplicate) return { duplicate: true, ...(await loadLifecycle(leadId, client)) };
    if (state.terminal_state) throw new AppError(409, 'LIFECYCLE_CLOSED', 'Reopen this lead before recording another activity.');
    validateExpectedVersion(state, input.expected_version);

    let next = normalizeNextAction(input.next_action, state, settings, now);
    if (['responded', 'communication_completed'].includes(eventType) && !next) {
      next = {
        actionType: 'common_meeting_outcome', reason: 'common_meeting_outcome_not_updated',
        parentStage: 'common_meeting', dueAt: nextWorkingDeadline(now, settings),
        metadata: { outcome_deadline_at: nextWorkingDeadline(now, settings).toISOString() },
      };
    }
    if (eventType === 'common_meeting_missed' && !next) {
      next = {
        actionType: 'recontact', reason: 'common_meeting_no_show', parentStage: 'common_meeting',
        dueAt: clampToCallWindow(nextWorkingDeadline(now, settings), settings),
      };
    }
    const requiresNext = new Set([
      'common_meeting_attended', 'tte_completed',
      'personal_meeting_completed', 'quotation_sent',
    ]);
    if (requiresNext.has(eventType) && !next) {
      throw new AppError(400, 'NEXT_ACTION_REQUIRED', 'This activity requires a next action and deadline.');
    }

    if (!next && !state.current_primary_action_id) {
      const { rows: [retry] } = await client.query(`SELECT id FROM lead_call_attempt_sequences WHERE lead_id=$1 AND status='active' LIMIT 1`, [leadId]);
      if (!retry) throw new AppError(400, 'NEXT_ACTION_REQUIRED', 'Schedule the next required action before saving.');
    }

    const stageAfter = ['common_meeting', 'common_meeting_outcome'].includes(next?.actionType)
      ? 'common_meeting'
      : journeyStageForEvent(eventType, state.journey_stage);
    const callResult = eventType === 'call_result' ? text(input.call_result || input.outcome) : null;
    if (eventType === 'call_result' && !callResult) throw new AppError(400, 'CALL_RESULT_REQUIRED', 'Select the latest call result.');
    if (eventType === 'other' && !text(input.reason)) throw new AppError(400, 'ACTIVITY_REASON_REQUIRED', 'Describe the activity.');
    let action = null;
    if (next) {
      action = await createPrimaryAction(client, {
        leadId, userId: user.id, ...next, idempotencyKey: `${idempotencyKey}:action`,
      });
    }
    if (!next && state.current_primary_action_id && ['tte_attended', 'personal_meeting_attended'].includes(eventType)) {
      await client.query(`UPDATE lead_actions SET status='in_progress',outcome=$2,updated_at=NOW() WHERE id=$1 AND status IN ('scheduled','overdue')`, [state.current_primary_action_id, eventType]);
    }
    await client.query(`
      UPDATE lead_lifecycle_state
         SET journey_stage=$2, last_call_result=COALESCE($3,last_call_result),
             current_primary_action_id=$4, version=version+1, updated_at=NOW()
       WHERE lead_id=$1`, [leadId, stageAfter, callResult || null, action?.id || state.current_primary_action_id]);
    await client.query(`
      INSERT INTO lead_lifecycle_events(
        lead_id,user_id,event_type,stage_before,stage_after,call_result,action_id,reason,metadata,occurred_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,COALESCE($10::timestamptz,NOW()))`, [
      leadId, user.id, eventType, state.journey_stage, stageAfter, callResult || null, action?.id || null,
      text(input.reason) || next?.reason || null,
      JSON.stringify({ ...(input.metadata || {}), idempotency_key: idempotencyKey }), input.occurred_at || null,
    ]);
    return { duplicate: false, ...(await loadLifecycle(leadId, client)) };
  });
}

async function completeAction(user, leadId, actionId, input = {}) {
  const idempotencyKey = text(input.idempotency_key).slice(0, 128);
  if (!idempotencyKey) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'An idempotency key is required.');
  return withTransaction(async client => {
    await assertLeadCommunicationAccess(user, leadId, client);
    const settings = await getSettings(client);
    assertEnabled(settings, user);
    const state = await ensureState(client, leadId);
    const duplicate = await findIdempotentEvent(client, leadId, idempotencyKey);
    if (duplicate) return { duplicate: true, ...(await loadLifecycle(leadId, client)) };
    validateExpectedVersion(state, input.expected_version);
    const { rows: [action] } = await client.query(`SELECT * FROM lead_actions WHERE id=$1 AND lead_id=$2 FOR UPDATE`, [actionId, leadId]);
    if (!action) throw new AppError(404, 'ACTION_NOT_FOUND', 'Lifecycle action not found.');
    if (!['scheduled', 'in_progress', 'overdue'].includes(action.status)) throw new AppError(409, 'ACTION_ALREADY_CLOSED', 'This action is already closed.');
    if (action.action_type === 'manager_escalation' && !['super_admin', 'admin', 'rm'].includes(user.role)) {
      throw new AppError(403, 'MANAGER_ACTION_REQUIRED', 'This escalation must be resolved by an RM or administrator.');
    }
    const now = new Date();
    const outcome = text(input.outcome).toLowerCase();
    const eventType = text(input.event_type).toLowerCase();
    if (eventType && !EVENT_TYPES.has(eventType)) throw new AppError(400, 'INVALID_LIFECYCLE_EVENT', 'Select a valid lifecycle activity.');
    const stageAfter = eventType ? journeyStageForEvent(eventType, state.journey_stage) : state.journey_stage;
    const callResult = eventType === 'call_result' ? text(input.call_result || outcome) : null;
    if (eventType === 'call_result' && !callResult) throw new AppError(400, 'CALL_RESULT_REQUIRED', 'Select the latest call result.');
    let next = normalizeNextAction(input.next_action, { ...state, journey_stage: stageAfter }, settings, now);

    if (['common_meeting', 'common_meeting_outcome'].includes(action.action_type)
      && (outcome === 'missed' || eventType === 'common_meeting_missed') && !next) {
      next = { actionType: 'recontact', reason: 'common_meeting_no_show', parentStage: 'common_meeting', dueAt: nextWorkingDeadline(now, settings) };
    }
    const stageCompletion = ['tte', 'tte_outcome', 'personal_meeting', 'personal_meeting_outcome', 'quotation'];
    if ((outcome === 'attended' || outcome === 'completed' || stageCompletion.includes(action.action_type)) && !next) {
      throw new AppError(400, 'NEXT_ACTION_REQUIRED', 'Completing this stage requires a next action.');
    }
    next = applyStageFollowupPolicy(action, next, settings, now);
    if (!next) throw new AppError(400, 'NEXT_ACTION_REQUIRED', 'Completing an action requires the next required action or a terminal outcome.');

    const delayMinutes = Math.max(0, Math.floor((now.getTime() - new Date(action.due_at).getTime()) / 60000));
    await client.query(`
      UPDATE lead_actions SET status='completed', completed_at=$2, outcome=$3, delay_minutes=$4, updated_at=NOW()
       WHERE id=$1`, [action.id, now.toISOString(), outcome || 'completed', delayMinutes]);
    let nextAction = null;
    if (next) {
      nextAction = await createPrimaryAction(client, {
        leadId, userId: user.id, ...next, parentActionId: next.parentActionId || action.id,
        idempotencyKey: `${idempotencyKey}:action`,
      });
    }
    await client.query(`
      UPDATE lead_lifecycle_state SET journey_stage=$2,last_call_result=COALESCE($3,last_call_result),current_primary_action_id=$4,version=version+1,updated_at=NOW()
       WHERE lead_id=$1`, [leadId, stageAfter, callResult || null, nextAction?.id || null]);
    await client.query(`
      INSERT INTO lead_lifecycle_events(lead_id,user_id,event_type,stage_before,stage_after,action_id,reason,metadata)
      VALUES($1,$2,'action_completed',$3,$4,$5,$6,$7::jsonb)`, [
      leadId, user.id, state.journey_stage, stageAfter, action.id, action.reason,
      JSON.stringify({ idempotency_key: idempotencyKey, activity_event_type: eventType || null, call_result: callResult || null, outcome: outcome || 'completed', delay_minutes: delayMinutes, next_action_id: nextAction?.id || null }),
    ]);
    return { duplicate: false, ...(await loadLifecycle(leadId, client)) };
  });
}

async function closeLifecycle(user, leadId, input = {}) {
  const terminalState = text(input.terminal_state).toLowerCase();
  if (!TERMINAL_STATES.has(terminalState)) throw new AppError(400, 'INVALID_TERMINAL_STATE', 'Choose Converted or Cold.');
  const coldReason = text(input.cold_reason).toLowerCase();
  if (terminalState === 'cold' && !COLD_REASONS.has(coldReason)) throw new AppError(400, 'COLD_REASON_REQUIRED', 'Select a valid Cold reason.');
  if (terminalState === 'cold' && coldReason === 'other' && !text(input.cold_reason_note)) {
    throw new AppError(400, 'COLD_REASON_NOTE_REQUIRED', 'Explain the Other Cold reason.');
  }
  const idempotencyKey = text(input.idempotency_key).slice(0, 128);
  if (!idempotencyKey) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'An idempotency key is required.');
  return withTransaction(async client => {
    await assertLeadCommunicationAccess(user, leadId, client);
    const settings = await getSettings(client);
    assertEnabled(settings, user);
    const state = await ensureState(client, leadId);
    const duplicate = await findIdempotentEvent(client, leadId, idempotencyKey);
    if (duplicate) return { duplicate: true, ...(await loadLifecycle(leadId, client)) };
    validateExpectedVersion(state, input.expected_version);
    await client.query(`UPDATE lead_actions SET status='cancelled', outcome=$2, updated_at=NOW() WHERE lead_id=$1 AND status IN ('scheduled','in_progress','paused','overdue')`, [leadId, `lead_${terminalState}`]);
    await client.query(`UPDATE lead_call_attempts SET status='cancelled', updated_at=NOW() WHERE lead_id=$1 AND status='scheduled'`, [leadId]);
    await client.query(`UPDATE lead_call_attempt_sequences SET status=$2, closed_reason=$3, closed_at=NOW(), updated_at=NOW() WHERE lead_id=$1 AND status='active'`, [leadId, terminalState === 'cold' ? 'cold_closed' : 'completed', `lead_${terminalState}`]);
    await client.query(`
      UPDATE lead_lifecycle_state SET terminal_state=$2, cold_reason=$3, cold_reason_note=$4,
        current_primary_action_id=NULL, closed_at=NOW(), version=version+1, updated_at=NOW()
      WHERE lead_id=$1`, [leadId, terminalState, terminalState === 'cold' ? coldReason : null, terminalState === 'cold' ? text(input.cold_reason_note) || null : null]);
    await client.query(`UPDATE leads SET stage=$2, call_status=$3, next_followup_at=NULL, updated_at=NOW() WHERE id=$1`, [leadId, terminalState === 'converted' ? 'won' : 'lost', terminalState === 'converted' ? 'converted' : 'not_interested']);
    await client.query(`
      INSERT INTO lead_lifecycle_events(lead_id,user_id,event_type,stage_before,stage_after,reason,metadata)
      VALUES($1,$2,'lifecycle_closed',$3,$3,$4,$5::jsonb)`, [leadId, user.id, state.journey_stage, terminalState === 'cold' ? coldReason : terminalState, JSON.stringify({ idempotency_key: idempotencyKey, terminal_state: terminalState, cold_reason_note: text(input.cold_reason_note) || null })]);
    return { duplicate: false, ...(await loadLifecycle(leadId, client)) };
  });
}

async function reopenLifecycle(user, leadId, input = {}) {
  if (!['super_admin', 'admin', 'rm'].includes(user.role)) throw new AppError(403, 'FORBIDDEN', 'Only an RM or administrator can reopen a lead.');
  const idempotencyKey = text(input.idempotency_key).slice(0, 128);
  if (!idempotencyKey) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'An idempotency key is required.');
  return withTransaction(async client => {
    await assertLeadCommunicationAccess(user, leadId, client);
    const settings = await getSettings(client);
    assertEnabled(settings, user);
    const state = await ensureState(client, leadId);
    const duplicate = await findIdempotentEvent(client, leadId, idempotencyKey);
    if (duplicate) return { duplicate: true, ...(await loadLifecycle(leadId, client)) };
    if (!state.terminal_state) throw new AppError(409, 'LIFECYCLE_ALREADY_OPEN', 'This lead is already active.');
    validateExpectedVersion(state, input.expected_version);
    const stage = text(input.journey_stage || state.journey_stage).toLowerCase();
    if (!JOURNEY_STAGES.has(stage)) throw new AppError(400, 'INVALID_JOURNEY_STAGE', 'Select a valid journey stage.');
    const next = normalizeNextAction(input.next_action, { ...state, journey_stage: stage }, settings, new Date());
    if (!next) throw new AppError(400, 'NEXT_ACTION_REQUIRED', 'Reopening requires a next action.');
    const action = await createPrimaryAction(client, { leadId, userId: user.id, ...next, idempotencyKey: `${idempotencyKey}:action` });
    await client.query(`UPDATE lead_lifecycle_state SET journey_stage=$2,terminal_state=NULL,cold_reason=NULL,cold_reason_note=NULL,current_primary_action_id=$3,closed_at=NULL,version=version+1,updated_at=NOW() WHERE lead_id=$1`, [leadId, stage, action.id]);
    await client.query(`UPDATE leads SET stage='contacted', call_status='follow_up', next_followup_at=$2, updated_at=NOW() WHERE id=$1`, [leadId, action.due_at]);
    await client.query(`INSERT INTO lead_lifecycle_events(lead_id,user_id,event_type,stage_before,stage_after,action_id,reason,metadata) VALUES($1,$2,'lifecycle_reopened',$3,$4,$5,$6,$7::jsonb)`, [leadId, user.id, state.journey_stage, stage, action.id, text(input.reason) || 'manager_reopened', JSON.stringify({ idempotency_key: idempotencyKey })]);
    return { duplicate: false, ...(await loadLifecycle(leadId, client)) };
  });
}

function normalizePeriod(input = {}) {
  const today = businessDate();
  const from = text(input.from || today);
  const to = text(input.to || from);
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
  if (!valid(from) || !valid(to) || from > to) throw new AppError(400, 'INVALID_DATE_RANGE', 'Enter a valid date range.');
  return { from, to };
}

function workspaceCte(period, scopeSql, filterSql) {
  const onPeriod = expression => period.view === 'all_time'
    ? 'TRUE'
    : `(${expression} >= b.from_at AND ${expression} < b.to_at)`;
  return `WITH bounds AS MATERIALIZED (
    SELECT ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata') AS from_at,
           ((($2::date + 1)::timestamp) AT TIME ZONE 'Asia/Kolkata') AS to_at
  ), classified AS MATERIALIZED (
    SELECT l.id,l.full_name,l.phone,l.email,l.source,l.campaign_name,l.campaign_label,l.category,
      l.assigned_to_user_id,l.assigned_at,l.created_at,l.updated_at,l.last_call_at,l.next_followup_at,
      u.full_name AS assigned_to_name,
      COALESCE(ls.journey_stage, CASE WHEN l.call_status::text='not_called' THEN 'new' ELSE 'response' END) AS journey_stage,
      COALESCE(ls.terminal_state, CASE WHEN l.stage::text='won' OR l.call_status::text='converted' THEN 'converted' WHEN l.stage::text IN ('lost','dropped') OR l.call_status::text='not_interested' THEN 'cold' END) AS terminal_state,
      COALESCE(ls.last_call_result,l.call_status::text) AS last_call_result,
      row_to_json(a) AS current_action,
      a.action_type AS current_action_type,a.reason AS current_action_reason,a.due_at AS current_action_due_at,
      (EXISTS(SELECT 1 FROM lead_call_attempt_sequences seq WHERE seq.lead_id=l.id AND seq.status='active')
       OR COALESCE(ls.last_call_result,l.call_status::text) IN ('cnr','recall','so','cw','nn','nc','ni','in','cb','rnr','busy','call_cut_busy')) AS has_call_issue,
      EXISTS(SELECT 1 FROM lead_call_attempts ca JOIN lead_call_attempt_sequences seq ON seq.id=ca.sequence_id AND seq.status='active' WHERE ca.lead_id=l.id AND ca.status='scheduled' AND ca.scheduled_at<=NOW()) AS has_due_retry,
      ${onPeriod('COALESCE(l.assigned_at,l.created_at)')} AS is_received,
      EXISTS(SELECT 1 FROM lead_assignments ra WHERE ra.lead_id=l.id AND COALESCE(ra.assigned_to_user_id,ra.user_id)=l.assigned_to_user_id AND ra.previous_user_id IS NOT NULL AND ${onPeriod('ra.assigned_at')}) AS is_reassigned,
      (EXISTS(SELECT 1 FROM lead_lifecycle_events e WHERE e.lead_id=l.id AND e.event_type=ANY($4::text[]) AND e.occurred_at>=COALESCE(l.assigned_at,l.created_at))
       OR EXISTS(SELECT 1 FROM lead_remarks r WHERE r.lead_id=l.id AND r.workflow_step IS NOT NULL AND r.created_at>=COALESCE(l.assigned_at,l.created_at))
       OR EXISTS(SELECT 1 FROM lead_call_logs cl WHERE cl.lead_id=l.id AND cl.created_at>=COALESCE(l.assigned_at,l.created_at))
       OR EXISTS(SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id=l.id AND ca.status='completed' AND COALESCE(ca.attempted_at,ca.created_at)>=COALESCE(l.assigned_at,l.created_at))) AS is_worked,
      NOT (EXISTS(SELECT 1 FROM lead_lifecycle_events e WHERE e.lead_id=l.id AND e.event_type=ANY($4::text[]) AND e.occurred_at>=COALESCE(l.assigned_at,l.created_at))
       OR EXISTS(SELECT 1 FROM lead_remarks r WHERE r.lead_id=l.id AND r.workflow_step IS NOT NULL AND r.created_at>=COALESCE(l.assigned_at,l.created_at))
       OR EXISTS(SELECT 1 FROM lead_call_logs cl WHERE cl.lead_id=l.id AND cl.created_at>=COALESCE(l.assigned_at,l.created_at))
       OR EXISTS(SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id=l.id AND ca.status='completed' AND COALESCE(ca.attempted_at,ca.created_at)>=COALESCE(l.assigned_at,l.created_at))) AS is_unworked,
      ((a.status='overdue' OR (a.status='scheduled' AND a.due_at<=NOW()))
       OR EXISTS(SELECT 1 FROM lead_call_attempts ca JOIN lead_call_attempt_sequences seq ON seq.id=ca.sequence_id AND seq.status='active' WHERE ca.lead_id=l.id AND ca.status='scheduled' AND ca.scheduled_at<=NOW())
       OR (COALESCE(ls.terminal_state, CASE WHEN l.stage::text='won' OR l.call_status::text='converted' THEN 'converted' WHEN l.stage::text IN ('lost','dropped') OR l.call_status::text='not_interested' THEN 'cold' END) IS NULL
           AND a.id IS NULL AND NOT EXISTS(SELECT 1 FROM lead_call_attempt_sequences seq WHERE seq.lead_id=l.id AND seq.status='active'))) AS is_pending
    FROM leads l CROSS JOIN bounds b
    LEFT JOIN users u ON u.id=l.assigned_to_user_id
    LEFT JOIN lead_lifecycle_state ls ON ls.lead_id=l.id
    LEFT JOIN lead_actions a ON a.id=ls.current_primary_action_id AND a.status IN ('scheduled','in_progress','overdue')
    WHERE ${filterSql} AND l.assigned_to_user_id IS NOT NULL ${scopeSql}
  )`;
}

const VIEW_SQL = {
  received: 'is_received', new: 'is_received AND terminal_state IS NULL AND is_unworked', worked: 'is_received AND is_worked',
  pending: 'is_received AND terminal_state IS NULL AND is_pending', unworked: 'is_received AND terminal_state IS NULL AND is_unworked',
  reassigned: 'is_received AND is_reassigned', call_issues: 'is_received AND terminal_state IS NULL AND has_call_issue',
  follow_up: "is_received AND terminal_state IS NULL AND current_action_type IN ('follow_up','callback','recontact','responded_next_action')",
  responses: "is_received AND terminal_state IS NULL AND journey_stage='response'",
  common_meeting: "is_received AND terminal_state IS NULL AND journey_stage='common_meeting'",
  tte: "is_received AND terminal_state IS NULL AND journey_stage='tte'",
  personal_meeting: "is_received AND terminal_state IS NULL AND journey_stage='personal_meeting'",
  quotation: "is_received AND terminal_state IS NULL AND journey_stage='quotation'",
  converted: "is_received AND terminal_state='converted'", cold: "is_received AND terminal_state='cold'",
};

async function workspace(user, input = {}, includeRows = false) {
  const settings = await getSettings();
  const enabled = isEnabledFor(settings, user);
  const period = normalizeAnalyticsScope({ ...input, view: input.lead_view || 'daily' });
  const visible = await getVisibleUserIds(user);
  if (visible !== null && visible.length === 0) return { enabled, period, summary: {}, rows: [], total: 0, page: 1, page_size: 25 };
  const params = [period.from, period.to];
  const scopeSql = 'AND ($3::uuid[] IS NULL OR l.assigned_to_user_id=ANY($3::uuid[]))';
  params.push(visible);
  params.push(QUALIFYING_EVENTS);
  const filters = buildAnalyticsFilters(input, params, 'l');
  const cte = workspaceCte(period, scopeSql, filters.join(' AND '));
  const summarySql = Object.entries(VIEW_SQL).map(([key, condition]) => `COUNT(*) FILTER (WHERE ${condition})::int AS "${key}"`).join(',');
  if (!includeRows) {
    const { rows: [summary] } = await query(`${cte} SELECT ${summarySql} FROM classified`, params);
    return { enabled, period, summary };
  }
  const view = text(input.view || 'received').toLowerCase();
  if (!WORKSPACE_VIEWS.has(view)) throw new AppError(400, 'INVALID_WORKSPACE_VIEW', 'Select a valid Counselor Workspace view.');
  const page = positiveInt(input.page, 1, 100000);
  const pageSize = positiveInt(input.page_size, 25, 100);
  params.push(pageSize, (page - 1) * pageSize);
  const limitParam = `$${params.length - 1}`;
  const offsetParam = `$${params.length}`;
  const { rows: [result] } = await query(`${cte}, filtered AS MATERIALIZED (
    SELECT * FROM classified WHERE ${VIEW_SQL[view]}
  ), workspace_summary AS MATERIALIZED (
    SELECT ${summarySql} FROM classified
  ) SELECT to_jsonb(workspace_summary) AS summary,
    (SELECT COUNT(*)::int FROM filtered) AS total,
    COALESCE((SELECT jsonb_agg(to_jsonb(page_rows) ORDER BY current_action_due_at ASC NULLS LAST, assigned_at DESC) FROM (
      SELECT f.*,
        COALESCE(labels.items,'[]'::jsonb) AS labels,
        GREATEST(latest_remark.created_at,last_call.created_at,last_event.occurred_at) AS latest_interaction_at,
        latest_retry.scheduled_at AS next_retry_at,
        COALESCE(metrics.pending_occurrences,0)::int AS pending_occurrences,
        COALESCE(metrics.total_delay_minutes,0)::int AS total_delay_minutes,
        COALESCE(metrics.longest_delay_minutes,0)::int AS longest_delay_minutes
      FROM filtered f
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('id',ll.id,'name',ll.name,'color',ll.color) ORDER BY la.created_at DESC) AS items
          FROM lead_label_assignments la
          JOIN lead_labels ll ON ll.id=la.label_id AND ll.deleted_at IS NULL
         WHERE la.lead_id=f.id
      ) labels ON TRUE
      LEFT JOIN LATERAL (
        SELECT r.created_at FROM lead_remarks r WHERE r.lead_id=f.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1
      ) latest_remark ON TRUE
      LEFT JOIN LATERAL (
        SELECT cl.created_at FROM lead_call_logs cl WHERE cl.lead_id=f.id ORDER BY cl.created_at DESC,cl.id DESC LIMIT 1
      ) last_call ON TRUE
      LEFT JOIN LATERAL (
        SELECT e.occurred_at FROM lead_lifecycle_events e WHERE e.lead_id=f.id ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1
      ) last_event ON TRUE
      LEFT JOIN LATERAL (
        SELECT ca.scheduled_at
          FROM lead_call_attempts ca
          JOIN lead_call_attempt_sequences seq ON seq.id=ca.sequence_id AND seq.status='active'
         WHERE ca.lead_id=f.id AND ca.status='scheduled'
         ORDER BY ca.scheduled_at ASC LIMIT 1
      ) latest_retry ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE e.event_type='pending_started') AS pending_occurrences,
          COALESCE(SUM((e.metadata->>'delay_minutes')::int) FILTER (WHERE e.event_type='action_completed'),0) AS total_delay_minutes,
          COALESCE(MAX((e.metadata->>'delay_minutes')::int) FILTER (WHERE e.event_type='action_completed'),0) AS longest_delay_minutes
        FROM lead_lifecycle_events e WHERE e.lead_id=f.id
      ) metrics ON TRUE
      ORDER BY f.current_action_due_at ASC NULLS LAST, f.assigned_at DESC LIMIT ${limitParam} OFFSET ${offsetParam}
    ) page_rows),'[]'::jsonb) AS rows
  FROM workspace_summary`, params);
  return { enabled, period, summary: result.summary || {}, view, rows: result.rows || [], total: Number(result.total || 0), page, page_size: pageSize };
}

async function updateSettings(user, input = {}) {
  const allowed = new Set([
    'lifecycle_v2_enabled', 'lifecycle_v2_pilot_user_ids', 'first_contact_sla_minutes',
    'responded_sla_minutes', 'call_window_start', 'call_window_end', 'working_days',
    'common_meeting_start', 'common_meeting_end', 'common_meeting_outcome_deadline', 'stage_followup_max_attempts',
  ]);
  const entries = Object.entries(input).filter(([key]) => allowed.has(key));
  if (!entries.length) throw new AppError(400, 'NO_WORKFLOW_SETTINGS', 'No valid workflow settings were provided.');
  const next = Object.fromEntries(entries);
  const current = await getSettings();
  for (const key of ['lifecycle_v2_enabled']) {
    if (key in next && typeof next[key] !== 'boolean') throw new AppError(400, 'INVALID_WORKFLOW_SETTING', `${key} must be true or false.`);
  }
  if ('lifecycle_v2_pilot_user_ids' in next && (!Array.isArray(next.lifecycle_v2_pilot_user_ids)
    || next.lifecycle_v2_pilot_user_ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id))))) {
    throw new AppError(400, 'INVALID_WORKFLOW_SETTING', 'Pilot user IDs must be an array of UUIDs.');
  }
  for (const key of ['first_contact_sla_minutes', 'responded_sla_minutes', 'stage_followup_max_attempts']) {
    if (key in next && (!Number.isInteger(next[key]) || next[key] < 1 || next[key] > (key === 'stage_followup_max_attempts' ? 20 : 1440))) {
      throw new AppError(400, 'INVALID_WORKFLOW_SETTING', `${key} is outside the supported range.`);
    }
  }
  for (const key of ['call_window_start', 'call_window_end', 'common_meeting_start', 'common_meeting_end', 'common_meeting_outcome_deadline']) {
    if (key in next && !TIME_PATTERN.test(String(next[key]))) throw new AppError(400, 'INVALID_WORKFLOW_SETTING', `${key} must use HH:mm.`);
  }
  if ('working_days' in next && (!Array.isArray(next.working_days) || !next.working_days.length
    || next.working_days.some(day => !Number.isInteger(day) || day < 1 || day > 7))) {
    throw new AppError(400, 'INVALID_WORKFLOW_SETTING', 'working_days must contain ISO weekdays 1 through 7.');
  }
  const minutes = value => {
    const [hour, minute] = String(value).split(':').map(Number);
    return hour * 60 + minute;
  };
  const callStart = next.call_window_start ?? current.callWindowStart;
  const callEnd = next.call_window_end ?? current.callWindowEnd;
  if (minutes(callStart) >= minutes(callEnd)) {
    throw new AppError(400, 'INVALID_WORKFLOW_SETTING', 'Calling window end must be after its start.');
  }
  const meetingStart = next.common_meeting_start ?? current.commonMeetingStart;
  const meetingEnd = next.common_meeting_end ?? current.commonMeetingEnd;
  if (minutes(meetingStart) >= minutes(meetingEnd)) {
    throw new AppError(400, 'INVALID_WORKFLOW_SETTING', 'Common Meeting end must be after its start.');
  }
  await withTransaction(async client => {
    if (Array.isArray(next.lifecycle_v2_pilot_user_ids) && next.lifecycle_v2_pilot_user_ids.length) {
      const { rows: [found] } = await client.query(`SELECT COUNT(*)::int AS count FROM users WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL`, [next.lifecycle_v2_pilot_user_ids]);
      if (Number(found.count) !== new Set(next.lifecycle_v2_pilot_user_ids).size) {
        throw new AppError(400, 'INVALID_WORKFLOW_SETTING', 'One or more pilot users do not exist.');
      }
    }
    for (const [key, value] of entries) {
      await client.query(`UPDATE workflow_settings SET value=$2::jsonb,updated_by=$3,updated_at=NOW() WHERE key=$1`, [key, JSON.stringify(value), user.id]);
    }
  });
  return getSettings();
}

module.exports = {
  ACTION_TYPES, COLD_REASONS, EVENT_TYPES, JOURNEY_STAGES, WORKSPACE_VIEWS,
  getSettings, isEnabledFor, getLifecycle, recordEvent, completeAction, closeLifecycle,
  reopenLifecycle, workspace, updateSettings, ensureState, createPrimaryAction,
  clampToCallWindow, nextWorkingDeadline, publicSettings, normalizePeriod, syncLegacyRemark,
  syncLegacyLeadLevel, syncLegacyPersonalMeeting, applyStageFollowupPolicy,
};
