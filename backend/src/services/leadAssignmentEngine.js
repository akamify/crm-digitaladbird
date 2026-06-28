/**
 * Production lead assignment engine.
 *
 * This module is additive: it preserves existing lead/request columns while
 * writing the richer assignment columns introduced in migration 035.
 */
const { query, withTransaction } = require('../config/database');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');
const { assertLeadAssigneeUser, validateLeadAssignee } = require('./leadAssigneeValidator');
const { notifyLeadAssigned, notifyLeadRequestResolved } = require('./notificationService');

const DEFAULT_RULE_NAME = '__assignment_engine_default__';
const RM_POOL_RULE_NAME = '__assignment_engine_rm_pool__';
const CLOSED_STAGES = new Set(['won', 'lost', 'dropped']);
const CLOSED_CALL_STATUSES = new Set(['converted', 'not_interested', 'wrong_number', 'invalid_number']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function asInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function leadAvailabilitySql(alias) {
  return `
    COALESCE(${alias}.lead_assignment_enabled, COALESCE(${alias}.is_available, TRUE)) = TRUE
    AND COALESCE(${alias}.lead_assignment_status,
      CASE WHEN COALESCE(${alias}.is_available, TRUE) THEN 'available' ELSE 'unavailable' END
    ) = 'available'
  `;
}

async function settingRows(client = null) {
  const runner = client || { query };
  const { rows } = await runner.query(`SELECT key, value FROM distribution_settings`);
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function getAssignmentSettings(client = null) {
  const s = await settingRows(client);
  return {
    autoAssignEnabled: asBool(s.auto_assign_enabled ?? s.auto_distribution_enabled, false),
    assignStartHour: asInt(s.assign_start_hour ?? s.distribution_start_hour, 8),
    assignEndHour: asInt(s.assign_end_hour ?? s.distribution_end_hour, 19),
    timezone: s.assignment_timezone || s.distribution_timezone || 'Asia/Kolkata',
    scheduledAssignmentTime: s.scheduled_assignment_time || '',
    scheduledTimezone: s.scheduled_timezone || s.assignment_timezone || s.distribution_timezone || 'Asia/Kolkata',
    maxLeadsPerScheduledRun: Math.max(1, asInt(s.max_leads_per_scheduled_run ?? s.assignment_tick_limit, 100)),
    lastScheduledRunAt: s.last_scheduled_run_at || null,
    nextScheduledRunAt: s.next_scheduled_run_at || null,
    isDistributionRunning: asBool(s.is_distribution_running, false),
    lastDistributionStatus: s.last_distribution_status || null,
    lastDistributionError: s.last_distribution_error || null,
    autoAssignApprovedRequests: asBool(s.auto_assign_approved_requests, false),
    autoReassignEnabled: asBool(s.auto_reassign_enabled, false),
    reassignAfterHours: Math.max(1, asInt(s.reassign_after_hours, 24)),
    reassignToHighPerformers: asBool(s.reassign_to_high_performers, true),
    assignmentTickLimit: Math.max(1, asInt(s.assignment_tick_limit, 100)),
    requestFulfillmentLimit: Math.max(1, asInt(s.request_fulfillment_limit, 100)),
    reassignmentTickLimit: Math.max(1, asInt(s.reassignment_tick_limit, 50)),
  };
}

function hourInTimezone(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'Asia/Kolkata',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now || new Date());
  const hour = Number(parts.find(p => p.type === 'hour')?.value || 0);
  return hour === 24 ? 0 : hour;
}

function isInsideAssignmentWindow(now = new Date(), settings) {
  const start = Number(settings.assignStartHour);
  const end = Number(settings.assignEndHour);
  const hour = hourInTimezone(now, settings.timezone);
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

async function ensureDefaultRule(client) {
  const { rows: [existing] } = await client.query(
    `SELECT id FROM distribution_rules WHERE name = $1 LIMIT 1`,
    [DEFAULT_RULE_NAME],
  );
  if (existing) return existing.id;

  const { rows: [created] } = await client.query(
    `INSERT INTO distribution_rules(name, strategy, priority, is_active)
       VALUES ($1, 'round_robin', 9999, TRUE)
       RETURNING id`,
    [DEFAULT_RULE_NAME],
  );
  return created.id;
}

async function ensureNamedRule(client, name) {
  const { rows: [existing] } = await client.query(
    `SELECT id FROM distribution_rules WHERE name = $1 LIMIT 1`,
    [name],
  );
  if (existing) return existing.id;

  const { rows: [created] } = await client.query(
    `INSERT INTO distribution_rules(name, strategy, priority, is_active)
       VALUES ($1, 'round_robin', 9999, TRUE)
       RETURNING id`,
    [name],
  );
  return created.id;
}

async function getAvailableMembers(options = {}, client = null) {
  const runner = client || { query };
  const params = [];
  let where = `
    u.role IN ('member', 'partner')
    AND u.status = 'active'
    AND u.deleted_at IS NULL
    AND ${leadAvailabilitySql('u')}
    AND COALESCE(u.distribution_blocked, FALSE) = FALSE
    AND NOT EXISTS (
      SELECT 1 FROM users rm
       WHERE rm.id = u.report_to_id
         AND rm.role = 'rm'
         AND (
           rm.status <> 'active'
           OR rm.deleted_at IS NOT NULL
           OR NOT (${leadAvailabilitySql('rm')})
         )
    )
  `;

  if (options.rmId) {
    params.push(options.rmId);
    where += ` AND u.report_to_id = $${params.length}`;
  }
  if (options.memberIds?.length) {
    params.push(options.memberIds);
    where += ` AND u.id = ANY($${params.length}::uuid[])`;
  }

  const { rows } = await runner.query(`
    SELECT u.id, u.full_name, u.role, u.report_to_id, u.team_name,
           COALESCE(u.distribution_weight, 1) AS distribution_weight,
           COALESCE(u.daily_lead_cap, 50) AS daily_lead_cap,
           (SELECT COUNT(*)::int FROM leads l
             WHERE l.assigned_to_user_id = u.id
               AND l.assigned_at >= CURRENT_DATE
               AND l.deleted_at IS NULL) AS today_count,
           (SELECT COUNT(*)::int FROM leads l
             WHERE l.assigned_to_user_id = u.id
               AND l.is_pending = TRUE
               AND l.deleted_at IS NULL) AS pending_count
      FROM users u
     WHERE ${where}
       AND (
         COALESCE(u.daily_lead_cap, 50) <= 0
         OR (SELECT COUNT(*)::int FROM leads l
              WHERE l.assigned_to_user_id = u.id
                AND l.assigned_at >= CURRENT_DATE
                AND l.deleted_at IS NULL) < COALESCE(u.daily_lead_cap, 50)
       )
     ORDER BY u.created_at ASC NULLS LAST, u.full_name ASC NULLS LAST, u.id ASC
  `, params);
  return rows;
}

async function getHighPerformanceMembers(options = {}, client = null) {
  const runner = client || { query };
  const base = await getAvailableMembers(options, runner);
  if (base.length <= 1) return base;

  const ids = base.map(m => m.id);
  const { rows } = await runner.query(`
    SELECT u.id,
           (COUNT(l.id) FILTER (WHERE l.call_status = 'converted'
              AND l.updated_at > NOW() - INTERVAL '30 days') * 10)
           + (COUNT(l.id) FILTER (WHERE l.call_status <> 'not_called'
              AND l.updated_at > NOW() - INTERVAL '7 days') * 2)
           + (COUNT(r.id) FILTER (WHERE r.created_at > NOW() - INTERVAL '7 days'))
           - (COUNT(l.id) FILTER (WHERE l.is_pending = TRUE) * 3) AS score
      FROM users u
      LEFT JOIN leads l ON l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
      LEFT JOIN lead_remarks r ON r.user_id = u.id
     WHERE u.id = ANY($1::uuid[])
     GROUP BY u.id
     ORDER BY score DESC, u.id ASC
  `, [ids]);
  const score = new Map(rows.map(r => [r.id, Number(r.score || 0)]));
  const ranked = [...base].sort((a, b) => (score.get(b.id) || 0) - (score.get(a.id) || 0) || a.id.localeCompare(b.id));
  return ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 2)));
}

async function pickRoundRobinMember(client, members) {
  if (!members.length) return null;
  const ruleId = await ensureDefaultRule(client);
  await client.query(`INSERT INTO rr_state(rule_id) VALUES ($1) ON CONFLICT (rule_id) DO NOTHING`, [ruleId]);
  const { rows: [state] } = await client.query(`SELECT last_user_id FROM rr_state WHERE rule_id = $1 FOR UPDATE`, [ruleId]);

  let idx = 0;
  if (state?.last_user_id) {
    const lastIdx = members.findIndex(m => m.id === state.last_user_id);
    idx = lastIdx === -1 ? 0 : (lastIdx + 1) % members.length;
  }
  const picked = members[idx];
  await client.query(`UPDATE rr_state SET last_user_id = $1, updated_at = NOW() WHERE rule_id = $2`, [picked.id, ruleId]);
  return picked;
}

async function pickRoundRobinFromScope(client, scopeName, users) {
  if (!users.length) return null;
  const ruleId = await ensureNamedRule(client, scopeName);
  await client.query(`INSERT INTO rr_state(rule_id) VALUES ($1) ON CONFLICT (rule_id) DO NOTHING`, [ruleId]);
  const { rows: [state] } = await client.query(`SELECT last_user_id FROM rr_state WHERE rule_id = $1 FOR UPDATE`, [ruleId]);
  let idx = 0;
  if (state?.last_user_id) {
    const lastIdx = users.findIndex(user => user.id === state.last_user_id);
    idx = lastIdx === -1 ? 0 : (lastIdx + 1) % users.length;
  }
  const picked = users[idx];
  await client.query(`UPDATE rr_state SET last_user_id = $1, updated_at = NOW() WHERE rule_id = $2`, [picked.id, ruleId]);
  return picked;
}

async function getEligibleRmTeams(client) {
  const { rows: rms } = await client.query(`
    SELECT rm.id, rm.full_name, rm.team_name, rm.created_at
      FROM users rm
     WHERE rm.role = 'rm'
       AND rm.status = 'active'
       AND ${leadAvailabilitySql('rm')}
       AND rm.deleted_at IS NULL
       AND EXISTS (
         SELECT 1
           FROM users m
          WHERE m.report_to_id = rm.id
            AND m.role IN ('member', 'partner')
            AND m.status = 'active'
            AND m.deleted_at IS NULL
            AND ${leadAvailabilitySql('m')}
            AND COALESCE(m.distribution_blocked, FALSE) = FALSE
       )
     ORDER BY rm.created_at ASC NULLS LAST, rm.full_name ASC NULLS LAST, rm.id ASC
  `);
  const teams = [];
  for (const rm of rms) {
    const members = await getAvailableMembers({ rmId: rm.id }, client);
    if (members.length) teams.push({ rm, members });
  }
  return teams;
}

async function validateTargetMember(client, memberId, actor = null) {
  return validateLeadAssignee(client, memberId, { actor });
}

function leadAssignableSql(alias = 'l') {
  return `
    ${alias}.deleted_at IS NULL
    AND ${alias}.stage NOT IN ('won', 'lost', 'dropped')
    AND ${alias}.call_status NOT IN ('converted', 'not_interested', 'wrong_number', 'invalid_number')
    AND (${alias}.locked_by_user_id IS NULL OR ${alias}.locked_until IS NULL OR ${alias}.locked_until < NOW())
  `;
}

async function insertAssignmentHistory(client, {
  leadId,
  memberId,
  assignedBy = null,
  assignmentType,
  previousUserId = null,
  requestId = null,
  reason = null,
}) {
  await client.query(
    `INSERT INTO lead_assignments(
       lead_id, user_id, assigned_to_user_id, assigned_by, assigned_by_user_id,
       assignment_type, previous_user_id, request_id, reason
     ) VALUES ($1,$2,$2,$3,$3,$4,$5,$6,$7)`,
    [leadId, memberId, assignedBy, assignmentType, previousUserId, requestId, reason],
  );
}

async function notifyAssigned(client, memberId, count, metadata = {}) {
  try {
    // Best-effort only. Do not use the assignment transaction client here:
    // a notification rendering/insert failure must not abort lead assignment.
    await notifyLeadAssigned(memberId, count, metadata, null);
  } catch (err) {
    logger.warn({
      err: err.message,
      memberId,
      count,
      assignmentType: metadata.assignment_type || metadata.assignmentSource || null,
      leadIds: metadata.lead_ids || metadata.leadIds || null,
    }, '[assignment] lead assignment notification failed');
  }
}

async function assignLeadToMember(input) {
  const {
    leadId,
    memberId,
    assignedBy = null,
    actor = null,
    assignmentType = 'manual',
    reason = null,
    requestId = null,
    allowReassign = false,
  } = input;

  return withTransaction(async (client) => {
    await validateTargetMember(client, memberId, actor);

    const { rows: [lead] } = await client.query(
      `SELECT id, assigned_to_user_id, stage, call_status, locked_by_user_id, locked_until
         FROM leads
        WHERE id = $1 AND ${leadAssignableSql('leads')}
        FOR UPDATE`,
      [leadId],
    );
    if (!lead) return { leadId, assigned: false, reason: 'not_assignable' };
    if (lead.assigned_to_user_id && !allowReassign) {
      return { leadId, assigned: false, reason: 'already_assigned', currentUserId: lead.assigned_to_user_id };
    }
    if (actor?.role === 'rm' && lead.assigned_to_user_id) {
      const { rows: [owner] } = await client.query(`SELECT report_to_id FROM users WHERE id = $1`, [lead.assigned_to_user_id]);
      if (owner?.report_to_id && owner.report_to_id !== actor.id) {
        throw new AppError(403, 'FORBIDDEN', 'RM can only reassign leads inside their team');
      }
    }

    await client.query(
      `UPDATE lead_assignments
          SET unassigned_at = NOW()
        WHERE lead_id = $1 AND unassigned_at IS NULL`,
      [leadId],
    );

    const { rowCount } = await client.query(
      `UPDATE leads
          SET assigned_to_user_id = $1,
              assigned_at = NOW(),
              locked_by_user_id = NULL,
              locked_until = NULL,
              updated_at = NOW()
        WHERE id = $2`,
      [memberId, leadId],
    );
    if (!rowCount) return { leadId, assigned: false, reason: 'update_failed' };

    await insertAssignmentHistory(client, {
      leadId,
      memberId,
      assignedBy,
      assignmentType,
      previousUserId: lead.assigned_to_user_id || null,
      requestId,
      reason,
    });
    await notifyAssigned(client, memberId, 1, {
      lead_id: leadId,
      assignment_type: assignmentType,
      request_id: requestId,
      previous_user_id: lead.assigned_to_user_id || null,
      assigned_by: assignedBy,
      reason,
    });
    return { leadId, assigned: true, previousUserId: lead.assigned_to_user_id || null, memberId };
  });
}

async function assignLeadsBulk({ leadIds, memberId, assignedBy = null, actor = null, assignmentType = 'manual', reason = null }) {
  if (!Array.isArray(leadIds) || leadIds.length === 0) throw new AppError(400, 'INVALID', 'leadIds array required');
  const invalidIds = leadIds.filter(id => typeof id !== 'string' || !UUID_RE.test(id));
  if (invalidIds.length) throw new AppError(400, 'INVALID_LEAD_IDS', 'All lead IDs must be valid UUIDs', { invalidIds });
  if (typeof memberId !== 'string' || !UUID_RE.test(memberId)) {
    throw new AppError(400, 'INVALID_MEMBER_ID', 'Target user ID must be a valid UUID');
  }
  return withTransaction(async (client) => {
    await validateTargetMember(client, memberId, actor);
    const results = [];
    const allowReassign = ['manual_reassign', 'auto_reassign'].includes(assignmentType);
    for (const leadId of leadIds) {
      const { rows: [lead] } = await client.query(
        `SELECT id, assigned_to_user_id
           FROM leads
          WHERE id = $1 AND ${leadAssignableSql('leads')}
          FOR UPDATE`,
        [leadId],
      );
      if (!lead) {
        results.push({ leadId, assigned: false, reason: 'not_assignable' });
        continue;
      }
      if (lead.assigned_to_user_id && !allowReassign) {
        results.push({ leadId, assigned: false, reason: 'already_assigned', currentUserId: lead.assigned_to_user_id });
        continue;
      }
      if (actor?.role === 'rm' && lead.assigned_to_user_id) {
        const { rows: [owner] } = await client.query(`SELECT report_to_id FROM users WHERE id = $1`, [lead.assigned_to_user_id]);
        if (owner?.report_to_id && owner.report_to_id !== actor.id) {
          results.push({ leadId, assigned: false, reason: 'outside_rm_team' });
          continue;
        }
      }
      await client.query(`UPDATE lead_assignments SET unassigned_at = NOW() WHERE lead_id = $1 AND unassigned_at IS NULL`, [leadId]);
      await client.query(
        `UPDATE leads
            SET assigned_to_user_id = $1, assigned_at = NOW(),
                locked_by_user_id = NULL, locked_until = NULL, updated_at = NOW()
          WHERE id = $2`,
        [memberId, leadId],
      );
      await insertAssignmentHistory(client, {
        leadId,
        memberId,
        assignedBy,
        assignmentType,
        previousUserId: lead.assigned_to_user_id || null,
        reason,
      });
      results.push({ leadId, assigned: true, previousUserId: lead.assigned_to_user_id || null });
    }
    const assigned = results.filter(r => r.assigned).length;
    const skipped = results.filter(r => !r.assigned);
    if (assigned) {
      const assignedResults = results.filter(r => r.assigned);
      if (allowReassign) {
        const byPreviousUser = new Map();
        for (const result of assignedResults) {
          const key = result.previousUserId || '__unassigned__';
          if (!byPreviousUser.has(key)) byPreviousUser.set(key, []);
          byPreviousUser.get(key).push(result.leadId);
        }
        for (const [previousUserId, ids] of byPreviousUser.entries()) {
          await notifyAssigned(client, memberId, ids.length, {
            assignment_type: assignmentType,
            count: ids.length,
            lead_ids: ids,
            previous_user_id: previousUserId === '__unassigned__' ? null : previousUserId,
            assigned_by: assignedBy,
            reason,
          });
        }
      } else {
        await notifyAssigned(client, memberId, assigned, {
          assignment_type: assignmentType,
          count: assigned,
          lead_ids: assignedResults.map(r => r.leadId),
          assigned_by: assignedBy,
          reason,
        });
      }
    }
    return {
      requested_count: leadIds.length,
      assigned_count: assigned,
      skipped_count: skipped.length,
      failed_count: 0,
      assigned,
      failed: skipped.length,
      skipped,
      results,
    };
  });
}

async function reassignLead(input) {
  return assignLeadToMember({
    ...input,
    memberId: input.newMemberId || input.memberId,
    assignmentType: input.manual === false ? 'auto_reassign' : 'manual_reassign',
    allowReassign: true,
  });
}

async function pickAssignableLeads(client, { limit, category = null, forUpdate = true }) {
  const params = [limit];
  let where = `assigned_to_user_id IS NULL AND pool_rm_id IS NULL AND ${leadAssignableSql('leads')}`;
  if (category) {
    params.push(category);
    where += ` AND category = $${params.length}`;
  }
  const { rows } = await client.query(
    `SELECT id
       FROM leads
      WHERE ${where}
      ORDER BY
        CASE WHEN (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date
                  = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
             THEN 0 ELSE 1 END,
        COALESCE(meta_created_time, created_at) ASC
      LIMIT $1
      ${forUpdate ? 'FOR UPDATE SKIP LOCKED' : ''}`,
    params,
  );
  return rows;
}

async function leadRequestStatusSupported(client, status) {
  const { rows: [row] } = await client.query(
    `SELECT COUNT(*)::int AS checks,
            COUNT(*) FILTER (WHERE pg_get_constraintdef(c.oid) ILIKE $1)::int AS matching
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'lead_requests'
        AND c.contype = 'c'
        AND c.conname ILIKE '%status%'`,
    [`%${status}%`],
  );
  return Number(row?.checks || 0) === 0 || Number(row?.matching || 0) > 0;
}

async function markRequestAfterFulfillment(client, request, fulfilledNow) {
  const previous = Number(request.fulfilled_quantity ?? request.leads_assigned ?? 0);
  const approved = Number(request.approved_quantity ?? request.quantity ?? 0);
  const fulfilled = previous + fulfilledNow;
  const logicalStatus = fulfilled >= approved ? 'fulfilled' : (fulfilled > 0 ? 'partially_fulfilled' : 'approved');
  const status = logicalStatus === 'partially_fulfilled' && !(await leadRequestStatusSupported(client, 'partially_fulfilled'))
    ? 'approved'
    : logicalStatus;
  await client.query(
    `UPDATE lead_requests
        SET fulfilled_quantity = $1,
            leads_assigned = $1,
            status = $2::varchar,
            fulfilled_at = CASE WHEN $2::varchar = 'fulfilled' THEN NOW() ELSE fulfilled_at END,
            resolved_at = CASE WHEN $2::varchar = 'fulfilled' THEN NOW() ELSE resolved_at END,
            updated_at = NOW()
      WHERE id = $3`,
    [fulfilled, status, request.id],
  );
  return { fulfilled, status: logicalStatus, dbStatus: status, remaining: Math.max(0, approved - fulfilled) };
}

async function dispatchApprovedRequestNotifications(result) {
  const jobs = Array.isArray(result?._notificationJobs) ? result._notificationJobs : [];
  for (const job of jobs) {
    try {
      if (job.type === 'lead_assigned') {
        await notifyAssigned(null, job.memberId, job.count, job.metadata);
      } else if (job.type === 'request_resolved') {
        await notifyLeadRequestResolved(job.input);
      }
    } catch (err) {
      logger.warn({ err: err.message, jobType: job.type, requestId: job.requestId }, '[assignment] post-commit notification failed');
    }
  }
  if (result && Object.prototype.hasOwnProperty.call(result, '_notificationJobs')) {
    delete result._notificationJobs;
  }
  if (result && Object.prototype.hasOwnProperty.call(result, '_sheetSyncLeadIds')) {
    delete result._sheetSyncLeadIds;
  }
  return result;
}

async function syncAssignedLeadsToSheets(leadIds, context = {}) {
  const ids = [...new Set((leadIds || []).filter(Boolean))];
  if (!ids.length) return { requested: 0, synced: 0, failed: 0 };

  let googleSheetsService;
  let userGoogleSheetsService;
  try {
    googleSheetsService = require('./googleSheetsService');
    userGoogleSheetsService = require('./userGoogleSheetsService');
  } catch (err) {
    logger.warn({ err: err.message, count: ids.length, ...context }, '[assignment] Google Sheet sync services unavailable');
    return { requested: ids.length, synced: 0, failed: ids.length };
  }

  let synced = 0;
  let failed = 0;
  for (const leadId of ids) {
    try {
      if (userGoogleSheetsService.enqueueLeadSync) {
        await userGoogleSheetsService.enqueueLeadSync(leadId, {
          eventType: 'lead_assigned',
          source: context.assignmentType || 'assignment',
          userId: context.actorId || null,
        });
      }
      const [master, personal] = await Promise.allSettled([
        googleSheetsService.updateLeadRow(leadId),
        userGoogleSheetsService.pushLeadToPersonalSheets(leadId),
      ]);
      if (master.status === 'fulfilled' && master.value?.reason) {
        logger.warn({ leadId, reason: master.value.reason, ...context }, '[assignment] master Google Sheet update skipped');
      }
      if (personal.status === 'fulfilled' && personal.value?.skipped) {
        logger.warn({ leadId, ...context }, '[assignment] personal Google Sheet update skipped');
      }
      if (master.status === 'rejected') {
        logger.warn({ leadId, err: master.reason?.message || String(master.reason || 'Master sheet sync failed'), ...context }, '[assignment] master Google Sheet update failed');
      }
      if (personal.status === 'rejected') {
        logger.warn({ leadId, err: personal.reason?.message || String(personal.reason || 'Personal sheet sync failed'), ...context }, '[assignment] personal Google Sheet update failed');
      }
      if (master.status === 'fulfilled' || personal.status === 'fulfilled') synced += 1;
      if (master.status === 'rejected' && personal.status === 'rejected') failed += 1;
    } catch (err) {
      failed += 1;
      logger.warn({ leadId, err: err.message, ...context }, '[assignment] Google Sheet update failed');
    }
  }
  logger.info({ requested: ids.length, synced, failed, ...context }, '[assignment] Google Sheet sync completed after assignment');
  return { requested: ids.length, synced, failed };
}

async function countAvailableLeadsForRequest(request, actor, client = null) {
  const runner = client || { query };
  const params = [];
  let sql = `
    SELECT COUNT(*)::int AS available_count
      FROM leads
     WHERE assigned_to_user_id IS NULL
       AND deleted_at IS NULL
       AND ${leadAssignableSql('leads')}
  `;

  if (actor?.role === 'rm') {
    params.push(actor.id);
    sql += ` AND pool_rm_id = $${params.length}`;
  } else {
    sql += ` AND pool_rm_id IS NULL`;
  }

  if (request?.category) {
    params.push(request.category);
    sql += ` AND category = $${params.length}`;
  }

  const { rows: [row] } = await runner.query(sql, params);
  return Number(row?.available_count || 0);
}

async function fulfillApprovedRequestsInTransaction(client, { limit = 100, actor = null } = {}) {
    let currentStep = 'select_approved_requests';
    try {
    const { rows: requests } = await client.query(`
      SELECT lr.*, u.role AS user_role, u.status AS user_status,
             u.report_to_id AS user_report_to_id, u.is_available,
             u.deleted_at AS user_deleted_at,
             COALESCE(u.distribution_blocked, FALSE) AS user_distribution_blocked,
             COALESCE(u.lead_assignment_enabled, TRUE) AS user_lead_assignment_enabled,
             COALESCE(u.lead_assignment_status, 'available') AS user_lead_assignment_status,
             COALESCE(rm.is_available, TRUE) AS rm_is_available,
             COALESCE(rm.lead_assignment_enabled, TRUE) AS rm_lead_assignment_enabled,
             COALESCE(rm.lead_assignment_status, 'available') AS rm_lead_assignment_status
        FROM lead_requests lr
        JOIN users u ON u.id = lr.user_id
        LEFT JOIN users rm ON rm.id = u.report_to_id AND rm.role = 'rm' AND rm.deleted_at IS NULL
       WHERE lr.status IN ('approved', 'partially_fulfilled')
         AND COALESCE(lr.approved_quantity, lr.quantity) > COALESCE(lr.fulfilled_quantity, lr.leads_assigned, 0)
       ORDER BY COALESCE(lr.approved_at, lr.resolved_at, lr.created_at) ASC
       LIMIT $1
       FOR UPDATE OF lr SKIP LOCKED
    `, [limit]);

    let assigned = 0;
    const requestResults = [];
    const notificationJobs = [];
    const sheetSyncLeadIds = [];
    for (const req of requests) {
      currentStep = `process_request:${req.id}`;
      if (assigned >= limit) break;
      try {
        assertLeadAssigneeUser({
          id: req.user_id,
          role: req.user_role,
          status: req.user_status,
          report_to_id: req.user_report_to_id,
          deleted_at: req.user_deleted_at,
          is_available: req.is_available,
          distribution_blocked: req.user_distribution_blocked,
          lead_assignment_enabled: req.user_lead_assignment_enabled,
          lead_assignment_status: req.user_lead_assignment_status,
          rm_is_available: req.rm_is_available,
          rm_lead_assignment_enabled: req.rm_lead_assignment_enabled,
          rm_lead_assignment_status: req.rm_lead_assignment_status,
        }, { requireAvailable: true });
      } catch (err) {
        requestResults.push({ requestId: req.id, assigned: 0, skipped: err.code || 'invalid_assignee' });
        continue;
      }
      const approved = Number(req.approved_quantity ?? req.quantity ?? 0);
      const fulfilled = Number(req.fulfilled_quantity ?? req.leads_assigned ?? 0);
      const need = Math.min(approved - fulfilled, limit - assigned);
      if (need <= 0) continue;
      currentStep = `pick_assignable_leads:${req.id}`;
      const leads = await pickAssignableLeads(client, { limit: need, category: req.category });
      let filled = 0;
      const leadIds = [];
      for (const lead of leads) {
        currentStep = `assign_lead:${req.id}:${lead.id}`;
        const upd = await client.query(
          `UPDATE leads
              SET assigned_to_user_id = $1, assigned_at = NOW(), updated_at = NOW()
            WHERE id = $2 AND assigned_to_user_id IS NULL`,
          [req.user_id, lead.id],
        );
        if (!upd.rowCount) continue;
        currentStep = `insert_assignment_history:${req.id}:${lead.id}`;
        await insertAssignmentHistory(client, {
          leadId: lead.id,
          memberId: req.user_id,
          assignedBy: actor?.id || req.approved_by || req.resolved_by || null,
          assignmentType: 'request_fulfillment',
          requestId: req.id,
          reason: 'approved_request_fulfillment',
        });
        filled++;
        leadIds.push(lead.id);
        sheetSyncLeadIds.push(lead.id);
      }
      if (filled) {
        notificationJobs.push({
          type: 'lead_assigned',
          requestId: req.id,
          memberId: req.user_id,
          count: filled,
          metadata: { request_id: req.id, assignment_type: 'request_fulfillment', lead_ids: leadIds, assigned_by: actor?.id || req.approved_by || req.resolved_by || null },
        });
      }
      currentStep = `mark_request_after_fulfillment:${req.id}`;
      const status = await markRequestAfterFulfillment(client, req, filled);
      if (filled || status.status === 'fulfilled') {
        notificationJobs.push({
          type: 'request_resolved',
          requestId: req.id,
          input: {
            requestId: req.id,
            requesterId: req.user_id,
            quantity: approved,
            assigned: status.fulfilled,
            status: status.status,
          },
        });
      }
      assigned += filled;
      requestResults.push({ requestId: req.id, assigned: filled, status: status.status, remaining: status.remaining });
    }

    return { processed: requests.length, assigned, requests: requestResults, _notificationJobs: notificationJobs, _sheetSyncLeadIds: sheetSyncLeadIds };
    } catch (err) {
      err.assignment_step = currentStep;
      throw err;
    }
}

async function runApprovedRequestFulfillment({ limit = 100, actor = null, bypassEnabled = false } = {}) {
  const settings = await getAssignmentSettings();
  if (!settings.autoAssignApprovedRequests && !bypassEnabled) {
    return { processed: 0, assigned: 0, skipped: true, reason: 'AUTO_ASSIGN_APPROVED_REQUESTS_DISABLED', requests: [] };
  }
  const result = await withTransaction((client) => fulfillApprovedRequestsInTransaction(client, { limit, actor }));
  const sheetSyncLeadIds = [...(result._sheetSyncLeadIds || [])];
  await syncAssignedLeadsToSheets(sheetSyncLeadIds, { assignmentType: 'approved_request_fulfillment' });
  return dispatchApprovedRequestNotifications(result);
}

async function runAutoAssignment({ limit = 100, reason = 'auto_round_robin', actor = null, bypassWindow = false, bypassEnabled = false } = {}) {
  const settings = await getAssignmentSettings();
  if (!settings.autoAssignEnabled && !bypassEnabled) {
    return { success: true, skipped: true, reason: 'AUTO_DISTRIBUTION_DISABLED', assigned: 0, scanned: 0, results: [] };
  }
  if (!bypassWindow && !isInsideAssignmentWindow(new Date(), settings)) {
    return { success: true, skipped: true, reason: 'OUTSIDE_DISTRIBUTION_WINDOW', assigned: 0, scanned: 0, results: [] };
  }
  const result = await withTransaction(async (client) => {
    let approvedRequestFulfillment = { processed: 0, assigned: 0, requests: [] };
    let remainingLimit = limit;
    if (settings.autoAssignApprovedRequests && remainingLimit > 0) {
      approvedRequestFulfillment = await fulfillApprovedRequestsInTransaction(client, { limit: remainingLimit, actor });
      remainingLimit = Math.max(0, remainingLimit - Number(approvedRequestFulfillment.assigned || 0));
    }

    const teams = await getEligibleRmTeams(client);
    if (!teams.length) {
      if (Number(approvedRequestFulfillment.assigned || 0) > 0) {
        return {
          success: true,
          assigned: Number(approvedRequestFulfillment.assigned || 0),
          requestFulfillment: approvedRequestFulfillment,
          scanned: 0,
          results: [],
        };
      }
      return {
        success: false,
        code: 'NO_ELIGIBLE_ASSIGNEES',
        message: 'No available team members found for lead distribution.',
        assigned: Number(approvedRequestFulfillment.assigned || 0),
        requestFulfillment: approvedRequestFulfillment,
        scanned: 0,
        results: [],
      };
    }

    if (remainingLimit <= 0) {
      return {
        assigned: Number(approvedRequestFulfillment.assigned || 0),
        scanned: 0,
        requestFulfillment: approvedRequestFulfillment,
        results: [],
      };
    }

    const leads = await pickAssignableLeads(client, { limit: remainingLimit });
    let assigned = 0;
    const results = [];
    const assignedByMember = new Map();
    for (const lead of leads) {
      const team = await pickRoundRobinFromScope(client, RM_POOL_RULE_NAME, teams.map(t => t.rm));
      const fullTeam = teams.find(t => t.rm.id === team?.id);
      const member = fullTeam ? await pickRoundRobinFromScope(client, `__assignment_engine_rm_team__:${fullTeam.rm.id}`, fullTeam.members) : null;
      if (!member) break;
      const upd = await client.query(
        `UPDATE leads
            SET assigned_to_user_id = $1, assigned_at = NOW(), updated_at = NOW()
          WHERE id = $2 AND assigned_to_user_id IS NULL`,
        [member.id, lead.id],
      );
      if (!upd.rowCount) {
        results.push({ leadId: lead.id, assigned: false, reason: 'race_lost' });
        continue;
      }
      await insertAssignmentHistory(client, {
        leadId: lead.id,
        memberId: member.id,
        assignedBy: actor?.id || null,
        assignmentType: 'auto',
        reason,
      });
      assigned++;
      if (!assignedByMember.has(member.id)) assignedByMember.set(member.id, []);
      assignedByMember.get(member.id).push(lead.id);
      results.push({ leadId: lead.id, assigned: true, memberId: member.id });
    }
    for (const [memberId, leadIds] of assignedByMember.entries()) {
      await notifyAssigned(client, memberId, leadIds.length, { assignment_type: 'auto', reason, lead_ids: leadIds, assigned_by: actor?.id || null });
    }
    return {
      assigned: assigned + Number(approvedRequestFulfillment.assigned || 0),
      normalAssigned: assigned,
      scanned: leads.length,
      requestFulfillment: approvedRequestFulfillment,
      results,
    };
  });
  const sheetSyncLeadIds = [
    ...(result?.requestFulfillment?._sheetSyncLeadIds || []),
    ...(result?.results || []).filter(item => item.assigned).map(item => item.leadId),
  ];
  await syncAssignedLeadsToSheets(sheetSyncLeadIds, { assignmentType: reason || 'auto_round_robin' });
  if (result?.requestFulfillment) {
    await dispatchApprovedRequestNotifications(result.requestFulfillment);
  }
  return result;
}

async function getLeadWorkActivity(leadId) {
  const { rows: [r] } = await query(`
    SELECT
      (SELECT MAX(created_at) FROM lead_remarks WHERE lead_id = $1) AS last_remark_at,
      (SELECT MAX(updated_at) FROM lead_workflow WHERE lead_id = $1) AS last_workflow_at,
      (SELECT MAX(created_at) FROM lead_workflow_history WHERE lead_id = $1) AS last_workflow_history_at,
      (SELECT MAX(created_at) FROM messages WHERE lead_id = $1) AS last_message_at
  `, [leadId]).catch(async () => {
    const fallback = await query(`
      SELECT
        (SELECT MAX(created_at) FROM lead_remarks WHERE lead_id = $1) AS last_remark_at,
        NULL::timestamptz AS last_workflow_at,
        NULL::timestamptz AS last_workflow_history_at,
        NULL::timestamptz AS last_message_at
    `, [leadId]);
    return fallback;
  });
  return r || {};
}

function newestDate(values) {
  return values.filter(Boolean).map(v => new Date(v)).sort((a, b) => b - a)[0] || null;
}

function isLeadInactiveForReassignment(lead, settings, activity = {}) {
  if (!lead || !lead.assigned_to_user_id) return false;
  if (CLOSED_STAGES.has(lead.stage) || CLOSED_CALL_STATUSES.has(lead.call_status)) return false;
  if (lead.locked_by_user_id && lead.locked_until && new Date(lead.locked_until) > new Date()) return false;
  const lastActivity = newestDate([
    activity.last_remark_at,
    activity.last_workflow_at,
    activity.last_workflow_history_at,
    activity.last_message_at,
    lead.last_call_at,
    lead.assigned_at,
  ]);
  if (!lastActivity) return true;
  const ageHours = (Date.now() - lastActivity.getTime()) / 36e5;
  return ageHours >= settings.reassignAfterHours;
}

async function runAutoReassignment({ limit = 50, actor = null, bypassWindow = false } = {}) {
  const settings = await getAssignmentSettings();
  if (!settings.autoReassignEnabled && !bypassWindow) return { reassigned: 0, skipped: 'disabled' };
  if (!bypassWindow && !isInsideAssignmentWindow(new Date(), settings)) return { reassigned: 0, skipped: 'outside_window' };

  return withTransaction(async (client) => {
    const candidates = await (settings.reassignToHighPerformers ? getHighPerformanceMembers({}, client) : getAvailableMembers({}, client));
    if (!candidates.length) return { reassigned: 0, skipped: 'no_available_members' };

    const { rows: leads } = await client.query(`
      SELECT id, assigned_to_user_id, assigned_at, stage, call_status, last_call_at, locked_by_user_id, locked_until
        FROM leads
       WHERE assigned_to_user_id IS NOT NULL
         AND ${leadAssignableSql('leads')}
         AND assigned_at < NOW() - ($1::int * INTERVAL '1 hour')
       ORDER BY assigned_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED
    `, [settings.reassignAfterHours, limit]);

    let reassigned = 0;
    const results = [];
    for (const lead of leads) {
      const activity = await getLeadWorkActivity(lead.id);
      if (!isLeadInactiveForReassignment(lead, settings, activity)) {
        results.push({ leadId: lead.id, reassigned: false, reason: 'recent_activity' });
        continue;
      }
      let next = await pickRoundRobinMember(client, candidates.filter(m => m.id !== lead.assigned_to_user_id));
      if (!next) next = candidates.find(m => m.id !== lead.assigned_to_user_id);
      if (!next) {
        results.push({ leadId: lead.id, reassigned: false, reason: 'no_alternate_member' });
        continue;
      }
      await client.query(`UPDATE lead_assignments SET unassigned_at = NOW() WHERE lead_id = $1 AND unassigned_at IS NULL`, [lead.id]);
      await client.query(
        `UPDATE leads
            SET assigned_to_user_id = $1, assigned_at = NOW(),
                locked_by_user_id = NULL, locked_until = NULL, updated_at = NOW()
          WHERE id = $2`,
        [next.id, lead.id],
      );
      await insertAssignmentHistory(client, {
        leadId: lead.id,
        memberId: next.id,
        assignedBy: actor?.id || null,
        assignmentType: 'auto_reassign',
        previousUserId: lead.assigned_to_user_id,
        reason: `inactive_for_${settings.reassignAfterHours}_hours`,
      });
      await notifyAssigned(client, next.id, 1, {
        lead_id: lead.id,
        assignment_type: 'auto_reassign',
        previous_user_id: lead.assigned_to_user_id,
        assigned_by: actor?.id || null,
      });
      reassigned++;
      results.push({ leadId: lead.id, reassigned: true, previousUserId: lead.assigned_to_user_id, memberId: next.id });
    }
    return { reassigned, scanned: leads.length, results };
  });
}

async function approveLeadRequest({ requestId, approvedQuantity, adminNotes = null, actor }) {
  if (!actor) throw new AppError(401, 'NO_USER', 'Not authenticated');
  if (!['super_admin', 'admin'].includes(actor.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Only admin users can approve lead requests.');
  }
  const qty = Math.max(1, Math.min(500, Number.parseInt(approvedQuantity, 10) || 0));
  if (!qty) throw new AppError(400, 'INVALID', 'approvedQuantity must be greater than 0');

  let requestUserId = null;
  await withTransaction(async (client) => {
    const { rows: [req] } = await client.query(
      `SELECT lr.*, u.report_to_id, u.role AS user_role
         FROM lead_requests lr
         JOIN users u ON u.id = lr.user_id
        WHERE lr.id = $1 AND lr.status = 'pending'
        FOR UPDATE OF lr`,
      [requestId],
    );
    if (!req) throw new AppError(404, 'NOT_FOUND', 'Request not found or already resolved');
    if (!['member', 'partner'].includes(req.user_role)) {
      throw new AppError(400, 'INVALID_REQUEST_USER', 'Only member or partner lead requests can be approved.');
    }
    requestUserId = req.user_id;
    await client.query(
      `UPDATE lead_requests
          SET status = 'approved',
              requested_quantity = COALESCE(requested_quantity, quantity),
              approved_quantity = $1,
              fulfilled_quantity = COALESCE(fulfilled_quantity, leads_assigned, 0),
              approved_by = $2,
              approved_at = NOW(),
              resolved_by = $2,
              resolve_note = $3,
              admin_notes = $3,
              updated_at = NOW()
        WHERE id = $4`,
      [qty, actor.id, adminNotes, requestId],
    );
  });

  const settings = await getAssignmentSettings();
  const fulfillment = settings.autoAssignApprovedRequests
    ? await runApprovedRequestFulfillment({ limit: qty, actor })
    : { processed: 0, assigned: 0, skipped: true, reason: 'AUTO_ASSIGN_APPROVED_REQUESTS_DISABLED', requests: [] };
  const { rows: [updated] } = await query(`SELECT * FROM lead_requests WHERE id = $1`, [requestId]);
  const assignedNow = fulfillment.requests?.find(r => r.requestId === requestId)?.assigned || 0;
  const fulfilled = Number(updated?.fulfilled_quantity ?? updated?.leads_assigned ?? 0);
  const approved = Number(updated?.approved_quantity ?? qty);
  return {
    request: updated,
    fulfillment,
    requestId,
    memberId: requestUserId,
    approvedQuantity: approved,
    assignedNow,
    remaining: Math.max(0, approved - fulfilled),
  };
}

async function getAssignmentOverview() {
  const settings = await getAssignmentSettings();
  const { rows: [s] } = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM leads WHERE assigned_to_user_id IS NULL AND deleted_at IS NULL) AS unassigned_leads,
      (SELECT COUNT(*)::int FROM leads WHERE assigned_at::date = CURRENT_DATE AND deleted_at IS NULL) AS assigned_today,
      (SELECT COUNT(*)::int FROM lead_requests WHERE status = 'approved') AS approved_requests,
      (SELECT COUNT(*)::int FROM lead_requests WHERE status = 'partially_fulfilled') AS partially_fulfilled_requests,
      (SELECT COUNT(*)::int FROM lead_assignments WHERE assignment_type = 'auto_reassign'
        AND created_at::date = CURRENT_DATE) AS reassigned_today,
      (SELECT COUNT(*)::int FROM lead_assignments WHERE assignment_type = 'manual_reassign'
        AND created_at::date = CURRENT_DATE) AS manual_reassigned_today,
      (SELECT COUNT(*)::int
         FROM users rm
        WHERE rm.role = 'rm'
          AND rm.status = 'active'
          AND ${leadAvailabilitySql('rm')}
          AND rm.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM users m
             WHERE m.report_to_id = rm.id
               AND m.role IN ('member','partner')
               AND m.status = 'active'
               AND m.deleted_at IS NULL
               AND ${leadAvailabilitySql('m')}
               AND COALESCE(m.distribution_blocked, FALSE) = FALSE
          )) AS eligible_rms,
      (SELECT COUNT(*)::int FROM users m
        WHERE m.role IN ('member','partner')
          AND m.status = 'active'
          AND m.deleted_at IS NULL
          AND ${leadAvailabilitySql('m')}
          AND COALESCE(m.distribution_blocked, FALSE) = FALSE
          AND NOT EXISTS (
            SELECT 1 FROM users rm
             WHERE rm.id = m.report_to_id
               AND rm.role = 'rm'
               AND (
                 rm.status <> 'active'
                 OR rm.deleted_at IS NOT NULL
                 OR NOT (${leadAvailabilitySql('rm')})
               )
          )) AS available_team_members
  `);
  return { settings, stats: s };
}

module.exports = {
  getAssignmentSettings,
  isInsideAssignmentWindow,
  getAvailableMembers,
  getHighPerformanceMembers,
  assignLeadToMember,
  assignLeadsBulk,
  reassignLead,
  runAutoAssignment,
  runApprovedRequestFulfillment,
  runAutoReassignment,
  getLeadWorkActivity,
  isLeadInactiveForReassignment,
  approveLeadRequest,
  countAvailableLeadsForRequest,
  getAssignmentOverview,
};
