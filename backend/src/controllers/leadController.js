const { query, withTransaction } = require('../config/database');
const { AppError, asyncHandler } = require('../utils/errors');
const { getVisibleUserIds } = require('../middleware/rbac');
const { assignLead, reassignLead } = require('../services/leadDistributionService');
const { appendLead: sheetAppend } = require('../services/googleSheetsService');
const { onLeadCreated, findExistingByContact } = require('../services/leadEventService');
const logger = require('../utils/logger');
const config = require('../config/env');
const { resolveLeadCategory } = require('../services/leadCategory/leadCategoryResolver');

/**
 * GET /api/leads — paginated, filterable list scoped by role.
 *
 * Query params:
 *   q                 search across name/phone/email
 *   stage             new|contacted|...
 *   call_status       not_called|rnr|...
 *   source            meta|google|...
 *   form_id           Meta form ID
 *   assigned_to       user id  (admin only — RM auto-scoped, members locked to self)
 *   from, to          ISO dates (filters created_at)
 *   pending           true => only is_pending leads
 *   followup          today|overdue|week
 *   page, page_size
 *   sort              created_at | assigned_at | next_followup_at  (default created_at)
 *   order             asc | desc
 */
exports.list = asyncHandler(async (req, res) => {
  const visible = await getVisibleUserIds(req.user);
  const where   = [`l.deleted_at IS NULL`];
  const params  = [];

  // role scoping
  if (visible !== null) {
    if (visible.length === 0) return res.json({ success: true, data: { rows: [], total: 0 } });
    params.push(visible);
    where.push(`l.assigned_to_user_id = ANY($${params.length}::uuid[])`);
  }

  // explicit assigned_to filter (admin/RM only — and RM can only narrow within visible set)
  if (req.query.assigned_to) {
    if (req.query.assigned_to === '__unassigned') {
      where.push(`l.assigned_to_user_id IS NULL`);
    } else {
      params.push(req.query.assigned_to);
      where.push(`l.assigned_to_user_id = $${params.length}`);
    }
  }

  if (req.query.q) {
    params.push(`%${req.query.q.trim()}%`);
    const n = params.length;
    where.push(`(l.full_name ILIKE $${n} OR l.phone ILIKE $${n} OR l.email ILIKE $${n})`);
  }
  if (req.query.stage)       { params.push(req.query.stage);        where.push(`l.stage = $${params.length}`); }
  if (req.query.call_status) { params.push(req.query.call_status);  where.push(`l.call_status = $${params.length}`); }
  if (req.query.source)      { params.push(req.query.source);       where.push(`l.source = $${params.length}`); }
  if (req.query.form_id)     { params.push(req.query.form_id);      where.push(`l.meta_form_id = $${params.length}`); }
  if (req.query.campaign_id) {
    params.push(req.query.campaign_id);
    const n = params.length;
    where.push(`(
      l.meta_campaign_id = $${n}
      OR EXISTS (
        SELECT 1 FROM meta_campaigns mc
         WHERE mc.campaign_id = l.meta_campaign_id
           AND mc.campaign_id = $${n}
      )
    )`);
  }
  if (req.query.campaign) {
    params.push(`%${String(req.query.campaign).trim()}%`);
    const n = params.length;
    where.push(`(
      l.campaign_name ILIKE $${n}
      OR l.campaign_label ILIKE $${n}
      OR l.meta_campaign_id ILIKE $${n}
      OR EXISTS (
        SELECT 1 FROM meta_campaigns mc
         WHERE mc.campaign_id = l.meta_campaign_id
           AND (mc.campaign_name ILIKE $${n} OR mc.internal_label ILIKE $${n})
      )
    )`);
  }
  if (req.query.adset)       { params.push(req.query.adset);        where.push(`l.adset_name = $${params.length}`); }
  if (req.query.from)        { params.push(req.query.from);         where.push(`l.created_at >= $${params.length}`); }
  if (req.query.to)          { params.push(req.query.to);           where.push(`l.created_at <= $${params.length}`); }
  if (req.query.pending === 'true') where.push(`l.is_pending = TRUE`);
  if (req.query.category && ['partner', 'trader', 'unknown'].includes(req.query.category)) {
    params.push(req.query.category);
    where.push(`l.category = $${params.length}`);
  }

  if (req.query.followup === 'today') {
    where.push(`l.next_followup_at::date = CURRENT_DATE`);
  } else if (req.query.followup === 'overdue') {
    where.push(`l.next_followup_at < NOW()`);
  } else if (req.query.followup === 'week') {
    where.push(`l.next_followup_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'`);
  }

  const allowedSort  = new Set(['created_at', 'assigned_at', 'next_followup_at', 'updated_at']);
  const sortCol      = allowedSort.has(req.query.sort) ? req.query.sort : 'created_at';
  const sortOrd      = req.query.order === 'asc' ? 'ASC' : 'DESC';

  const page         = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize     = Math.min(200, Math.max(1, parseInt(req.query.page_size || '25', 10)));
  const offset       = (page - 1) * pageSize;

  const whereSql = where.join(' AND ');

  const totalRes = await query(`SELECT COUNT(*) FROM leads l WHERE ${whereSql}`, params);
  const total    = parseInt(totalRes.rows[0].count, 10);

  params.push(pageSize); const limitIdx  = params.length;
  params.push(offset);   const offsetIdx = params.length;

  const sql = `
    SELECT
      l.id, l.full_name, l.phone, l.email, l.city, l.state,
      l.source, l.meta_form_id, l.campaign_label, l.product_tag,
      l.category, l.category_source, l.category_rule_id, l.category_resolved_at,
      l.campaign_name, l.adset_name, l.ad_name,
      l.meta_campaign_id, l.meta_adset_id, l.meta_ad_id,
      l.stage, l.call_status, l.last_call_at, l.next_followup_at, l.call_attempts,
      l.assigned_to_user_id, u.full_name AS assigned_to_name,
      l.locked_by_user_id, l.locked_until,
      l.created_at, l.assigned_at, l.updated_at
    FROM leads l
    LEFT JOIN users u ON u.id = l.assigned_to_user_id
    WHERE ${whereSql}
    ORDER BY l.${sortCol} ${sortOrd} NULLS LAST
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;
  const { rows } = await query(sql, params);

  res.json({ success: true, data: { rows, total, page, pageSize } });
});

exports.getOne = asyncHandler(async (req, res) => {
  const visible = await getVisibleUserIds(req.user);
  const params = [req.params.id];
  let scope = '';
  if (visible !== null) {
    params.push(visible);
    scope = ` AND l.assigned_to_user_id = ANY($2::uuid[])`;
  }
  const { rows } = await query(
    `SELECT l.*, u.full_name AS assigned_to_name
       FROM leads l LEFT JOIN users u ON u.id = l.assigned_to_user_id
      WHERE l.id = $1 AND l.deleted_at IS NULL ${scope}`,
    params
  );
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Lead not found');

  const remarks = await query(
    `SELECT r.id, r.remark, r.call_status, r.next_followup_at, r.created_at,
            u.full_name AS by_name
       FROM lead_remarks r JOIN users u ON u.id = r.user_id
      WHERE r.lead_id = $1 ORDER BY r.created_at DESC`,
    [req.params.id]
  );
  const history = await query(
    `SELECT a.assigned_at, a.unassigned_at, a.reason,
            u.full_name AS user_name, b.full_name AS assigned_by_name
       FROM lead_assignments a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN users b ON b.id = a.assigned_by
      WHERE a.lead_id = $1 ORDER BY a.assigned_at DESC`,
    [req.params.id]
  );

  res.json({ success: true, data: { ...rows[0], remarks: remarks.rows, history: history.rows } });
});

/**
 * Pending-lead lock: when a member opens a lead to call it, we lock it for
 * config.leadLock.durationMinutes so a teammate doesn't race-call the same lead.
 */
exports.lock = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const result = await withTransaction(async (client) => {
    const { rows: [lead] } = await client.query(
      `SELECT id, assigned_to_user_id, locked_by_user_id, locked_until
         FROM leads WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id]
    );
    if (!lead) throw new AppError(404, 'NOT_FOUND', 'Lead not found');

    if (req.user.role === 'member' && lead.assigned_to_user_id !== req.user.id) {
      throw new AppError(403, 'FORBIDDEN', 'Lead not assigned to you');
    }
    if (lead.locked_by_user_id && lead.locked_by_user_id !== req.user.id &&
        lead.locked_until && new Date(lead.locked_until) > new Date()) {
      throw new AppError(409, 'LOCKED', 'Lead is currently being worked on by another user');
    }
    const until = new Date(Date.now() + config.leadLock.durationMinutes * 60_000);
    await client.query(
      `UPDATE leads SET locked_by_user_id = $1, locked_until = $2 WHERE id = $3`,
      [req.user.id, until, id]
    );
    return { lockedUntil: until };
  });
  res.json({ success: true, data: result });
});

exports.unlock = asyncHandler(async (req, res) => {
  await query(
    `UPDATE leads SET locked_by_user_id = NULL, locked_until = NULL
      WHERE id = $1 AND (locked_by_user_id = $2 OR $3 IN ('super_admin','rm'))`,
    [req.params.id, req.user.id, req.user.role]
  );
  res.json({ success: true });
});

/**
 * POST /api/leads/:id/remarks
 * Body: { remark, call_status?, next_followup_at?, stage? }
 * Updates lead call_status, next_followup_at, call_attempts atomically.
 */
exports.addRemark = asyncHandler(async (req, res) => {
  const { remark, call_status, next_followup_at, stage } = req.body;
  if (!remark || !remark.trim()) throw new AppError(400, 'REMARK_REQUIRED', 'Remark is required');

  const result = await withTransaction(async (client) => {
    const { rows: [lead] } = await client.query(
      `SELECT id, assigned_to_user_id FROM leads WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [req.params.id]
    );
    if (!lead) throw new AppError(404, 'NOT_FOUND', 'Lead not found');
    if (req.user.role === 'member' && lead.assigned_to_user_id !== req.user.id) {
      throw new AppError(403, 'FORBIDDEN', 'Lead not assigned to you');
    }

    const { rows: [r] } = await client.query(
      `INSERT INTO lead_remarks(lead_id, user_id, remark, call_status, next_followup_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, req.user.id, remark.trim(), call_status || null, next_followup_at || null]
    );

    const updates = [];
    const params  = [req.params.id];
    if (call_status) {
      params.push(call_status);
      updates.push(`call_status = $${params.length}`);
      updates.push(`last_call_at = NOW()`);
      updates.push(`call_attempts = call_attempts + 1`);
    }
    if (next_followup_at) { params.push(next_followup_at); updates.push(`next_followup_at = $${params.length}`); }
    if (stage)            { params.push(stage);            updates.push(`stage = $${params.length}`); }
    // release lock for this user after they've worked the lead
    updates.push(`locked_by_user_id = NULL`, `locked_until = NULL`);

    if (updates.length > 0) {
      await client.query(`UPDATE leads SET ${updates.join(', ')} WHERE id = $1`, params);
    }
    return r;
  });

  res.status(201).json({ success: true, data: result });
});

/** Admin/RM only: change assignment manually. */
exports.reassign = asyncHandler(async (req, res) => {
  if (!['super_admin', 'rm'].includes(req.user.role)) throw new AppError(403, 'FORBIDDEN', 'Not allowed');
  const { to_user_id } = req.body;
  if (!to_user_id) throw new AppError(400, 'TO_USER_REQUIRED', 'to_user_id required');

  // Capture old assignee + names for the audit row BEFORE the reassign happens.
  const { rows: [prev] } = await query(
    `SELECT l.assigned_to_user_id, u.full_name AS prev_name FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to_user_id WHERE l.id = $1`,
    [req.params.id]
  );
  const { rows: [target] } = await query(`SELECT full_name FROM users WHERE id = $1`, [to_user_id]);

  const out = await reassignLead(req.params.id, to_user_id, req.user.id, 'manual');

  const { logActivity } = require('../utils/auditLog');
  await logActivity(req, {
    entity: 'lead', entity_id: req.params.id, action: 'reassigned',
    old_value: prev?.prev_name || prev?.assigned_to_user_id || '(unassigned)',
    new_value: target?.full_name || to_user_id,
    metadata: { from_user_id: prev?.assigned_to_user_id || null, to_user_id, reason: 'manual' },
  });

  res.json({ success: true, data: out });
});

/** Admin/RM: manually create a lead and auto-assign. */
exports.create = asyncHandler(async (req, res) => {
  if (!['super_admin', 'rm'].includes(req.user.role)) throw new AppError(403, 'FORBIDDEN', 'Not allowed');
  const { full_name, phone, email, city, state, source, product_tag, campaign_label, campaign_name, meta_campaign_id, meta_form_id, raw_payload, assigned_to_user_id } = req.body;
  if (!full_name && !phone && !email) throw new AppError(400, 'INVALID_LEAD', 'Provide at least name/phone/email');

  // Phone/email dedup — the same person shouldn't be entered twice from a
  // manual form either.
  if (phone || email) {
    const dup = await findExistingByContact({ phone, email });
    if (dup) {
      return res.status(409).json({ success: false, error: { code: 'DUPLICATE_LEAD', message: `Lead already exists (matched by ${dup.reason})`, data: { id: dup.id } } });
    }
  }

  const categoryResolution = await resolveLeadCategory({ leadPayload: req.body || {} });
  const { rows: [lead] } = await query(
    `INSERT INTO leads (full_name, phone, email, city, state, source, product_tag, campaign_label,
                        campaign_name, meta_campaign_id, meta_form_id, raw_payload,
                        category, category_source, category_rule_id, category_resolved_at)
        VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'manual')::lead_source, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
        RETURNING id`,
    [full_name, phone, email, city, state, source || null, product_tag, campaign_label,
      campaign_name || null, meta_campaign_id || null, meta_form_id || null, raw_payload || null,
      categoryResolution.category, categoryResolution.source, categoryResolution.rule_id]
  );

  let assignment;
  if (assigned_to_user_id) {
    assignment = await reassignLead(lead.id, assigned_to_user_id, req.user.id, 'manual');
  } else {
    assignment = await assignLead(lead.id);
  }

  // Single chokepoint: Socket.IO broadcast + Google Sheet append (non-blocking)
  onLeadCreated(lead.id, { source: 'manual_create' });

  const { logActivity } = require('../utils/auditLog');
  await logActivity(req, {
    entity: 'lead', entity_id: lead.id, action: 'created',
    new_value: full_name || phone || email || '(unnamed)',
    metadata: { source: source || 'manual', assigned_to_user_id: assigned_to_user_id || null, campaign_label, product_tag },
  });

  res.status(201).json({ success: true, data: { id: lead.id, assignment } });
});
