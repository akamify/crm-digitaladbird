const { query, withTransaction } = require('../config/database');
const logger = require('../utils/logger');
const lifecycle = require('../services/lifecycleService');
const notifications = require('../services/notificationService');

const TICK_MS = 60_000;
const BATCH_SIZE = 200;

async function repairLegacyMeetingDeadlines(settings) {
  const scopeIds = settings.enabled ? null : settings.pilotUserIds;
  if (!settings.enabled && scopeIds.length === 0) return 0;
  const { rows } = await query(`
    SELECT a.id,a.lead_id,a.status,e.occurred_at AS response_at
      FROM lead_actions a
      JOIN lead_lifecycle_state ls ON ls.lead_id=a.lead_id AND ls.current_primary_action_id=a.id
      JOIN leads l ON l.id=a.lead_id AND l.deleted_at IS NULL
      JOIN LATERAL (
        SELECT le.occurred_at
          FROM lead_lifecycle_events le
         WHERE le.lead_id=a.lead_id
           AND le.reason IN ('communication_completed','respond_hi')
           AND le.metadata->>'remark_id'=a.metadata->>'remark_id'
         ORDER BY le.occurred_at DESC,le.id DESC LIMIT 1
      ) e ON TRUE
     WHERE a.action_type IN ('lifecycle_review','responded_next_action','common_meeting')
       AND a.reason IN ('next_action_not_selected','responded_requires_next_action','common_meeting_outcome_not_updated')
       AND a.status IN ('scheduled','paused','overdue')
       AND ($1::uuid[] IS NULL OR l.assigned_to_user_id=ANY($1::uuid[]))
     ORDER BY a.updated_at ASC
     LIMIT $2`, [scopeIds, BATCH_SIZE]);

  let repaired = 0;
  for (const row of rows) {
    await withTransaction(async client => {
      const { rows: [action] } = await client.query(`
        SELECT a.id,a.status
          FROM lead_actions a
          JOIN lead_lifecycle_state ls ON ls.current_primary_action_id=a.id
         WHERE a.id=$1 AND a.action_type IN ('lifecycle_review','responded_next_action','common_meeting')
           AND a.reason IN ('next_action_not_selected','responded_requires_next_action','common_meeting_outcome_not_updated')
         FOR UPDATE OF a`, [row.id]);
      if (!action) return;
      const dueAt = lifecycle.nextWorkingDeadline(new Date(row.response_at), settings);
      await client.query(`
        UPDATE lead_actions
           SET action_type='common_meeting_outcome',reason='common_meeting_outcome_not_updated',
               parent_stage='common_meeting',scheduled_at=NULL,due_at=$2,
               status=CASE WHEN status='paused' THEN 'paused' WHEN $2<=NOW() THEN 'overdue' ELSE 'scheduled' END,
               metadata=(metadata - 'meeting_at') || $3::jsonb,updated_at=NOW()
         WHERE id=$1`, [row.id, dueAt.toISOString(), JSON.stringify({
        repaired_from_legacy_deadline: true,
        outcome_deadline_at: dueAt.toISOString(),
      })]);
      await client.query(`UPDATE lead_lifecycle_state SET journey_stage='common_meeting',version=version+1,updated_at=NOW() WHERE lead_id=$1`, [row.lead_id]);
      await client.query(`
        INSERT INTO lead_lifecycle_events(lead_id,event_type,stage_before,stage_after,action_id,reason,metadata)
        VALUES($1,'action_rescheduled','response','common_meeting',$2,'legacy_common_meeting_deadline_repaired',$3::jsonb)`, [
        row.lead_id, row.id, JSON.stringify({ outcome_deadline_at: dueAt.toISOString() }),
      ]);
      repaired += 1;
    });
  }
  return repaired;
}

async function realignActionOwners(settings) {
  const scopeIds = settings.enabled ? null : settings.pilotUserIds;
  if (!settings.enabled && scopeIds.length === 0) return 0;
  const result = await query(`
    WITH candidates AS (
      SELECT a.id,
             CASE WHEN a.action_type='manager_escalation'
                  THEN COALESCE(u.report_to_id,l.assigned_to_user_id)
                  ELSE l.assigned_to_user_id END AS desired_owner
        FROM lead_actions a
        JOIN leads l ON l.id=a.lead_id
        LEFT JOIN users u ON u.id=l.assigned_to_user_id
       WHERE a.status IN ('scheduled','in_progress','paused','overdue')
         AND l.deleted_at IS NULL
         AND ($1::uuid[] IS NULL OR l.assigned_to_user_id=ANY($1::uuid[]))
         AND a.responsible_user_id IS DISTINCT FROM
             CASE WHEN a.action_type='manager_escalation'
                  THEN COALESCE(u.report_to_id,l.assigned_to_user_id)
                  ELSE l.assigned_to_user_id END
       ORDER BY a.updated_at ASC
       LIMIT $2
    )
    UPDATE lead_actions a
       SET responsible_user_id=c.desired_owner,updated_at=NOW()
      FROM candidates c
     WHERE a.id=c.id`, [scopeIds, BATCH_SIZE]);
  return result.rowCount || 0;
}

async function materializeMissingActions(settings) {
  const scopeIds = settings.enabled ? null : settings.pilotUserIds;
  if (!settings.enabled && scopeIds.length === 0) return 0;
  const { rows } = await query(`
    SELECT l.id, l.assigned_at, l.created_at,
           COALESCE(ls.journey_stage, CASE WHEN l.call_status::text='not_called' THEN 'new' ELSE 'response' END) AS journey_stage
      FROM leads l
      LEFT JOIN lead_lifecycle_state ls ON ls.lead_id=l.id
     WHERE l.deleted_at IS NULL
       AND l.assigned_to_user_id IS NOT NULL
       AND ($1::uuid[] IS NULL OR l.assigned_to_user_id=ANY($1::uuid[]))
       AND COALESCE(ls.terminal_state, CASE WHEN l.stage::text='won' OR l.call_status::text='converted' THEN 'converted' WHEN l.stage::text IN ('lost','dropped') OR l.call_status::text='not_interested' THEN 'cold' END) IS NULL
       AND NOT EXISTS (SELECT 1 FROM lead_actions a WHERE a.lead_id=l.id AND a.is_primary=TRUE AND a.status IN ('scheduled','in_progress','paused','overdue'))
       AND NOT EXISTS (SELECT 1 FROM lead_call_attempt_sequences seq WHERE seq.lead_id=l.id AND seq.status='active')
     ORDER BY COALESCE(l.assigned_at,l.created_at) ASC
     LIMIT $2`, [scopeIds, BATCH_SIZE]);

  let created = 0;
  for (const lead of rows) {
    await withTransaction(async client => {
      const state = await lifecycle.ensureState(client, lead.id);
      const { rows: [exists] } = await client.query(`SELECT id FROM lead_actions WHERE lead_id=$1 AND is_primary=TRUE AND status IN ('scheduled','in_progress','paused','overdue') FOR UPDATE`, [lead.id]);
      if (exists || state.terminal_state) return;
      const isNew = state.journey_stage === 'new';
      const base = new Date(lead.assigned_at || lead.created_at || Date.now());
      const due = isNew
        ? lifecycle.clampToCallWindow(new Date(base.getTime() + settings.firstContactSlaMinutes * 60000), settings)
        : lifecycle.nextWorkingDeadline(new Date(), settings);
      const materializeKey = `materialize:${lead.id}:${state.version}:${isNew ? 'first-contact' : 'review'}`;
      const action = await lifecycle.createPrimaryAction(client, {
        leadId: lead.id,
        userId: null,
        actionType: isNew ? 'first_contact' : 'lifecycle_review',
        reason: isNew ? 'new_lead_first_contact' : 'active_lead_requires_next_action',
        parentStage: state.journey_stage,
        dueAt: due,
        idempotencyKey: materializeKey,
        metadata: { source: 'lifecycle_deadline_job' },
      });
      await client.query(`UPDATE lead_lifecycle_state SET current_primary_action_id=$2,version=version+1,updated_at=NOW() WHERE lead_id=$1`, [lead.id, action.id]);
      await client.query(`INSERT INTO lead_lifecycle_events(lead_id,event_type,stage_before,stage_after,action_id,reason,metadata) VALUES($1,'action_scheduled',$2,$2,$3,$4,$5::jsonb)`, [lead.id, state.journey_stage, action.id, action.reason, JSON.stringify({ idempotency_key: `${materializeKey}:event`, source: 'lifecycle_deadline_job' })]);
      created += 1;
    });
  }
  return created;
}

async function markOverdue(settings) {
  const scopeIds = settings.enabled ? null : settings.pilotUserIds;
  if (!settings.enabled && scopeIds.length === 0) return 0;
  const overdueActions = await withTransaction(async client => {
    const { rows } = await client.query(`
      SELECT a.id,a.lead_id,a.reason,a.parent_stage,a.action_type,a.due_at,
             COALESCE(a.responsible_user_id,l.assigned_to_user_id) AS responsible_user_id,
             l.full_name AS lead_name
        FROM lead_actions a
        JOIN leads l ON l.id=a.lead_id
       WHERE a.status='scheduled' AND a.due_at<=NOW()
         AND ($1::uuid[] IS NULL OR l.assigned_to_user_id=ANY($1::uuid[]))
       ORDER BY a.due_at ASC
       FOR UPDATE OF a SKIP LOCKED
       LIMIT $2`, [scopeIds, BATCH_SIZE]);
    for (const action of rows) {
      const pendingReason = ['common_meeting', 'common_meeting_outcome'].includes(action.action_type)
        ? 'COMMON_MEETING_OUTCOME_NOT_UPDATED'
        : action.reason;
      const { rows: [count] } = await client.query(`SELECT COUNT(*)::int AS value FROM lead_lifecycle_events WHERE lead_id=$1 AND event_type='pending_started'`, [action.lead_id]);
      const cycle = Number(count.value || 0) + 1;
      await client.query(`UPDATE lead_actions SET status='overdue',pending_cycle_number=$2,updated_at=NOW() WHERE id=$1`, [action.id, cycle]);
      await client.query(`
        INSERT INTO lead_lifecycle_events(lead_id,event_type,stage_before,stage_after,action_id,reason,metadata)
        VALUES($1,'pending_started',$2,$2,$3,$4,$5::jsonb)
        ON CONFLICT DO NOTHING`, [action.lead_id, action.parent_stage, action.id, pendingReason, JSON.stringify({ idempotency_key: `pending:${action.id}`, pending_cycle_number: cycle, due_at: action.due_at })]);
    }
    return rows;
  });
  for (const action of overdueActions) {
    await notifications.createUserNotification({
      userId: action.responsible_user_id,
      type: 'lifecycle_action_overdue',
      title: 'Required lead action is overdue',
      body: `${action.lead_name || 'A lead'} needs ${String(action.action_type || 'an action').replace(/_/g, ' ')}.`,
      eventType: 'lifecycle_action_overdue',
      entityType: 'lead',
      entityId: action.lead_id,
      dedupeKey: `lifecycle-overdue:${action.id}`,
      metadata: { lead_id: action.lead_id, action_id: action.id, due_at: action.due_at, reason: action.reason },
      emailEnabled: false,
    });
  }
  return overdueActions.length;
}

async function tick() {
  try {
    const settings = await lifecycle.getSettings();
    if (!settings.enabled && settings.pilotUserIds.length === 0) return { skipped: true };
    const reassigned = await realignActionOwners(settings);
    const repaired = await repairLegacyMeetingDeadlines(settings);
    const created = await materializeMissingActions(settings);
    const overdue = await markOverdue(settings);
    if (reassigned || repaired || created || overdue) logger.info({ reassigned, repaired, created, overdue }, '[LifecycleV2] deadline tick');
    return { reassigned, repaired, created, overdue };
  } catch (error) {
    logger.error({ error: error.message }, '[LifecycleV2] deadline tick failed');
    return { error: error.message };
  }
}

function startLifecycleDeadlineJob() {
  tick().catch(() => {});
  return setInterval(() => tick().catch(() => {}), TICK_MS);
}

module.exports = { startLifecycleDeadlineJob, tick, realignActionOwners, repairLegacyMeetingDeadlines, materializeMissingActions, markOverdue };
