const { createHash } = require('crypto');
const { AppError } = require('../utils/errors');
const { journeyDeadlines, newAssignmentDeadlines, CALL_ISSUE_STATUSES } = require('./counselorWorkflowPolicies');
const rollout = require('./counselorWorkflowRollout');

const STATUS_VALUES = new Set([
  'communication_completed', 'respond_hi', 'common_meeting', 'dim', 'personal_meeting',
  'follow_up', 'quotation', 'hot', 'warm', 'special_category', 'call_reminder',
  'handover_rm', 'not_attended', 'converted', 'cold', 'process_incomplete',
  'cnr', 'call_cut_busy', 'cw', 'so', 'nn', 'nc', 'busy', 'cb', 'rnr', 'recall',
  'nrac', 'nracm', 'nrapm', 'nraf', 'nraq', 'ni', 'in', 'invalid_number',
  'interested', 'not_interested', 'callback_requested', 'custom_remark',
  'session_730_attend', 'yes_after_730_session', 'switched_off', 'ccb',
  'talk_response', 'wrong_number', 'language_barrier',
]);
const COUNSELORS = new Set(['member', 'partner']);
const TERMINAL = new Set(['converted', 'cold', 'not_interested']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(status, code, message) { throw new AppError(status, code, message); }
function validateStatuses(statuses, primaryStatus) {
  if (!Array.isArray(statuses) || !statuses.length || statuses.length > 32
      || statuses.some(status => typeof status !== 'string' || !STATUS_VALUES.has(status))) {
    fail(400, 'INVALID_WORKFLOW_STATUSES', 'Submit supported workflow statuses.');
  }
  if (!primaryStatus || !statuses.includes(primaryStatus)) {
    fail(400, 'PRIMARY_STATUS_REQUIRED', 'Select one primary_status from the submitted statuses.');
  }
  return [...new Set(statuses)];
}
function instant(value, name) {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(400, 'INVALID_WORKFLOW_TIME', `${name} must be an ISO timestamp with a timezone.`);
  }
  return new Date(value).toISOString();
}
function snapshot(state) {
  return state ? { primary_status: state.primary_status, journey_active: state.journey_active,
    queue: state.queue, generation: state.generation, policy_version: state.policy_version,
    assignment_id: state.assignment_id, assignment_at: state.assignment_at,
    assigned_to_user_id: state.assigned_to_user_id, awaiting_primary: state.awaiting_primary,
    move_to_old_at: state.move_to_old_at, move_to_pending_at: state.move_to_pending_at,
    followup_override: state.followup_override } : null;
}

// SQL is selected exclusively from this allowlist. Counts and lists share it.
function membership(view) {
  // Stage 1 tab keys differ from the existing stored status names.
  if (view === 'cc') view = 'communication_completed';
  if (view === 'responded') view = 'respond_hi';
  if (view === 'received') return 'TRUE'; // Current managed assignments, regardless of queue.
  if (view === 'call_issues') return `s.journey_active AND s.primary_status IN (${CALL_ISSUE_STATUSES.map(status => `'${status}'`).join(',')})`;
  if (view === 'all') return 'TRUE';
  if (['new', 'old', 'pending'].includes(view)) return `s.queue = '${view}'`;
  if (STATUS_VALUES.has(view)) return `s.journey_active AND s.primary_status = '${view}'`;
  fail(400, 'INVALID_WORKFLOW_VIEW', 'Select a supported workflow view.');
}

function createService(db, options = {}) {
  function rolloutAt() {
    return rollout.configuration(options).cutoff;
  }
  const cutoffFor = user => rollout.cutoffFor(rollout.configuration(options),user);
  const configuration = user => ({enabled:Boolean(cutoffFor(user))});
  async function lockLead(client, leadId, user) {
    if (!UUID.test(leadId)) fail(400, 'INVALID_LEAD_ID', 'Invalid lead ID.');
    // pg's default Date parser loses microseconds. Preserve assignment identity
    // as text so stored state and SQL membership compare the same timestamp.
    const { rows: [lead] } = await client.query(`SELECT l.*, l.assigned_at::text AS assigned_at, u.role AS owner_role
      FROM leads l LEFT JOIN users u ON u.id=l.assigned_to_user_id
      WHERE l.id=$1 AND l.deleted_at IS NULL FOR UPDATE OF l`, [leadId]);
    if (!lead) fail(404, 'LEAD_NOT_FOUND', 'Lead not found.');
    if (user && (!COUNSELORS.has(user.role) || lead.assigned_to_user_id !== user.id)) {
      fail(403, 'WORKFLOW_FORBIDDEN', 'Only the assigned counselor can use this workflow.');
    }
    return lead;
  }
  async function readState(client, leadId) {
    return (await client.query('SELECT *, assignment_at::text AS assignment_at FROM counselor_workflow_state WHERE lead_id=$1 FOR UPDATE', [leadId])).rows[0] || null;
  }
  async function assignment(client, lead) {
    return (await client.query(`SELECT id, assigned_at::text AS assigned_at, previous_user_id FROM lead_assignments
      WHERE lead_id=$1 AND COALESCE(assigned_to_user_id,user_id)=$2 AND unassigned_at IS NULL
      ORDER BY assigned_at DESC, id DESC LIMIT 1`, [lead.id, lead.assigned_to_user_id])).rows[0] || null;
  }
  async function save(client, state) {
    const fields = ['primary_status','journey_active','queue','policy_version','generation',
      'assigned_to_user_id','assignment_id','assignment_at','enrolled_at','workflow_started_at',
      'move_to_old_at','move_to_pending_at','followup_override','awaiting_primary'];
    const values = fields.map(key => state[key] ?? null);
    const { rows: [saved] } = await client.query(`INSERT INTO counselor_workflow_state
      (lead_id,${fields.join(',')}) VALUES ($1,${fields.map((_, i) => `$${i + 2}`).join(',')})
      ON CONFLICT (lead_id) DO UPDATE SET ${fields.map(key => `${key}=EXCLUDED.${key}`).join(',')},updated_at=NOW()
      RETURNING *, assignment_at::text AS assignment_at`, [state.lead_id, ...values]);
    return saved;
  }
  async function event(client, before, after, input) {
    const { rows: [row] } = await client.query(`INSERT INTO counselor_workflow_events
      (lead_id,event_type,actor_id,source,occurred_at,primary_status,statuses,previous_state,new_state,
       generation,origin_id,idempotency_key,request_hash,work_source,is_work,metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16::jsonb) RETURNING *`,
    [after.lead_id,input.type,input.actorId || null,input.source,input.at || new Date(),after.primary_status,
      JSON.stringify(input.statuses || []),JSON.stringify(snapshot(before)),JSON.stringify(snapshot(after)),
      after.generation,input.originId || null,input.key,input.hash || null,input.workSource || null,
      Boolean(input.isWork),JSON.stringify(input.metadata || {})]);
    return row;
  }
  async function duplicate(client, leadId, key, hash) {
    const row = (await client.query('SELECT * FROM counselor_workflow_events WHERE lead_id=$1 AND idempotency_key=$2', [leadId,key])).rows[0];
    if (row && hash && row.request_hash !== hash) fail(409, 'IDEMPOTENCY_CONFLICT', 'This request key was already used for different input.');
    return row || null;
  }
  function matchesAssignment(state, lead) {
    return state && state.assigned_to_user_id === lead.assigned_to_user_id
      && state.assignment_at === lead.assigned_at;
  }
  async function counselorRemark(client, lead, excludedId = null) {
    return (await client.query(`SELECT id,call_statuses FROM lead_remarks
      WHERE lead_id=$1 AND created_at >= $2 AND user_id=$3
      AND ($4::uuid IS NULL OR id <> $4::uuid)
      ORDER BY created_at DESC,id DESC LIMIT 1`, [lead.id,lead.assigned_at,lead.assigned_to_user_id,
      UUID.test(excludedId || '') ? excludedId : null])).rows[0] || null;
  }
  async function ensureState(client, lead, at = new Date(), currentRemarkId = null) {
    let state = await readState(client, lead.id);
    if (matchesAssignment(state, lead)) return state;
    const previous = state;
    const assigned = await assignment(client, lead);
    const cutoff = cutoffFor({id:lead.assigned_to_user_id,role:lead.owner_role});
    const recent = cutoff && lead.assigned_at && new Date(lead.assigned_at) >= new Date(cutoff);
    const evidence = await counselorRemark(client,lead,currentRemarkId);
    // A changed owner/timestamp alone is not an approved reassignment. Require
    // a fresh assignment-history record before starting another New timeout.
    const freshAssignment = assigned && new Date(assigned.assigned_at) >= new Date(cutoff)
      && assigned.id !== previous?.assignment_id && assigned.assigned_at === lead.assigned_at;
    const isNew = recent && (!previous || freshAssignment) && !evidence
      && !['won','lost','dropped'].includes(lead.stage)
      && !['converted','not_interested'].includes(lead.call_status);
    state = await save(client, { lead_id: lead.id, primary_status: isNew ? null : previous?.primary_status || null,
      journey_active: false, queue: isNew ? 'new' : null, policy_version: 'foundation_v1',
      generation: (previous?.generation || 0) + 1, assigned_to_user_id: lead.assigned_to_user_id,
      assignment_id: assigned?.id || null, assignment_at: lead.assigned_at,
      enrolled_at: previous?.enrolled_at || at, workflow_started_at: isNew ? lead.assigned_at : at,
      move_to_old_at: null, move_to_pending_at: null, followup_override: Boolean(lead.next_followup_at), awaiting_primary: !isNew,
      ...(isNew ? newAssignmentDeadlines(lead.assigned_at) : {}) });
    await event(client, previous, state, { type: previous ? 'assignment_changed' : 'workflow_enrolled',
      source: 'assignment', key: `assignment:${state.generation}:${assigned?.id || 'none'}`,
      at: isNew ? lead.assigned_at : at, metadata: { prospective: true, legacy_state_not_reconstructed: !isNew } });
    return state;
  }
  function checkGeneration(state, expected) {
    if (!Number.isSafeInteger(expected) || expected < 0 || expected !== (state?.generation || 0)) {
      fail(409, 'WORKFLOW_GENERATION_CONFLICT', 'Workflow changed. Reload before saving.');
    }
  }

  async function applyRemark(client, { lead, user, primaryStatus, statuses, remarkId, source, key, hash, followupAt, explicit }) {
    const startedAt = options.now ? new Date(options.now()) : new Date();
    const prior = await ensureState(client, lead, startedAt, remarkId);
    const isWork = COUNSELORS.has(user.role) && user.id === lead.assigned_to_user_id;
    const workSource = isWork && ['new','old'].includes(prior.queue) ? prior.queue : null;
    const terminal = explicit && TERMINAL.has(primaryStatus);
    const deadlines = explicit ? journeyDeadlines(primaryStatus, startedAt) : null;
    const after = await save(client, { ...prior, primary_status: explicit ? primaryStatus : prior.primary_status,
      journey_active: explicit, queue: null, awaiting_primary: !explicit,
      generation: prior.generation + 1, workflow_started_at: startedAt,
      move_to_old_at: null, move_to_pending_at: null,
      followup_override: terminal ? false : Boolean(followupAt || lead.next_followup_at),
      policy_version: 'foundation_v1', ...deadlines });
    const recorded = await event(client, prior, after, { type: explicit ? 'remark_saved' : 'legacy_activity_observed',
      actorId: user.id, source, originId: remarkId, statuses, key, hash, workSource, isWork, at: startedAt,
      metadata: { explicit_primary: explicit, custom_followup_at: followupAt || null } });
    return { state: after, event: recorded, duplicate: false };
  }

  // Legacy adapters never guess the primary from array order. A legacy save
  // invalidates managed deadlines and requires an explicit primary next time.
  async function observeRemark({ client, leadId, user, remarkId, statuses = [], primaryStatus, source = 'legacy_remark', followupAt = null }) {
    if (!rolloutAt()) {
      if (primaryStatus !== undefined) fail(409, 'WORKFLOW_DISABLED', 'Counselor workflow is not enabled.');
      return { enabled: false };
    }
    if (primaryStatus !== undefined) validateStatuses(statuses, primaryStatus);
    const lead = await lockLead(client, leadId, primaryStatus !== undefined ? user : null);
    if (!cutoffFor({id:lead.assigned_to_user_id,role:lead.owner_role})) {
      if (primaryStatus !== undefined) fail(409,'WORKFLOW_DISABLED','Counselor workflow is not enabled.');
      return { enabled: false };
    }
    if (!COUNSELORS.has(user.role) || user.id !== lead.assigned_to_user_id) {
      const current = await readState(client,leadId);
      if (!current) return { enabled:false };
      // Assignment context from another actor is not counselor work. Terminal
      // legacy changes still invalidate New rather than leaving it to expire.
      if (current.queue === 'new' && !['won','lost','dropped'].includes(lead.stage)
          && !['converted','not_interested'].includes(lead.call_status)) return { enabled:false };
    }
    if (!remarkId || String(remarkId).length > 128) fail(400,'INVALID_WORK_ORIGIN','A durable activity identifier is required.');
    const key = `remark:${remarkId}`;
    const found = await duplicate(client, leadId, key);
    if (found) return { duplicate: true, event: found };
    return applyRemark(client, { lead, user, primaryStatus, statuses, remarkId, source, key,
      followupAt, explicit: primaryStatus !== undefined });
  }

  // Non-remark legacy commands may replace or close a journey. Invalidate only
  // an existing managed state; do not manufacture work or enroll old records.
  async function invalidateLegacy({client,leadId,user,origin}) {
    if (!rolloutAt()) return {enabled:false};
    const lead = await lockLead(client,leadId);
    if (!cutoffFor({id:lead.assigned_to_user_id,role:lead.owner_role})) return {enabled:false};
    const state = await readState(client,leadId);
    if (!state) return {enabled:false};
    const key = `legacy-state:${createHash('sha256').update(String(origin)).digest('hex')}`;
    if (await duplicate(client,leadId,key)) return {duplicate:true};
    const after = await save(client,{...state,generation:state.generation+1,journey_active:false,
      queue:null,awaiting_primary:true,move_to_old_at:null,move_to_pending_at:null,
      followup_override:Boolean(lead.next_followup_at)});
    await event(client,state,after,{type:'legacy_state_changed',source:'legacy_lifecycle',actorId:user.id,key});
    return {invalidated:true};
  }

  // New clients use this versioned command for end-to-end request idempotency.
  async function recordRemark(user, leadId, input) {
    if (!COUNSELORS.has(user.role)) fail(403,'WORKFLOW_FORBIDDEN','Counselor access required.');
    if (!cutoffFor(user)) fail(409, 'WORKFLOW_DISABLED', 'Counselor workflow is not enabled.');
    const statuses = validateStatuses(input.statuses, input.primary_status);
    if (typeof input.idempotency_key !== 'string' || !/^[\w:.-]{1,128}$/.test(input.idempotency_key)) fail(400, 'INVALID_IDEMPOTENCY_KEY', 'Provide a valid idempotency_key.');
    if (input.remark != null && (typeof input.remark !== 'string' || input.remark.length > 10000)) fail(400, 'INVALID_REMARK', 'Remark must contain at most 10000 characters.');
    const followupProvided = Object.prototype.hasOwnProperty.call(input, 'next_followup_at');
    const followupAt = followupProvided ? (input.next_followup_at === null ? null : instant(input.next_followup_at, 'next_followup_at')) : undefined;
    const payload = { statuses: [...statuses].sort(), primary: input.primary_status, remark: input.remark || '', followupAt };
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const key = `request:${user.id}:${input.idempotency_key}`;
    return db.withTransaction(async client => {
      const lead = await lockLead(client, leadId, user);
      const found = await duplicate(client, leadId, key, hash);
      if (found) return { duplicate: true, event: found, state: await readState(client, leadId) };
      checkGeneration(await readState(client, leadId), input.expected_generation);
      const effectiveFollowup = followupProvided ? followupAt : lead.next_followup_at;
      const { rows: [remark] } = await client.query(`INSERT INTO lead_remarks(lead_id,user_id,remark,next_followup_at,call_statuses,source)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING id`, [leadId,user.id,input.remark?.trim() || `Status: ${input.primary_status}`,effectiveFollowup,JSON.stringify(statuses),'counselor_workflow_v1']);
      // Reuse the existing follow-up field. No new reminder scheduler is added.
      if (followupProvided) await client.query('UPDATE leads SET next_followup_at=$2,updated_at=NOW() WHERE id=$1', [leadId,followupAt]);
      lead.next_followup_at = effectiveFollowup;
      return applyRemark(client, { lead, user, primaryStatus: input.primary_status, statuses,
        remarkId: remark.id, source: 'counselor_workflow_v1', key, hash, followupAt: effectiveFollowup, explicit: true });
    });
  }

  // Internal deadline replacement seam. Main journey policies are persisted
  // atomically with the remark above; no HTTP endpoint accepts aging deadlines.
  async function schedule(client, { leadId, expectedGeneration, policyVersion, moveToOldAt = null, moveToPendingAt = null, idempotencyKey }) {
    if (!rolloutAt()) fail(409, 'WORKFLOW_DISABLED', 'Counselor workflow is not enabled.');
    const lead = await lockLead(client, leadId);
    if (!cutoffFor({id:lead.assigned_to_user_id,role:lead.owner_role})) fail(409,'WORKFLOW_DISABLED','Counselor workflow is not enabled.');
    const state = await readState(client, leadId);
    if (typeof policyVersion !== 'string' || !/^[\w.-]{1,64}$/.test(policyVersion) || typeof idempotencyKey !== 'string' || !/^[\w:.-]{1,128}$/.test(idempotencyKey)) fail(400, 'INVALID_POLICY', 'Policy version and key are required.');
    const oldAt = moveToOldAt ? instant(moveToOldAt, 'moveToOldAt') : null;
    const pendingAt = moveToPendingAt ? instant(moveToPendingAt, 'moveToPendingAt') : null;
    const key = `schedule:${idempotencyKey}`;
    const hash = createHash('sha256').update(JSON.stringify([expectedGeneration,policyVersion,oldAt,pendingAt])).digest('hex');
    const found = await duplicate(client, leadId, key, hash);
    if (found) return { duplicate: true, state };
    checkGeneration(state, expectedGeneration);
    if (!state || !matchesAssignment(state, lead) || state.awaiting_primary || TERMINAL.has(state.primary_status)) fail(409, 'WORKFLOW_NOT_ACTIONABLE', 'Workflow cannot be scheduled.');
    if (oldAt && (!state.journey_active || !state.primary_status || state.queue === 'old')) fail(400, 'INVALID_OLD_TRANSITION', 'Only an active remark journey can age into Old.');
    if (state.queue === 'pending' || (oldAt && pendingAt && oldAt > pendingAt)) fail(400, 'INVALID_DEADLINES', 'Invalid queue deadlines.');
    const after = await save(client, { ...state, generation: state.generation + 1, policy_version: policyVersion, move_to_old_at: oldAt, move_to_pending_at: pendingAt });
    await event(client,state,after,{ type: 'deadlines_scheduled', source: 'policy', key, hash });
    return { state: after };
  }

  async function processDeadline({ leadId, generation, kind, dueAt }, now = new Date()) {
    if (!rolloutAt()) return { skipped: true };
    return db.withTransaction(async client => {
      const lead = await lockLead(client, leadId);
      if (!cutoffFor({id:lead.assigned_to_user_id,role:lead.owner_role})) return { skipped:true };
      const state = await readState(client, leadId);
      if (state?.followup_override || lead.next_followup_at) {
        log('info',{event:'override_skipped',lead_id:leadId,generation,transition:kind});
        return {stale:true};
      }
      if (!state || state.generation !== generation || !matchesAssignment(state,lead)
          || !COUNSELORS.has(lead.owner_role) || state.awaiting_primary || state.followup_override || lead.next_followup_at
          || TERMINAL.has(state.primary_status)) return { stale: true };
      if (!['old','pending'].includes(kind)) fail(400,'INVALID_TRANSITION','Unknown deadline type.');
      const deadline = kind === 'old' ? state.move_to_old_at : state.move_to_pending_at;
      if (!deadline || new Date(deadline).getTime() !== new Date(dueAt).getTime() || new Date(deadline) > now) return { stale: true };
      // A legacy import may write a counselor note outside the remark adapter.
      // Recheck untouched New under the lead lock before applying its timeout.
      if (state.queue === 'new') {
        const remark = await counselorRemark(client,lead);
        if (remark) {
          await observeRemark({client,leadId,user:{id:lead.assigned_to_user_id,role:lead.owner_role},
            remarkId:remark.id,statuses:remark.call_statuses || [],source:'legacy_remark_reconciled'});
          return { stale:true };
        }
      }
      // Old must be recorded first if both deadlines elapsed during downtime.
      if (kind === 'pending' && state.move_to_old_at) return { deferred: true };
      if (kind === 'old' && (!state.journey_active || !state.primary_status || state.queue)) return { stale: true };
      const key = `deadline:${generation}:${kind}:${new Date(deadline).toISOString()}`;
      if (await duplicate(client,leadId,key)) return { duplicate: true };
      const after = await save(client, { ...state, queue: kind,
        journey_active: kind === 'old', move_to_old_at: null,
        move_to_pending_at: kind === 'pending' ? null : state.move_to_pending_at });
      await event(client,state,after,{ type: `entered_${kind}`,source:'deadline',key,at:deadline });
      return { transitioned: true, state: after };
    });
  }

  async function tickBatch(limit = 100) {
    const cutoff = rolloutAt();
    if (!cutoff) return { skipped: true };
    limit = Math.max(1,Math.min(200,Math.floor(Number(limit)) || 100));
    const config = rollout.configuration(options);
    const pilots = JSON.stringify(config.pilots);
    const { rows: assignments } = await db.query(`SELECT l.id FROM leads l JOIN users u ON u.id=l.assigned_to_user_id
      LEFT JOIN counselor_workflow_state s ON s.lead_id=l.id
      WHERE l.deleted_at IS NULL AND u.role IN ('member','partner')
      AND ($3='all' OR $4::jsonb ? l.assigned_to_user_id::text)
      AND COALESCE(($4::jsonb->>l.assigned_to_user_id::text)::timestamptz,$1::timestamptz)<=NOW()
      AND l.assigned_at >= COALESCE(($4::jsonb->>l.assigned_to_user_id::text)::timestamptz,$1::timestamptz)
      AND (s.lead_id IS NULL OR s.assigned_to_user_id IS DISTINCT FROM l.assigned_to_user_id
        OR s.assignment_at IS DISTINCT FROM l.assigned_at)
      ORDER BY l.assigned_at,l.id LIMIT $2`,[cutoff,limit,config.mode,pilots]);
    let failed = 0;
    let enrolled = 0;
    for (const row of assignments) try { const applied = await db.withTransaction(async client => {
      const lead = await lockLead(client,row.id);
      const start = cutoffFor({id:lead.assigned_to_user_id,role:lead.owner_role});
      if (start && new Date(lead.assigned_at) >= new Date(start)) { await ensureState(client,lead); return true; }
      return false;
    }); if(applied) enrolled++; } catch(error) { failed++; log('error',{event:'enrollment_failed',lead_id:row.id,code:error.code}); }
    const { rows } = await db.query(`SELECT s.lead_id,s.generation,
      CASE WHEN s.move_to_old_at IS NOT NULL THEN 'old' ELSE 'pending' END AS kind,
      COALESCE(s.move_to_old_at,s.move_to_pending_at) AS due_at
      FROM counselor_workflow_state s JOIN leads l ON l.id=s.lead_id JOIN users u ON u.id=l.assigned_to_user_id
      WHERE NOT s.followup_override AND NOT s.awaiting_primary AND l.deleted_at IS NULL
      AND l.next_followup_at IS NULL AND u.role IN ('member','partner')
      AND ($2='all' OR $3::jsonb ? l.assigned_to_user_id::text)
      AND COALESCE(($3::jsonb->>l.assigned_to_user_id::text)::timestamptz,$4::timestamptz)<=NOW()
      AND s.assigned_to_user_id=l.assigned_to_user_id AND s.assignment_at IS NOT DISTINCT FROM l.assigned_at
      AND (s.move_to_old_at <= NOW() OR (s.move_to_old_at IS NULL AND s.move_to_pending_at <= NOW()))
      ORDER BY COALESCE(s.move_to_old_at,s.move_to_pending_at),s.lead_id LIMIT $1`,[limit,config.mode,pilots,cutoff]);
    let transitioned = 0;
    for (const row of rows) {
      try {
      const result = await processDeadline({ leadId:row.lead_id,generation:row.generation,kind:row.kind,dueAt:row.due_at });
      if (result.transitioned) transitioned++;
      log('info',{event:result.transitioned?'transition_success':result.duplicate?'duplicate_skipped':result.stale?'stale_skipped':'transition_skipped',
        lead_id:row.lead_id,generation:row.generation,transition:row.kind,policy_version:result.state?.policy_version,
        deadline_lag_ms:Math.max(0,Date.now()-new Date(row.due_at).getTime())});
      } catch(error) { failed++; log('error',{event:'transition_failed',lead_id:row.lead_id,generation:row.generation,transition:row.kind,code:error.code}); }
    }
    return { enrolled, transitioned, failed, selected:rows.length };
  }
  function log(level,fields) {
    if (options.logger === false) return;
    (options.logger || require('../utils/logger'))[level]({component:'counselor_workflow',...fields},'Counselor workflow');
  }
  async function tick(limit = 100) {
    if (options.workerEnabled === false || process.env.COUNSELOR_WORKFLOW_WORKER_ENABLED === 'false') return {skipped:true};
    if (!rolloutAt()) return {skipped:true};
    const started = Date.now();
    try {
      // Transaction-scoped advisory lock is released automatically on crash.
      // The coordinator uses one connection; per-lead transactions use another.
      return await db.withTransaction(async client => {
        const {rows:[lock]} = await client.query('SELECT pg_try_advisory_xact_lock(74001,1) AS acquired');
        if (!lock.acquired) { log('info',{event:'worker_lock_skipped'}); return {skipped:true}; }
        const result = await tickBatch(limit);
        log('info',{event:'worker_batch',...result,duration_ms:Date.now()-started});
        return result;
      });
    } catch(error) { log('error',{event:'worker_batch_failed',code:error.code,duration_ms:Date.now()-started}); throw error; }
  }

  async function read(user, leadId, input = {}) {
    return db.withTransaction(async client => {
      if (!COUNSELORS.has(user.role)) fail(403,'WORKFLOW_FORBIDDEN','Counselor access required.');
      const lead = await lockLead(client,leadId);
      const readOnly = lead.assigned_to_user_id !== user.id;
      if (readOnly && !(await client.query('SELECT 1 FROM lead_assignments WHERE lead_id=$1 AND previous_user_id=$2 LIMIT 1',[leadId,user.id])).rows.length) {
        fail(403,'WORKFLOW_FORBIDDEN','Lead access denied.');
      }
      if (!cutoffFor(user)) return { enabled:false,managed:false,state:null,events:[] };
      const state = await readState(client,leadId);
      const page = Math.max(1,Math.min(100000,Number.parseInt(input.page,10) || 1));
      const { rows: events } = await client.query(`SELECT * FROM counselor_workflow_events
        WHERE lead_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 51 OFFSET $2`,[leadId,(page-1)*50]);
      return { enabled:true,managed:Boolean(state),read_only:readOnly,status_options:[...STATUS_VALUES],
        assignment_current: Boolean(matchesAssignment(state,lead)),state,events:events.slice(0,50),has_more:events.length>50,page,page_size:50 };
    });
  }
  async function workspace(user, input = {}) {
    if (!COUNSELORS.has(user.role)) fail(403,'WORKFLOW_FORBIDDEN','Counselor access required.');
    // Reading the counselor workspace is always available; rollout only controls mutations.
    return {...await require('./counselorWorkspaceService').workspace(db,user,input,membership),
      remarks_enabled:Boolean(cutoffFor(user)),status_options:[...STATUS_VALUES]};
  }
  return { rolloutAt, configuration, observeRemark, invalidateLegacy, recordRemark, schedule, processDeadline, tick, read, workspace };
}

const service = createService(require('../config/database'));
module.exports = { ...service, createService, validateStatuses, membership, STATUS_VALUES };
