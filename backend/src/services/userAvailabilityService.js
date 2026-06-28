const { query, withTransaction } = require('../config/database');
const { AppError } = require('../utils/errors');

const ASSIGNABLE_ROLES = new Set(['member', 'partner']);
const TARGET_ROLES = new Set(['rm', 'member', 'partner']);

function normalizeAvailability(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (['available', 'true', '1', 'yes'].includes(text)) return true;
  if (['unavailable', 'false', '0', 'no'].includes(text)) return false;
  return null;
}

function targetBucket(role) {
  return role === 'rm' ? 'rm' : 'member';
}

function assertActorCanUpdate(actor, targets, { bulk = false } = {}) {
  if (!actor) throw new AppError(401, 'NO_USER', 'Not authenticated');
  const isAdmin = ['super_admin', 'admin'].includes(actor.role);
  if (bulk && !isAdmin) {
    throw new AppError(403, 'LEAD_AVAILABILITY_FORBIDDEN', 'Only admin users can bulk update lead availability.');
  }

  for (const target of targets) {
    if (!TARGET_ROLES.has(target.role)) {
      throw new AppError(422, 'USER_NOT_ELIGIBLE_FOR_LEAD_ASSIGNMENT', 'Only RM, member, or partner availability can be updated.');
    }
    if (['super_admin', 'admin'].includes(target.role)) {
      throw new AppError(422, 'USER_NOT_ELIGIBLE_FOR_LEAD_ASSIGNMENT', 'Admin users cannot be updated for lead assignment availability.');
    }
    if (actor.role === 'rm') {
      const isOwnRmProfile = target.role === 'rm' && target.id === actor.id;
      const isOwnTeamMember = target.role !== 'rm' && target.report_to_id === actor.id;
      if (!isOwnRmProfile && !isOwnTeamMember) {
        throw new AppError(403, 'LEAD_AVAILABILITY_FORBIDDEN', 'RM can manage lead availability only for own team members.');
      }
    } else if (!isAdmin) {
      throw new AppError(403, 'LEAD_AVAILABILITY_FORBIDDEN', 'You are not allowed to update lead availability.');
    }
  }
}

function assertBulkShape(targets, isAvailable) {
  const buckets = new Set(targets.map(target => targetBucket(target.role)));
  if (buckets.size !== 1) {
    throw new AppError(400, 'MIXED_LEAD_AVAILABILITY_ROLES', 'Select either RM users or members, not both.');
  }
  const states = new Set(targets.map(target => Boolean(target.is_available)));
  if (states.size !== 1) {
    throw new AppError(400, 'MIXED_LEAD_AVAILABILITY_STATES', 'Selected users must all be currently available or all unavailable.');
  }
  const current = states.values().next().value;
  if (current === isAvailable) {
    throw new AppError(400, 'LEAD_AVAILABILITY_NO_CHANGE', `Selected users are already ${isAvailable ? 'available' : 'unavailable'}.`);
  }
}

async function loadTargets(client, userIds) {
  const { rows } = await client.query(
    `SELECT id, full_name, role, report_to_id, status, deleted_at,
            COALESCE(is_available, TRUE) AS is_available
       FROM users
      WHERE id = ANY($1::uuid[])
        AND deleted_at IS NULL
      FOR UPDATE`,
    [userIds],
  );
  if (rows.length !== userIds.length) {
    throw new AppError(404, 'USER_NOT_FOUND', 'One or more selected users were not found.');
  }
  return rows;
}

async function setAvailabilityForIds(client, userIds, isAvailable, actorId, reason = null) {
  if (!userIds.length) return [];
  const status = isAvailable ? 'available' : 'unavailable';
  const { rows } = await client.query(
    `UPDATE users
        SET is_available = $1,
            lead_assignment_enabled = $1,
            lead_assignment_status = $2,
            lead_assignment_disabled_reason = CASE WHEN $1 THEN NULL ELSE $3 END,
            lead_assignment_updated_by = $4,
            lead_assignment_updated_at = NOW(),
            updated_at = NOW()
      WHERE id = ANY($5::uuid[])
        AND deleted_at IS NULL
      RETURNING id, full_name, email, phone, role, status, report_to_id, team_name,
                is_available, distribution_blocked,
                lead_assignment_enabled, lead_assignment_status,
                lead_assignment_disabled_reason, lead_assignment_updated_by,
                lead_assignment_updated_at`,
    [isAvailable, status, reason || null, actorId, userIds],
  );
  if (rows.length !== userIds.length) {
    throw new AppError(409, 'LEAD_AVAILABILITY_UPDATE_INCOMPLETE', 'Could not update lead availability for every selected user.');
  }
  const stale = rows.find(row => row.is_available !== isAvailable || row.lead_assignment_status !== status || row.lead_assignment_enabled !== isAvailable);
  if (stale) {
    throw new AppError(409, 'LEAD_AVAILABILITY_UPDATE_FAILED', 'Lead availability did not save correctly. Please retry.');
  }
  return rows;
}

async function updateLeadAvailability({ actor, userIds, isAvailable, reason = null, bulk = false }) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new AppError(400, 'USER_IDS_REQUIRED', 'Select at least one user.');
  }
  const nextAvailable = normalizeAvailability(isAvailable);
  if (nextAvailable === null) {
    throw new AppError(400, 'INVALID_LEAD_ASSIGNMENT_STATUS', 'Invalid lead assignment availability status.');
  }

  return withTransaction(async (client) => {
    const targets = await loadTargets(client, [...new Set(userIds)]);
    assertActorCanUpdate(actor, targets, { bulk });
    if (bulk) assertBulkShape(targets, nextAvailable);

    const targetRole = targetBucket(targets[0].role);
    const cascadeRmIds = targets.filter(target => target.role === 'rm').map(target => target.id);
    const cascadeMembers = new Map();

    let updatedUsers = await setAvailabilityForIds(
      client,
      targets.map(target => target.id),
      nextAvailable,
      actor.id,
      reason,
    );

    if (cascadeRmIds.length) {
      const { rows: members } = await client.query(
        `SELECT id, report_to_id
           FROM users
          WHERE report_to_id = ANY($1::uuid[])
            AND role IN ('member', 'partner')
            AND deleted_at IS NULL
          FOR UPDATE`,
        [cascadeRmIds],
      );
      const memberIds = members.map(member => member.id);
      if (memberIds.length) {
        const updatedMembers = await setAvailabilityForIds(client, memberIds, nextAvailable, actor.id, reason);
        for (const rmId of cascadeRmIds) cascadeMembers.set(rmId, []);
        for (const member of updatedMembers) {
          const rmId = members.find(row => row.id === member.id)?.report_to_id;
          if (rmId) cascadeMembers.get(rmId)?.push(member);
        }
      }
    }

    await client.query(
      `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata, ip_address)
       VALUES ($1, 'user', $2, 'lead_availability_updated', $3, NULL)`,
      [
        actor.id,
        targets.length === 1 ? targets[0].id : null,
        JSON.stringify({
          user_ids: targets.map(target => target.id),
          is_available: nextAvailable,
          target_role: targetRole,
          cascade_rm_ids: cascadeRmIds,
          reason,
        }),
      ],
    ).catch(() => {});

    return {
      updatedUsers,
      updatedMembersByRmCascade: Object.fromEntries(cascadeMembers.entries()),
      targetRole,
      isAvailable: nextAvailable,
    };
  });
}

async function updateSingleLeadAvailability({ actor, userId, isAvailable, reason = null }) {
  const result = await updateLeadAvailability({
    actor,
    userIds: [userId],
    isAvailable,
    reason,
    bulk: false,
  });
  return {
    ...result,
    user: result.updatedUsers[0] || null,
  };
}

module.exports = {
  updateLeadAvailability,
  updateSingleLeadAvailability,
};
