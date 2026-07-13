const { query } = require('../config/database');
const { AppError } = require('../utils/errors');

const ADMIN_ROLES = new Set(['super_admin', 'admin']);

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeColor(value) {
  const color = String(value || '#2563EB').trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) throw new AppError(400, 'INVALID_LABEL_COLOR', 'Label color must be a six-digit hex color.');
  return color.toUpperCase();
}

function validateLabelName(value) {
  const name = normalizeName(value);
  if (name.length < 1 || name.length > 60) throw new AppError(400, 'INVALID_LABEL_NAME', 'Label name must be between 1 and 60 characters.');
  return name;
}

function labelVisibilitySql(actor, labelAlias = 'll') {
  if (ADMIN_ROLES.has(actor.role)) return { sql: 'TRUE', params: [] };
  if (actor.role === 'rm') {
    return {
      sql: `(${labelAlias}.visibility = 'global' OR ${labelAlias}.created_by_user_id = $1 OR EXISTS (
        SELECT 1 FROM users creator WHERE creator.id = ${labelAlias}.created_by_user_id AND creator.report_to_id = $1
      ))`,
      params: [actor.id],
    };
  }
  return { sql: `(${labelAlias}.visibility = 'global' OR ${labelAlias}.created_by_user_id = $1)`, params: [actor.id] };
}

async function assertLeadAccess(actor, leadId) {
  const { rows: [lead] } = await query(`
    SELECT l.id, l.assigned_to_user_id, assigned.report_to_id AS assigned_rm_id
      FROM leads l
      LEFT JOIN users assigned ON assigned.id = l.assigned_to_user_id
     WHERE l.id = $1 AND l.deleted_at IS NULL
  `, [leadId]);
  if (!lead) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found.');
  if (ADMIN_ROLES.has(actor.role)) return lead;
  if ((actor.role === 'member' || actor.role === 'partner') && lead.assigned_to_user_id === actor.id) return lead;
  if (actor.role === 'rm' && lead.assigned_rm_id === actor.id) return lead;
  throw new AppError(403, 'LEAD_LABEL_FORBIDDEN', 'You cannot manage labels for this lead.');
}

async function assertLabelVisible(actor, labelId) {
  const visibility = labelVisibilitySql(actor, 'll');
  const { rows: [label] } = await query(`
    SELECT ll.*, creator.full_name AS created_by_name, creator.role AS created_by_role
      FROM lead_labels ll
      JOIN users creator ON creator.id = ll.created_by_user_id
     WHERE ll.id = $${visibility.params.length + 1}
       AND ll.deleted_at IS NULL
       AND ${visibility.sql}
  `, [...visibility.params, labelId]);
  if (!label) throw new AppError(404, 'LABEL_NOT_FOUND', 'Label not found or not available to you.');
  return label;
}

async function listLabels(actor) {
  const visibility = labelVisibilitySql(actor, 'll');
  const { rows } = await query(`
    SELECT ll.*, creator.full_name AS created_by_name, creator.role AS created_by_role,
           COUNT(lla.lead_id)::int AS lead_count,
           COUNT(lla.lead_id)::int AS usage_count
      FROM lead_labels ll
      JOIN users creator ON creator.id = ll.created_by_user_id
      LEFT JOIN lead_label_assignments lla ON lla.label_id = ll.id
     WHERE ll.deleted_at IS NULL AND ${visibility.sql}
     GROUP BY ll.id, creator.full_name, creator.role
     ORDER BY ll.visibility DESC, LOWER(ll.name), ll.created_at DESC
  `, visibility.params);
  return rows;
}

async function createLabel(actor, input) {
  const name = validateLabelName(input?.name);
  const color = normalizeColor(input?.color);
  const visibility = ADMIN_ROLES.has(actor.role) ? (input?.visibility === 'custom' ? 'custom' : 'global') : 'custom';
  try {
    const { rows: [label] } = await query(`
      INSERT INTO lead_labels(name, color, visibility, created_by_user_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name, color, visibility, actor.id]);
    return label;
  } catch (error) {
    if (error?.code === '23505') throw new AppError(409, 'LABEL_ALREADY_EXISTS', 'A label with this name already exists in this scope.');
    throw error;
  }
}

async function getLeadLabels(actor, leadId) {
  await assertLeadAccess(actor, leadId);
  const visibility = labelVisibilitySql(actor, 'll');
  const { rows } = await query(`
    SELECT ll.*, creator.full_name AS created_by_name, creator.role AS created_by_role,
           assignment.created_at AS assigned_at, assigner.full_name AS assigned_by_name
      FROM lead_label_assignments assignment
      JOIN lead_labels ll ON ll.id = assignment.label_id AND ll.deleted_at IS NULL
      JOIN users creator ON creator.id = ll.created_by_user_id
      JOIN users assigner ON assigner.id = assignment.assigned_by_user_id
     WHERE assignment.lead_id = $${visibility.params.length + 1}
       AND ${visibility.sql}
     ORDER BY assignment.created_at DESC
  `, [...visibility.params, leadId]);
  return rows;
}

async function assignLabel(actor, leadId, labelId) {
  await assertLeadAccess(actor, leadId);
  const label = await assertLabelVisible(actor, labelId);
  await query(`
    INSERT INTO lead_label_assignments(lead_id, label_id, assigned_by_user_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (lead_id, label_id) DO NOTHING
  `, [leadId, labelId, actor.id]);
  return label;
}

async function bulkApplyLabels(actor, input = {}) {
  const leadIds = Array.isArray(input.lead_ids) ? input.lead_ids : input.leadIds;
  const labelIds = Array.isArray(input.label_ids) ? input.label_ids : input.labelIds;
  const mode = ['add', 'replace', 'remove'].includes(input.mode) ? input.mode : 'add';
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    throw new AppError(400, 'LEAD_IDS_REQUIRED', 'Select at least one lead.');
  }
  if (!Array.isArray(labelIds) || labelIds.length === 0) {
    throw new AppError(400, 'LABEL_IDS_REQUIRED', 'Select at least one label.');
  }

  const uniqueLeadIds = [...new Set(leadIds.map(String).filter(Boolean))].slice(0, 500);
  const uniqueLabelIds = [...new Set(labelIds.map(String).filter(Boolean))].slice(0, 25);
  const labels = [];
  for (const labelId of uniqueLabelIds) {
    labels.push(await assertLabelVisible(actor, labelId));
  }

  const skippedLeadIds = [];
  const changedLeadIds = [];
  for (const leadId of uniqueLeadIds) {
    try {
      await assertLeadAccess(actor, leadId);
      if (mode === 'replace') {
        await query(`DELETE FROM lead_label_assignments WHERE lead_id = $1`, [leadId]);
      }
      if (mode === 'remove') {
        await query(`DELETE FROM lead_label_assignments WHERE lead_id = $1 AND label_id = ANY($2::uuid[])`, [leadId, uniqueLabelIds]);
      } else {
        for (const labelId of uniqueLabelIds) {
          await query(`
            INSERT INTO lead_label_assignments(lead_id, label_id, assigned_by_user_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (lead_id, label_id) DO NOTHING
          `, [leadId, labelId, actor.id]);
        }
      }
      changedLeadIds.push(leadId);
    } catch (error) {
      skippedLeadIds.push(leadId);
    }
  }

  return {
    success: true,
    applied_count: changedLeadIds.length,
    skipped_count: skippedLeadIds.length,
    skipped_lead_ids: skippedLeadIds,
    labels,
    changed_lead_ids: changedLeadIds,
    mode,
  };
}

async function removeLabel(actor, leadId, labelId) {
  await assertLeadAccess(actor, leadId);
  await assertLabelVisible(actor, labelId);
  await query(`DELETE FROM lead_label_assignments WHERE lead_id = $1 AND label_id = $2`, [leadId, labelId]);
}

module.exports = { listLabels, createLabel, getLeadLabels, assignLabel, bulkApplyLabels, removeLabel, assertLabelVisible };
