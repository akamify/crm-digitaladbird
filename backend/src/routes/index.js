const router = require('express').Router();
const auth    = require('../controllers/authController');
const users   = require('../controllers/userController');
const leads   = require('../controllers/leadController');
const reports = require('../controllers/reportController');
const meta    = require('../controllers/metaController');
const { authenticate, invalidateUser }    = require('../middleware/auth');
const { requireRole, requireMemberType }  = require('../middleware/rbac');
const { responseCache }                   = require('../middleware/cache');
const { broadcastLeadRequest }            = require('../services/socketService');
const logger                              = require('../utils/logger');
const { query } = require('../config/database');
const { asyncHandler, AppError } = require('../utils/errors');
const assignmentEngine = require('../services/leadAssignmentEngine');
const { validateLeadAssignee } = require('../services/leadAssigneeValidator');
const { normalizeRole } = require('../services/userIdentityService');
const notifications = require('../services/notificationService');
const leadStatusOptions = require('../constants/leadStatusOptions');
const { updateLeadAvailability, updateSingleLeadAvailability } = require('../services/userAvailabilityService');

// Loads a lead-request enriched with user + RM context and emits the
// appropriate `lead-request:<kind>` Socket.IO event so admin + RM + the
// requester themselves see status changes instantly.
async function emitLeadRequest(kind, requestId) {
  try {
    const { query: q } = require('../config/database');
    const { rows: [r] } = await q(
      `SELECT lr.id, lr.user_id, lr.quantity, lr.category, lr.status, lr.leads_assigned,
              lr.created_at, lr.note,
              u.full_name AS user_name, u.role AS user_role, u.report_to_id, u.team_name
         FROM lead_requests lr
         JOIN users u ON u.id = lr.user_id
        WHERE lr.id = $1`,
      [requestId],
    );
    if (r) broadcastLeadRequest(kind, r);
  } catch (_) { /* never fail a route on a broadcast error */ }
}

// ---- Auth ---------------------------------------------------------
router.post('/auth/login',       auth.login);        // demo mode: direct password login
router.post('/auth/request-otp', auth.requestOtp);   // production: step 1
router.post('/auth/verify-otp',  auth.verifyOtp);    // production: step 2
router.post('/auth/refresh',     auth.refresh);
router.post('/auth/logout',      auth.logout);
router.get ('/auth/me',          authenticate, auth.me);

// ---- Users --------------------------------------------------------
router.get   ('/users',           authenticate, responseCache(10000), users.list);
router.get   ('/users/hierarchy', authenticate, requireRole('super_admin', 'rm'), users.hierarchy);
router.post  ('/users',           authenticate, requireRole('super_admin', 'admin'), users.create);
router.get   ('/users/deleted',   authenticate, requireRole('super_admin', 'admin'), users.deleted);
router.post  ('/users/:id/block', authenticate, requireRole('super_admin', 'admin'), users.block);
router.post  ('/users/:id/unblock', authenticate, requireRole('super_admin', 'admin'), users.unblock);
router.post  ('/users/:id/delete', authenticate, requireRole('super_admin', 'admin'), users.softDelete);
router.patch ('/users/:userId/lead-availability', authenticate, requireRole('super_admin', 'admin', 'rm'), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const status = req.body?.lead_assignment_status || req.body?.status || req.body?.is_available;
  const reason = String(req.body?.reason || req.body?.lead_assignment_disabled_reason || '').trim() || null;
  const result = await updateSingleLeadAvailability({
    actor: req.user,
    userId,
    isAvailable: status,
    reason,
  });
  for (const updated of result.updatedUsers) invalidateUser(updated.id);
  Object.values(result.updatedMembersByRmCascade || {}).flat().forEach(member => invalidateUser(member.id));
  res.json({ success: true, data: result, message: 'Lead assignment availability updated.' });
}));
router.patch('/users/lead-availability/bulk', authenticate, requireRole('super_admin', 'admin'), asyncHandler(async (req, res) => {
  const userIds = Array.isArray(req.body?.user_ids) ? req.body.user_ids : req.body?.userIds;
  const status = req.body?.lead_assignment_status || req.body?.status || req.body?.is_available;
  const reason = String(req.body?.reason || '').trim() || null;
  const result = await updateLeadAvailability({
    actor: req.user,
    userIds,
    isAvailable: status,
    reason,
    bulk: true,
  });
  for (const updated of result.updatedUsers) invalidateUser(updated.id);
  Object.values(result.updatedMembersByRmCascade || {}).flat().forEach(member => invalidateUser(member.id));
  res.json({ success: true, data: result, message: 'Lead assignment availability updated.' });
}));
router.patch ('/users/:id',       authenticate, requireRole('super_admin', 'admin'), users.update);
router.delete('/users/:id',       authenticate, requireRole('super_admin', 'admin'), users.softDelete);

// ---- Leads --------------------------------------------------------
router.get  ('/leads',            authenticate, leads.list);
router.post ('/leads/bulk/remarks', authenticate, leads.bulkAddRemarks);
router.get  ('/leads/:id',        authenticate, leads.getOne);
router.post ('/leads',            authenticate, requireRole('super_admin', 'rm'), leads.create);
router.post ('/leads/:id/lock',   authenticate, leads.lock);
router.post ('/leads/:id/unlock', authenticate, leads.unlock);
router.post ('/leads/:id/remarks',  authenticate, leads.addRemark);
router.post ('/leads/:id/reassign', authenticate, requireRole('super_admin', 'rm'), leads.reassign);

// ---- Reports (cached for performance) ---------------------------------
router.get('/reports/summary', authenticate, responseCache(15000), reports.summary);
router.get('/reports/daily',   authenticate, responseCache(30000), reports.daily);
router.get('/reports/by-user', authenticate, requireRole('super_admin', 'rm'), responseCache(15000), reports.byUser);
router.get('/reports/funnel',  authenticate, responseCache(30000), reports.funnel);
router.get('/reports/sources', authenticate, responseCache(30000), reports.sources);
router.get('/reports/categories', authenticate, responseCache(30000), reports.categories);

// ---- Admin: Distribution rules + Meta management ------------------
router.get('/rules',  authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const { rows } = await query(`SELECT * FROM distribution_rules ORDER BY priority`);
  res.json({ success: true, data: rows });
}));
router.post('/rules', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { name, form_id, strategy, eligible_user_ids, priority } = req.body;
  if (!name || !strategy) throw new AppError(400, 'INVALID', 'name & strategy required');
  if (strategy !== 'round_robin') {
    throw new AppError(422, 'DISTRIBUTION_METHOD_DISABLED', 'Only round robin auto distribution is supported.');
  }
  const { rows: [r] } = await query(
    `INSERT INTO distribution_rules(name, form_id, strategy, eligible_user_ids, priority)
       VALUES ($1, $2, $3, $4, COALESCE($5, 100)) RETURNING *`,
    [name, form_id || null, strategy, eligible_user_ids || [], priority]
  );
  res.status(201).json({ success: true, data: r });
}));

router.get('/meta/pages',  authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const { rows } = await query(`
    SELECT id, page_id, page_name, is_active, created_at,
           token_is_valid, token_last_checked, token_last_error,
           webhook_subscribed, webhook_last_checked, forms_status,
           forms_last_checked, stale_at, deactivated_at,
           connection_status, selected_at, selected_by_user_id,
           deactivation_reason
      FROM meta_pages
     ORDER BY is_active DESC, page_name NULLS LAST, page_id
  `);
  res.json({ success: true, data: rows });
}));
router.post('/meta/pages', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { page_id, page_name, page_access_token, skip_validation } = req.body;
  if (!page_id || !page_access_token) throw new AppError(400, 'INVALID', 'page_id and page_access_token required');

  // Validate the token against Meta Graph API before saving so the user
  // gets a clear error (expired / wrong page) instead of silent webhook failures.
  let resolvedName = page_name || null;
  if (!skip_validation) {
    try {
      const verify = await require('../services/metaGraphClient').graphGet(page_id, { fields: 'id,name,username,category' }, page_access_token, { pageId: page_id, tokenSource: 'candidate_page_token' });
      if (String(verify.id) !== String(page_id)) {
        throw new AppError(400, 'TOKEN_PAGE_MISMATCH', `Token belongs to page ${verify.id} (${verify.name}), not ${page_id}`);
      }
      resolvedName = resolvedName || verify.name;
    } catch (err) {
      if (err instanceof AppError) throw err;
      const fb = err.response?.data?.error;
      throw new AppError(400, 'TOKEN_INVALID', fb?.message || err.message || 'Token validation failed against Meta Graph API', { meta_code: fb?.code, type: fb?.type });
    }
  }

  const { rows: [r] } = await query(
    `INSERT INTO meta_pages(page_id, page_name, page_access_token, is_active,
                            connection_status, selected_at, selected_by_user_id,
                            token_is_valid, token_last_checked, token_last_error)
       VALUES ($1, $2, $3, TRUE, 'active', NOW(), $4, TRUE, NOW(), NULL)
       ON CONFLICT (page_id) DO UPDATE SET page_access_token = EXCLUDED.page_access_token,
                                            page_name        = COALESCE(EXCLUDED.page_name, meta_pages.page_name),
                                            is_active        = TRUE,
                                            connection_status = 'active',
                                            selected_at      = COALESCE(meta_pages.selected_at, NOW()),
                                            selected_by_user_id = COALESCE(meta_pages.selected_by_user_id, EXCLUDED.selected_by_user_id),
                                            stale_at         = NULL,
                                            deactivated_at   = NULL,
                                            deactivation_reason = NULL,
                                            token_is_valid   = TRUE,
                                            token_last_checked = NOW(),
                                            token_last_error = NULL,
                                            updated_at       = NOW()
       RETURNING id, page_id, page_name`,
    [page_id, resolvedName, page_access_token, req.user.id]
  );
  {
    const { logActivity } = require('../utils/auditLog');
    await logActivity(req, {
      entity: 'meta_page', entity_id: page_id, action: 'added_or_updated',
      new_value: resolvedName || page_id,
      // never log the token itself — just record that one was set
      metadata: { page_name: resolvedName, token_present: !!page_access_token, skip_validation: !!skip_validation },
    });
  }
  res.json({ success: true, data: r });
}));

// Token-only update for a single page (POST body: { page_access_token })
router.patch('/meta/pages/:pageId/token', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { pageId } = req.params;
  const { page_access_token } = req.body;
  if (!page_access_token) throw new AppError(400, 'INVALID', 'page_access_token required');

  // Validate against Graph API first
  try {
    const verify = await require('../services/metaGraphClient').graphGet(pageId, { fields: 'id,name' }, page_access_token, { pageId, tokenSource: 'candidate_page_token' });
    if (String(verify.id) !== String(pageId)) {
      throw new AppError(400, 'TOKEN_PAGE_MISMATCH', `Token belongs to ${verify.id} (${verify.name}), not page ${pageId}`);
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    const fb = err.response?.data?.error;
    throw new AppError(400, 'TOKEN_INVALID', fb?.message || err.message || 'Token validation failed', { meta_code: fb?.code, type: fb?.type });
  }

  const { rowCount, rows } = await query(
    `UPDATE meta_pages
        SET page_access_token = $1, token_is_valid = TRUE,
            token_last_checked = NOW(), token_last_error = NULL, updated_at = NOW()
      WHERE page_id = $2
      RETURNING id, page_id, page_name`,
    [page_access_token, pageId]
  );
  if (!rowCount) throw new AppError(404, 'NOT_FOUND', 'Page not registered in CRM — use POST /meta/pages first');
  {
    const { logActivity } = require('../utils/auditLog');
    await logActivity(req, {
      entity: 'meta_page', entity_id: pageId, action: 'token_updated',
      new_value: rows[0].page_name || pageId,
      metadata: { page_id: pageId, page_name: rows[0].page_name }, // never log the token bytes
    });
  }
  res.json({ success: true, data: rows[0] });
}));

router.post('/meta/pages/:pageId/update-token', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { pageId } = req.params;
  const pageAccessToken = req.body?.pageAccessToken || req.body?.page_access_token;
  if (!pageAccessToken) throw new AppError(400, 'INVALID', 'pageAccessToken required');
  const result = await updateMetaPageTokenWorkflow({
    pageId,
    pageAccessToken,
    subscribeWebhook: req.body?.subscribeWebhook !== false,
    syncForms: req.body?.syncForms !== false,
  });
  const { logActivity } = require('../utils/auditLog');
  await logActivity(req, {
    entity: 'meta_page',
    entity_id: pageId,
    action: 'page_token_updated',
    metadata: { page_id: pageId, webhook: result.webhook, forms: result.forms },
  });
  res.json({ success: true, data: result });
}));

router.post('/meta/pages/:pageId/deactivate', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { pageId } = req.params;
  const tokenResolver = require('../services/metaTokenResolver');
  const page = await tokenResolver.deactivatePage(pageId, req.user.id);
  if (!page) throw new AppError(404, 'NOT_FOUND', 'Page not registered in CRM');
  res.json({ success: true, data: page });
}));

router.patch('/admin/meta/pages/:pageId/activation', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { pageId } = req.params;
  if (typeof req.body?.is_active !== 'boolean') {
    throw new AppError(400, 'INVALID_META_PAGE_ACTIVATION', 'is_active must be true or false');
  }

  const tokenResolver = require('../services/metaTokenResolver');
  if (req.body.is_active) {
    const { rows: [candidate] } = await query(
      `SELECT page_access_token FROM meta_pages WHERE page_id = $1`,
      [pageId],
    );
    if (!candidate) throw new AppError(404, 'NOT_FOUND', 'Page not registered in CRM');
    if (!candidate.page_access_token) {
      throw new AppError(409, 'META_PAGE_TOKEN_MISSING', tokenResolver.PAGE_TOKEN_MISSING_MESSAGE);
    }
    await require('../services/metaGraphClient').graphGet(
      pageId,
      { fields: 'id,name' },
      candidate.page_access_token,
      { pageId, tokenSource: 'db_page_token' },
    );
  } else {
    const { rows: [candidate] } = await query(
      `SELECT page_access_token FROM meta_pages WHERE page_id = $1`,
      [pageId],
    );
    if (!candidate) throw new AppError(404, 'NOT_FOUND', 'Page not registered in CRM');
    if (candidate.page_access_token) {
      await metaSync.unsubscribePageFromLeadgen(pageId, candidate.page_access_token)
        .catch(error => logger.warn({ err: error.message, pageId }, '[Meta] webhook unsubscribe failed during deactivation'));
    }
  }
  const page = await tokenResolver.setPageActivation(
    pageId,
    req.body.is_active,
    req.user.id,
    req.body?.reason || null,
  );
  if (!page) throw new AppError(404, 'NOT_FOUND', 'Page not registered in CRM');

  const result = { ...page, webhook: 'skipped', forms: 'skipped' };
  if (page.is_active) {
    const token = await tokenResolver.getRequiredPageToken(pageId);
    if (!token?.token) throw new AppError(409, 'META_PAGE_TOKEN_MISSING', tokenResolver.PAGE_TOKEN_MISSING_MESSAGE);
    Object.assign(result, await subscribeAndVerifyMetaPage(pageId));
    Object.assign(result, await syncFormsForMetaPage(pageId));
  } else {
    await tokenResolver.updatePageWebhookStatus(pageId, { subscribed: false }).catch(() => {});
    result.webhook = 'not_subscribed';
  }

  const { logActivity } = require('../utils/auditLog');
  await logActivity(req, {
    entity: 'meta_page',
    entity_id: pageId,
    action: page.is_active ? 'activated' : 'deactivated',
    metadata: { page_id: pageId, connection_status: page.connection_status },
  }).catch(error => logger.warn({ err: error.message, pageId }, '[Meta] page activation audit failed'));

  res.json({ success: true, data: result });
}));

router.post('/meta/pages/:pageId/sync-forms', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { pageId } = req.params;
  const result = await syncFormsForMetaPage(pageId);
  if (result.forms === 'error' || result.forms === 'permission_error') {
    return res.status(502).json({ success: false, error: { code: 'META_FORMS_SYNC_FAILED', message: result.error }, data: result });
  }
  res.json({ success: true, data: result });
}));

// Test an existing page's stored token against Graph API
router.get('/meta/pages/:pageId/token-test', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { pageId } = req.params;
  const { rows: [page] } = await query(
    `SELECT page_access_token, page_name FROM meta_pages WHERE page_id = $1`,
    [pageId]
  );
  if (!page) throw new AppError(404, 'NOT_FOUND', 'Page not registered');
  if (!page.page_access_token) {
    return res.json({ success: true, data: { ok: false, reason: 'No token stored' } });
  }
  try {
    const verify = await require('../services/metaGraphClient').graphGet(pageId, { fields: 'id,name,category' }, page.page_access_token, { pageId, tokenSource: 'db_page_token' });
    await require('../services/metaTokenResolver').updatePageHealth(pageId, { valid: true });
    res.json({ success: true, data: { ok: true, page_id: verify.id, name: verify.name, category: verify.category } });
  } catch (err) {
    const fb = err.response?.data?.error;
    res.json({
      success: true,
      data: {
        ok: false,
        reason: fb?.message || err.message,
        meta_code: fb?.code,
        type: fb?.type,
        is_expired: /expired|invalid|session/i.test(fb?.message || ''),
      },
    });
  }
}));

router.get('/meta/forms',  authenticate, requireRole('super_admin', 'rm'), asyncHandler(async (_req, res) => {
  const { rows } = await query(`SELECT * FROM meta_forms ORDER BY form_name`);
  res.json({ success: true, data: rows });
}));

// Live form details from Meta Graph API (used by "View Form" button)
router.get('/meta/forms/:formId/details', authenticate, requireRole('super_admin', 'rm'), asyncHandler(async (req, res) => {
  const { formId } = req.params;
  const metaSvc = require('../services/metaService');

  // Resolve the page that owns this form
  const { rows: [formRow] } = await query(
    `SELECT f.form_id, f.form_name, f.page_id, f.campaign_label, f.product_tag, f.is_active, f.created_at,
            p.page_name, p.page_access_token
       FROM meta_forms f
       LEFT JOIN meta_pages p ON p.page_id = f.page_id
      WHERE f.form_id = $1`,
    [formId]
  );
  if (!formRow) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Form not registered in CRM' } });

  const pageToken = formRow.page_id
    ? await require('../services/metaTokenResolver').getPageTokenByPageId(formRow.page_id)
    : null;
  if (!pageToken) {
    return res.status(409).json({
      success: false,
      error: { code: 'NO_TOKEN', message: 'No Meta page access token configured. Add one in Settings → Meta Pages.' },
      data: { local: formRow, live: null },
    });
  }

  try {
    const live = await metaSvc.fetchFormFromGraph(formId, pageToken.token);
    res.json({ success: true, data: { local: formRow, live } });
  } catch (err) {
    const fbErr = err.response?.data?.error;
    return res.status(502).json({
      success: false,
      error: {
        code: 'META_GRAPH_ERROR',
        message: fbErr?.message || err.message || 'Failed to fetch form from Meta',
        type: fbErr?.type || null,
        meta_code: fbErr?.code || null,
      },
      data: { local: formRow, live: null },
    });
  }
}));
router.post('/meta/forms', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { form_id, form_name, page_id, campaign_label, product_tag } = req.body;
  const { rows: [r] } = await query(
    `INSERT INTO meta_forms(form_id, form_name, page_id, campaign_label, product_tag)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (form_id) DO UPDATE SET form_name = EXCLUDED.form_name,
                                            campaign_label = EXCLUDED.campaign_label,
                                            product_tag    = EXCLUDED.product_tag,
                                            is_active      = TRUE
       RETURNING *`,
    [form_id, form_name, page_id, campaign_label, product_tag]
  );
  res.json({ success: true, data: r });
}));

// ---- Distribution Settings (Super Admin) --------------------------
const { distributeQueue, getSetting } = require('../services/distributionScheduler');

router.get('/settings/distribution', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const { rows } = await query(`SELECT key, value, label, updated_at FROM distribution_settings ORDER BY key`);
  res.json({ success: true, data: rows });
}));

router.patch('/settings/distribution', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const allowed = new Set(['auto_distribution_enabled', 'distribution_start_hour', 'distribution_end_hour', 'pending_block_threshold']);
  const updated = [];
  for (const [key, value] of Object.entries(req.body || {})) {
    if (!allowed.has(key)) continue;
    await query(
      `INSERT INTO distribution_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, String(value)]
    );
    updated.push(key);
  }
  res.json({ success: true, data: { updated } });
}));

// Force-distribute all queued leads right now (admin override)
router.post('/settings/distribution/run-now', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const result = await distributeQueue();
  res.json({ success: true, data: result });
}));

// ---- Distribution Queue Status (Super Admin / RM) -------------------
router.get('/distribution/queue', authenticate, requireRole('super_admin', 'rm'), asyncHandler(async (_req, res) => {
  const { rows: [q] } = await query(`
    SELECT COUNT(*) AS queued,
           MIN(created_at) AS oldest_queued_at
      FROM leads
     WHERE assigned_to_user_id IS NULL AND deleted_at IS NULL
  `);
  res.json({ success: true, data: { queued: parseInt(q.queued, 10), oldestQueuedAt: q.oldest_queued_at } });
}));

// ---- Approval System (Super Admin) ----------------------------------
const { checkPendingBlocking } = require('../services/leadDistributionService');

// List blocked members
router.get('/distribution/blocked', authenticate, requireRole('super_admin', 'rm'), asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT u.id, u.full_name, u.email, u.team_name, u.distribution_blocked_reason,
           u.distribution_blocked_at,
           (SELECT COUNT(*) FROM leads l WHERE l.assigned_to_user_id = u.id
              AND l.is_pending = TRUE AND l.deleted_at IS NULL) AS pending_count,
           (SELECT COUNT(*) FROM leads l2 WHERE l2.assigned_to_user_id = u.id
              AND l2.deleted_at IS NULL) AS total_leads,
           (SELECT COUNT(*) FROM leads l3 WHERE l3.assigned_to_user_id = u.id
              AND l3.call_status <> 'not_called' AND l3.deleted_at IS NULL) AS worked_count
      FROM users u
     WHERE u.distribution_blocked = TRUE AND u.deleted_at IS NULL
     ORDER BY u.distribution_blocked_at DESC
  `);
  res.json({ success: true, data: rows });
}));

// List pending approvals
router.get('/distribution/approvals', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const status = req.query.status || 'pending';
  const { rows } = await query(`
    SELECT da.*, u.full_name, u.email, u.team_name,
           r.full_name AS resolved_by_name
      FROM distribution_approvals da
      JOIN users u ON u.id = da.user_id
      LEFT JOIN users r ON r.id = da.resolved_by
     WHERE da.status = $1
     ORDER BY da.requested_at DESC
     LIMIT 100
  `, [status]);
  res.json({ success: true, data: rows });
}));

// Admin: approve (unblock) a member
router.post('/distribution/approvals/:id/approve', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: [approval] } = await query(
    `UPDATE distribution_approvals SET status = 'approved', resolved_by = $1, resolved_at = NOW(), notes = $2
       WHERE id = $3 AND status = 'pending' RETURNING user_id`,
    [req.user.id, req.body.notes || null, id]
  );
  if (!approval) throw new AppError(404, 'NOT_FOUND', 'Approval not found or already resolved');

  await query(
    `UPDATE users SET distribution_blocked = FALSE, distribution_blocked_reason = NULL, distribution_blocked_at = NULL
       WHERE id = $1`,
    [approval.user_id]
  );
  res.json({ success: true, data: { unblocked: approval.user_id } });
}));

// Admin: reject (keep blocked)
router.post('/distribution/approvals/:id/reject', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: [approval] } = await query(
    `UPDATE distribution_approvals SET status = 'rejected', resolved_by = $1, resolved_at = NOW(), notes = $2
       WHERE id = $3 AND status = 'pending' RETURNING user_id`,
    [req.user.id, req.body.notes || null, id]
  );
  if (!approval) throw new AppError(404, 'NOT_FOUND', 'Approval not found or already resolved');
  res.json({ success: true, data: { rejected: approval.user_id } });
}));

// Admin: force unblock a user (override without approval)
router.post('/distribution/unblock/:userId', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  await query(
    `UPDATE users SET distribution_blocked = FALSE, distribution_blocked_reason = NULL, distribution_blocked_at = NULL
       WHERE id = $1`,
    [req.params.userId]
  );
  // Resolve any pending approvals for this user
  await query(
    `UPDATE distribution_approvals SET status = 'approved', resolved_by = $1, resolved_at = NOW(), notes = 'Admin force-unblock'
       WHERE user_id = $2 AND status = 'pending'`,
    [req.user.id, req.params.userId]
  );
  res.json({ success: true });
}));

// Re-check pending blocking manually
router.post('/distribution/check-blocking', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const blocked = await checkPendingBlocking();
  res.json({ success: true, data: { blockedCount: blocked } });
}));

// ---- Google Sheets Sync (Super Admin) --------------------------------
const { syncAllLeads: sheetSync, appendLead: sheetAppend, getSheets, checkConnectivity: sheetsCheck, listSharedSheets, resolveConfigStatus: sheetsResolveConfigStatus } = require('../services/googleSheetsService');

router.post('/sheets/sync', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const result = await sheetSync();
  res.json({ success: true, data: result });
}));

router.get('/sheets/status', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const result = await sheetsCheck();
  res.json({ success: true, data: result });
}));

router.get('/sheets/list', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const files = await listSharedSheets();
  res.json({ success: true, data: files });
}));

// ---- Integration Health (Super Admin) --------------------------------
router.get('/integrations/status', authenticate, requireRole('super_admin'), responseCache(15000), asyncHandler(async (_req, res) => {
  // Meta status
  const metaPages = await query(`SELECT page_id, page_name, is_active, page_access_token FROM meta_pages WHERE is_active = TRUE`);
  const metaVerifyToken = process.env.META_VERIFY_TOKEN || '';
  const metaPages_ = metaPages.rows.map(p => ({
    page_id: p.page_id,
    page_name: p.page_name,
    has_token: !!(p.page_access_token && p.page_access_token !== 'PENDING_TOKEN'),
  }));
  const metaConfigured = metaPages_.some(page => page.has_token);

  // Meta campaigns & ad accounts
  const { rows: metaCampaigns } = await query(`SELECT COUNT(*) AS cnt FROM meta_campaigns`);
  const { rows: metaAdAccounts } = await query(`SELECT COUNT(*) AS cnt FROM meta_ad_accounts WHERE is_active = TRUE`);

  // Google Sheets status
  const sheetsStatus = await sheetsCheck();

  // Lead counts
  const { rows: [counts] } = await query(`
    SELECT
      (SELECT COUNT(*) FROM leads WHERE source = 'meta' AND deleted_at IS NULL) AS meta_leads,
      (SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL) AS total_leads,
      (SELECT MAX(created_at) FROM leads WHERE source = 'meta' AND deleted_at IS NULL) AS last_meta_lead_at
  `);

  res.json({
    success: true,
    data: {
      meta: {
        configured: metaConfigured,
        verify_token_set: !!metaVerifyToken,
        pages: metaPages_,
        campaigns: parseInt(metaCampaigns[0]?.cnt || '0', 10),
        ad_accounts: parseInt(metaAdAccounts[0]?.cnt || '0', 10),
        total_meta_leads: parseInt(counts.meta_leads, 10),
        last_meta_lead_at: counts.last_meta_lead_at,
      },
      sheets: sheetsStatus,
      leads: {
        total: parseInt(counts.total_leads, 10),
      },
    },
  });
}));

// ---- Distribution Live Stats (for dashboards, cached 10s) -----------
// Distribution stats — admin + RM only. RM sees totals scoped to their team's
// members; admin sees global. Partners/members never need this view.
router.get('/distribution/stats', authenticate, requireRole('super_admin', 'rm'), responseCache(10000), asyncHandler(async (req, res) => {
  const { getVisibleUserIds } = require('../middleware/rbac');
  const visible = await getVisibleUserIds(req.user);

  // visible === null → admin → no scope. Otherwise restrict lead counts to
  // those assigned within the requester's visible-user set.
  let scopeSql = '';
  const params = [];
  if (visible !== null) {
    if (visible.length === 0) {
      return res.json({ success: true, data: { queued_leads: 0, total_pending: 0, today_distributed: 0, today_received: 0, blocked_members: 0, pending_approvals: 0, distribution_enabled: 'false' } });
    }
    params.push(visible);
    scopeSql = `AND assigned_to_user_id = ANY($1::uuid[])`;
  }

  const { rows: [stats] } = await query(`
    SELECT
      (SELECT COUNT(*) FROM leads WHERE assigned_to_user_id IS NULL AND deleted_at IS NULL ${visible === null ? '' : 'AND FALSE'}) AS queued_leads,
      (SELECT COUNT(*) FROM leads WHERE is_pending = TRUE AND deleted_at IS NULL ${scopeSql}) AS total_pending,
      (SELECT COUNT(*) FROM leads WHERE assigned_at::date = CURRENT_DATE AND deleted_at IS NULL ${scopeSql}) AS today_distributed,
      (SELECT COUNT(*) FROM leads WHERE (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date AND deleted_at IS NULL ${scopeSql}) AS today_received,
      (SELECT COUNT(*) FROM users WHERE distribution_blocked = TRUE AND deleted_at IS NULL ${visible === null ? '' : `AND (id = ANY($1::uuid[]))`}) AS blocked_members,
      (SELECT COUNT(*) FROM distribution_approvals WHERE status = 'pending') AS pending_approvals,
      (SELECT value FROM distribution_settings WHERE key = 'auto_distribution_enabled') AS distribution_enabled
  `, params);
  res.json({ success: true, data: stats });
}));

// ---- RM Teams: lead counts by user + category (Admin) ----------------
router.get('/reports/team-leads', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const { rows } = await query(`
    SELECT l.assigned_to_user_id AS user_id,
           l.category,
           COUNT(*) AS count
      FROM leads l
     WHERE l.assigned_to_user_id IS NOT NULL AND l.deleted_at IS NULL
     GROUP BY l.assigned_to_user_id, l.category
  `);
  res.json({ success: true, data: rows });
}));

// ---- Lead Request System -----------------------------------------------
const { assignLead: assignLeadFn } = require('../services/leadDistributionService');

// Member: submit a lead request — auto-assigns immediately from queue
router.post('/lead-requests', authenticate, asyncHandler(async (req, res) => {
  const { quantity, category, note } = req.body;
  const qty = Math.min(500, Math.max(1, parseInt(quantity || '1', 10)));
  // 'partner', 'trader', or null (both)
  const cat = ['partner', 'trader'].includes(category) ? category : null;

  if (!['member', 'partner'].includes(req.user.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Only members and partners can submit lead requests.');
  }
  await validateLeadAssignee({ query }, req.user.id, { actor: req.user });

  // Check for existing pending request
  const { rows: existing } = await query(
    `SELECT id FROM lead_requests WHERE user_id = $1 AND status = 'pending' LIMIT 1`,
    [req.user.id]
  );
  if (existing.length > 0) {
    throw new AppError(400, 'ALREADY_PENDING', 'You already have a pending lead request');
  }

  // Completion gating: partners and members must finish previously-assigned
  // leads before they can request more. "Pending" = lead with call_status in
  // (not_called, rnr, busy, switched_off) — i.e. no real outcome recorded.
  // Threshold is configurable via distribution_settings; default 2 unworked
  // leads block a new request.
  if (['partner', 'member'].includes(req.user.role)) {
    const { rows: [thr] } = await query(
      `SELECT value FROM distribution_settings WHERE key = 'partner_pending_block_threshold'`,
    ).catch(() => ({ rows: [{ value: '2' }] }));
    const threshold = Math.max(1, parseInt(thr?.value || '2', 10));
    const { rows: [pc] } = await query(
      `SELECT COUNT(*)::int AS pending
         FROM leads
        WHERE assigned_to_user_id = $1
          AND deleted_at IS NULL
          AND is_pending = TRUE`,
      [req.user.id],
    );
    if (pc.pending >= threshold) {
      throw new AppError(409, 'PENDING_WORK', `You have ${pc.pending} unworked lead(s). Finish (or update status on) those before requesting more.`);
    }
  }

  // Create the request
  const { rows: [r] } = await query(
    `INSERT INTO lead_requests (user_id, quantity, category, note)
       VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.user.id, qty, cat, note || null]
  );

  let assigned = 0;
  logger.info({ requestId: r.id, requested_qty: qty }, '[lead-request] created pending admin approval');

  // Audit log
  await query(
    `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata, ip_address)
       VALUES ($1, 'lead_request', $2, 'submit', $3, $4)`,
    [req.user.id, r.id, JSON.stringify({ quantity: qty, category: cat, assigned }), req.ip]
  );

  const { rows: [requester] } = await query(
    `SELECT id, full_name, role, report_to_id FROM users WHERE id = $1`,
    [req.user.id],
  );
  await notifications.notifyLeadRequestCreated({
    requestId: r.id,
    requesterId: req.user.id,
    requesterName: requester?.full_name || req.user.full_name || req.user.name,
    requesterRole: requester?.role || req.user.role,
    rmId: requester?.report_to_id || null,
    quantity: qty,
    category: cat,
    assigned,
  });

  // Real-time notify admin + the RM who owns this requester + the requester
  emitLeadRequest(r.status === 'fulfilled' ? 'fulfilled' : 'created', r.id);

  res.status(201).json({ success: true, data: r });
}));

// Member: get own request status
router.get('/lead-requests/my', authenticate, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT lr.*, u.full_name AS resolved_by_name
       FROM lead_requests lr
       LEFT JOIN users u ON u.id = lr.resolved_by
      WHERE lr.user_id = $1
      ORDER BY lr.created_at DESC LIMIT 10`,
    [req.user.id]
  );
  res.json({ success: true, data: rows });
}));

// RM/Admin: list pending requests (scoped by role)
router.get('/lead-requests', authenticate, requireRole('super_admin', 'admin', 'rm'), asyncHandler(async (req, res) => {
  const status = req.query.status || 'pending';
  let scopeSql = '';
  const params = [status];

  if (req.user.role === 'rm') {
    params.push(req.user.id);
    scopeSql = ` AND lr.user_id IN (SELECT id FROM users WHERE report_to_id = $${params.length})`;
  }

  const { rows } = await query(`
    SELECT lr.*, u.full_name, u.email, u.team_name, u.member_type,
           r.full_name AS resolved_by_name
      FROM lead_requests lr
      JOIN users u ON u.id = lr.user_id
      LEFT JOIN users r ON r.id = lr.resolved_by
     WHERE lr.status = $1 ${scopeSql}
     ORDER BY lr.created_at DESC
     LIMIT 100
  `, params);
  res.json({ success: true, data: rows });
}));

// RM/Admin: approve a request — assigns leads from queue
router.post('/lead-requests/:id/approve', authenticate, requireRole('super_admin', 'admin'), asyncHandler(async (req, res) => {
  if (true) {
    const result = await assignmentEngine.approveLeadRequest({
      requestId: req.params.id,
      approvedQuantity: req.body.approvedQuantity || req.body.approved_quantity,
      adminNotes: req.body.adminNotes || req.body.admin_notes || req.body.note || null,
      actor: req.user,
    });

    const thisRequest = result.fulfillment?.requests?.find(r => r.requestId === req.params.id);
    const assignedNow = thisRequest?.assigned || 0;
    const fulfilled = Number(result.request.fulfilled_quantity ?? result.request.leads_assigned ?? 0);
    const approved = Number(result.request.approved_quantity ?? result.request.quantity ?? 0);
    const requested = Number(result.request.requested_quantity ?? result.request.quantity ?? approved);
    const status = result.request.status;

    emitLeadRequest(
      status === 'fulfilled'
        ? 'approved'
        : status === 'partially_fulfilled'
          ? 'partially_approved'
          : 'approved',
      req.params.id,
    );

    const { logActivity } = require('../utils/auditLog');
    await logActivity(req, {
      entity: 'lead_request',
      entity_id: req.params.id,
      action: status === 'fulfilled' ? 'fulfilled' : status,
      old_value: 'pending',
      new_value: status,
      metadata: {
        requester_id: result.request.user_id,
        requested,
        approved_quantity: approved,
        fulfilled_quantity: fulfilled,
        assigned_now: assignedNow,
        remaining: result.remaining,
        note: req.body.note || null,
      },
    });

    return res.json({
      success: true,
      data: {
        approved: true,
        leads_assigned: fulfilled,
        fulfilled_quantity: fulfilled,
        requested,
        approved_quantity: approved,
        assigned_now: assignedNow,
        remaining: Math.max(0, approved - fulfilled),
        requestId: result.requestId,
        memberId: result.memberId,
        approvedQuantity: result.approvedQuantity,
        assignedNow: result.assignedNow,
        remainingQuota: result.remaining,
        status,
        partial: status === 'approved' || status === 'partially_fulfilled',
      },
    });
  }
  const { id } = req.params;
  const { rows: [request] } = await query(
    `SELECT lr.*, u.full_name, u.role AS user_role, u.status AS user_status,
            u.report_to_id AS user_report_to_id, u.deleted_at AS user_deleted_at,
            COALESCE(u.is_available, TRUE) AS user_is_available
       FROM lead_requests lr JOIN users u ON u.id = lr.user_id
      WHERE lr.id = $1 AND lr.status = 'pending'`, [id]
  );
  if (!request) throw new AppError(404, 'NOT_FOUND', 'Request not found or already resolved');
  await validateLeadAssignee({ query }, request.user_id, { actor: req.user });

  // RM can only approve their own team members
  if (req.user.role === 'rm') {
    const { rows: [member] } = await query(
      `SELECT id FROM users WHERE id = $1 AND report_to_id = $2`, [request.user_id, req.user.id]
    );
    if (!member) throw new AppError(403, 'FORBIDDEN', 'You can only approve requests from your team');
  }

  // Find available leads — prefer RM pool first, then global queue
  const rmId = req.user.role === 'rm' ? req.user.id : null;
  let leadSql;
  const leadParams = [];

  if (rmId) {
    // RM approving: pull from RM's own pool first
    leadSql = `SELECT id FROM leads WHERE pool_rm_id = $1 AND assigned_to_user_id IS NULL AND deleted_at IS NULL`;
    leadParams.push(rmId);
  } else {
    // Super admin approving: pull from global queue
    leadSql = `SELECT id FROM leads WHERE assigned_to_user_id IS NULL AND deleted_at IS NULL`;
  }
  if (request.category) {
    leadParams.push(request.category);
    leadSql += ` AND category = $${leadParams.length}`;
  }
  // PRIORITY: today's IST leads first (FIFO within today), then older
  // (FIFO). Canonical ordering shared with POST /lead-requests and
  // fulfillMemberRequest — keep these three in sync.
  leadSql += `
    ORDER BY
      CASE WHEN (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date
              = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
           THEN 0 ELSE 1 END,
      COALESCE(meta_created_time, created_at) ASC
    LIMIT ${request.quantity}`;

  const { rows: availableLeads } = await query(leadSql, leadParams);

  let assigned = 0;
  const assignedLeadIds = [];
  for (const lead of availableLeads) {
    try {
      const updated = await query(
        `UPDATE leads SET assigned_to_user_id = $1, assigned_at = NOW(), updated_at = NOW()
          WHERE id = $2 AND assigned_to_user_id IS NULL`,
        [request.user_id, lead.id]
      );
      if (!updated.rowCount) continue;
      await query(
        `INSERT INTO lead_assignments(lead_id, user_id, assigned_by, reason)
           VALUES ($1, $2, $3, 'lead_request')`,
        [lead.id, request.user_id, req.user.id]
      );
      assigned++;
      assignedLeadIds.push(lead.id);
    } catch { /* skip on race condition */ }
  }

  // Status rules — never mark "fulfilled" with assigned < quantity.
  //   assigned >= quantity → fully fulfilled
  //   0 < assigned < quantity OR assigned === 0 → stay 'pending' but record
  //     that admin pre-approved (resolved_by). The scheduler's
  //     processAllMemberRequests + onLeadCreated hook will top this up as
  //     new leads arrive. No more "Approved with Delivered=0" anomaly.
  const fullyDone = assigned >= request.quantity;
  const finalStatus = fullyDone ? 'fulfilled' : 'pending';
  const resolvedAt = fullyDone ? new Date() : null;

  await query(
    `UPDATE lead_requests SET status = $1, resolved_by = $2, resolved_at = $3,
            resolve_note = $4, leads_assigned = $5, updated_at = NOW()
      WHERE id = $6`,
    [finalStatus, req.user.id, resolvedAt, req.body.note || null, assigned, id]
  );

  await notifications.notifyLeadRequestResolved({
    requestId: id,
    requesterId: request.user_id,
    quantity: request.quantity,
    assigned,
    status: finalStatus,
    note: req.body.note || null,
  });
  if (assigned > 0) {
    await notifications.notifyLeadAssigned(request.user_id, assigned, {
      request_id: id,
      assignment_type: 'lead_request_approval',
      lead_ids: assignedLeadIds,
      assigned_by: req.user.id,
    });
  }

  emitLeadRequest(fullyDone ? 'approved' : 'partially_approved', id);

  // Audit trail
  const { logActivity } = require('../utils/auditLog');
  await logActivity(req, {
    entity: 'lead_request', entity_id: id,
    action: fullyDone ? 'approved' : 'partially_approved',
    old_value: 'pending', new_value: finalStatus,
    metadata: { requester: request.full_name, requester_id: request.user_id, requested: request.quantity, delivered: assigned, note: req.body.note || null },
  });

  res.json({
    success: true,
    data: {
      approved: true,
      leads_assigned: assigned,
      requested: request.quantity,
      status: finalStatus,
      partial: !fullyDone,
    },
  });
}));

// RM/Admin: reject a request
router.post('/lead-requests/:id/reject', authenticate, requireRole('super_admin', 'admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { rows: [r] } = await query(
    `UPDATE lead_requests SET status = 'rejected', resolved_by = $1, resolved_at = NOW(),
            resolve_note = $2, updated_at = NOW()
      WHERE id = $3 AND status = 'pending' RETURNING id`,
    [req.user.id, req.body.note || null, id]
  );
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Request not found or already resolved');
  const { rows: [requester] } = await query(`SELECT user_id, quantity FROM lead_requests WHERE id = $1`, [id]);
  if (requester) {
    await notifications.notifyLeadRequestResolved({
      requestId: id,
      requesterId: requester.user_id,
      quantity: requester.quantity,
      assigned: 0,
      status: 'rejected',
      note: req.body.note || null,
    });
  }
  emitLeadRequest('rejected', r.id);
  {
    const { logActivity } = require('../utils/auditLog');
    await logActivity(req, {
      entity: 'lead_request', entity_id: id, action: 'rejected',
      old_value: 'pending', new_value: 'rejected',
      metadata: { note: req.body.note || null },
    });
  }
  res.json({ success: true, data: { requestId: id, status: 'rejected' } });
}));

// Member: cancel own pending request
router.delete('/lead-requests/:id', authenticate, asyncHandler(async (req, res) => {
  const { rows: [r] } = await query(
    `DELETE FROM lead_requests WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id`,
    [req.params.id, req.user.id]
  );
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Request not found or cannot be cancelled');
  res.json({ success: true });
}));

// RM: team request activity — all recent requests from team members (monitoring view)
router.get('/lead-requests/team-activity', authenticate, requireRole('rm', 'super_admin'), asyncHandler(async (req, res) => {
  let scopeSql = '';
  const params = [];

  if (req.user.role === 'rm') {
    params.push(req.user.id);
    scopeSql = ` AND lr.user_id IN (SELECT id FROM users WHERE report_to_id = $${params.length} AND deleted_at IS NULL)`;
  }

  const { rows } = await query(`
    SELECT lr.*, u.full_name, u.email, u.team_name, u.member_type
      FROM lead_requests lr
      JOIN users u ON u.id = lr.user_id
     WHERE 1=1 ${scopeSql}
     ORDER BY lr.created_at DESC
     LIMIT 50
  `, params);
  res.json({ success: true, data: rows });
}));

// Lead request stats (for all dashboards)
router.get('/lead-requests/stats', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const role = req.user.role;

  // "Available leads in queue" — admin sees the global unassigned pool;
  // RM sees only leads sitting in their own pool; everyone else (partner /
  // member) does not need a global view and gets 0 so the dashboard tile
  // doesn't expose CRM-wide counts.
  let q = { available_leads: '0' };
  if (role === 'super_admin') {
    ({ rows: [q] } = await query(`SELECT COUNT(*) AS available_leads FROM leads WHERE assigned_to_user_id IS NULL AND deleted_at IS NULL`));
  } else if (role === 'rm') {
    // RM only sees leads explicitly placed in their pool. The global
    // unassigned pool stays admin-only — RMs request from it rather than
    // being shown its size.
    ({ rows: [q] } = await query(
      `SELECT COUNT(*) AS available_leads FROM leads
        WHERE assigned_to_user_id IS NULL AND deleted_at IS NULL
          AND pool_rm_id = $1`,
      [userId]
    ));
  }

  // My assigned leads count
  const { rows: [my] } = await query(`
    SELECT COUNT(*) AS my_leads,
           COUNT(*) FILTER (WHERE is_pending = TRUE) AS my_pending
      FROM leads WHERE assigned_to_user_id = $1 AND deleted_at IS NULL
  `, [userId]);

  // My pending request
  const { rows: myReqs } = await query(
    `SELECT id, quantity, category, status, created_at FROM lead_requests
      WHERE user_id = $1 AND status = 'pending' LIMIT 1`, [userId]
  );

  // Pending requests count (for RM/admin)
  let pendingRequests = 0;
  if (role === 'super_admin') {
    const { rows: [c] } = await query(`SELECT COUNT(*) AS cnt FROM lead_requests WHERE status = 'pending'`);
    pendingRequests = parseInt(c.cnt, 10);
  } else if (role === 'rm') {
    const { rows: [c] } = await query(
      `SELECT COUNT(*) AS cnt FROM lead_requests lr
         JOIN users u ON u.id = lr.user_id AND u.report_to_id = $1
        WHERE lr.status = 'pending'`, [userId]
    );
    pendingRequests = parseInt(c.cnt, 10);
  }

  // Distribution status
  const distEnabled = await getSetting('auto_distribution_enabled', 'false');

  // RM pool stats (for RMs)
  let rmPoolCount = 0;
  let rmPendingRmRequests = 0;
  if (role === 'rm') {
    const { rows: [pool] } = await query(
      `SELECT COUNT(*) AS cnt FROM leads WHERE pool_rm_id = $1 AND assigned_to_user_id IS NULL AND deleted_at IS NULL`,
      [userId]
    );
    rmPoolCount = parseInt(pool.cnt, 10);
    const { rows: [rmReqs] } = await query(
      `SELECT COUNT(*) AS cnt FROM rm_lead_requests WHERE rm_id = $1 AND status IN ('pending', 'partial')`,
      [userId]
    );
    rmPendingRmRequests = parseInt(rmReqs.cnt, 10);
  }

  res.json({
    success: true,
    data: {
      available_leads: parseInt(q.available_leads, 10),
      my_leads: parseInt(my.my_leads, 10),
      my_pending: parseInt(my.my_pending, 10),
      my_pending_request: myReqs[0] || null,
      pending_requests: pendingRequests,
      distribution_enabled: distEnabled === 'true',
      rm_pool_count: rmPoolCount,
      rm_pending_requests: rmPendingRmRequests,
    },
  });
}));

// ---- RM Lead Requests & Pool Management --------------------------------
const reqEngine = require('../services/requestDistributionEngine');

// RM: submit a lead request (request leads from global queue into RM pool)
router.post('/rm-lead-requests', authenticate, requireRole('rm', 'super_admin'), asyncHandler(async (req, res) => {
  const { quantity, category, note } = req.body;
  const qty = Math.min(500, Math.max(1, parseInt(quantity || '1', 10)));
  const cat = ['partner', 'trader'].includes(category) ? category : null;

  const { rows: [r] } = await query(
    `INSERT INTO rm_lead_requests (rm_id, quantity, category, note)
       VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.user.id, qty, cat, note || null]
  );

  // Try to fulfill immediately if distribution is active
  const { isDistributionActive: isActive } = require('../services/distributionScheduler');
  if (await isActive()) {
    try {
      await reqEngine.fulfillRmRequest(r.id);
    } catch (err) {
      // Will retry on next scheduler tick
    }
  }

  // Re-fetch to get updated status
  const { rows: [updated] } = await query(`SELECT * FROM rm_lead_requests WHERE id = $1`, [r.id]);
  await notifications.notifyAdmins(
    'rm_lead_request',
    'New RM lead request',
    `${req.user.full_name || req.user.name || 'RM'} requested ${qty} lead(s)${updated?.fulfilled_count ? `; ${updated.fulfilled_count} moved to RM pool` : ''}.`,
    { request_id: r.id, rm_id: req.user.id, quantity: qty, category: cat, fulfilled_count: updated?.fulfilled_count || 0 },
  );
  await notifications.notifyUser(
    req.user.id,
    'rm_lead_request_submitted',
    'RM lead request submitted',
    updated?.fulfilled_count
      ? `Your request for ${qty} lead(s) was submitted. ${updated.fulfilled_count} lead(s) moved to your RM pool.`
      : `Your request for ${qty} lead(s) was submitted.`,
    { request_id: r.id, quantity: qty, category: cat, fulfilled_count: updated?.fulfilled_count || 0 },
  );
  res.status(201).json({ success: true, data: updated });
}));

// RM: get own requests
router.get('/rm-lead-requests/my', authenticate, requireRole('rm', 'super_admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM rm_lead_requests WHERE rm_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [req.user.id]
  );
  res.json({ success: true, data: rows });
}));

// RM: cancel own pending request
router.delete('/rm-lead-requests/:id', authenticate, requireRole('rm', 'super_admin'), asyncHandler(async (req, res) => {
  const { rows: [r] } = await query(
    `UPDATE rm_lead_requests SET status = 'cancelled' WHERE id = $1 AND rm_id = $2 AND status IN ('pending', 'partial') RETURNING id`,
    [req.params.id, req.user.id]
  );
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Request not found or cannot be cancelled');
  res.json({ success: true });
}));

// Admin: list all RM requests
router.get('/rm-lead-requests', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const status = req.query.status;
  let sql = `SELECT r.*, u.full_name AS rm_name, u.team_name
               FROM rm_lead_requests r
               JOIN users u ON u.id = r.rm_id`;
  const params = [];
  if (status) {
    params.push(status);
    sql += ` WHERE r.status = $1`;
  }
  sql += ` ORDER BY r.created_at DESC LIMIT 100`;
  const { rows } = await query(sql, params);
  res.json({ success: true, data: rows });
}));

// RM Pool: get pool stats for requesting RM
router.get('/rm-pool/stats', authenticate, requireRole('rm', 'super_admin'), asyncHandler(async (req, res) => {
  const rmId = req.query.rm_id || req.user.id;
  // super_admin can query any RM, RMs only their own
  if (req.user.role === 'rm' && rmId !== req.user.id) {
    throw new AppError(403, 'FORBIDDEN', 'You can only view your own pool');
  }
  const stats = await reqEngine.getRmPoolStats(rmId);
  res.json({ success: true, data: stats });
}));

// RM Pool: list leads in RM's pool (unassigned to members)
router.get('/rm-pool/leads', authenticate, requireRole('rm', 'super_admin'), asyncHandler(async (req, res) => {
  const rmId = req.query.rm_id || req.user.id;
  if (req.user.role === 'rm' && rmId !== req.user.id) {
    throw new AppError(403, 'FORBIDDEN', 'You can only view your own pool');
  }
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(10, parseInt(req.query.limit || '50', 10)));
  const offset = (page - 1) * limit;

  const { rows } = await query(
    `SELECT id, full_name, phone, email, category, source, campaign_label, stage, created_at, pool_assigned_at
       FROM leads
      WHERE pool_rm_id = $1 AND assigned_to_user_id IS NULL AND deleted_at IS NULL
      ORDER BY created_at ASC
      LIMIT $2 OFFSET $3`,
    [rmId, limit, offset]
  );
  const { rows: [cnt] } = await query(
    `SELECT COUNT(*) AS total FROM leads WHERE pool_rm_id = $1 AND assigned_to_user_id IS NULL AND deleted_at IS NULL`,
    [rmId]
  );
  res.json({ success: true, data: { rows, total: parseInt(cnt.total, 10), page } });
}));

// RM: manually assign lead from pool to a specific member
router.post('/rm-pool/assign', authenticate, requireRole('rm', 'super_admin'), asyncHandler(async (req, res) => {
  const { lead_id, member_id } = req.body;
  if (!lead_id || !member_id) throw new AppError(400, 'INVALID', 'lead_id and member_id required');

  const rmId = req.user.id;

  // Verify the lead is in this RM's pool
  const { rows: [lead] } = await query(
    `SELECT id FROM leads WHERE id = $1 AND pool_rm_id = $2 AND assigned_to_user_id IS NULL AND deleted_at IS NULL`,
    [lead_id, rmId]
  );
  if (!lead) throw new AppError(404, 'NOT_FOUND', 'Lead not in your pool or already assigned');

  await validateLeadAssignee({ query }, member_id, { actor: req.user });

  await query(
    `UPDATE leads SET assigned_to_user_id = $1, assigned_at = NOW(), updated_at = NOW() WHERE id = $2`,
    [member_id, lead_id]
  );
  await query(
    `INSERT INTO lead_assignments(lead_id, user_id, assigned_by, reason) VALUES ($1, $2, $3, 'rm_manual')`,
    [lead_id, member_id, rmId]
  );
  await notifications.notifyLeadAssigned(member_id, 1, {
    lead_id,
    assigned_by: rmId,
    assignment_type: 'rm_manual',
  });

  res.json({ success: true, data: { lead_id, member_id, assigned: true } });
}));

// Global queue stats (admin)
router.get('/distribution/queue-stats', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const stats = await reqEngine.getGlobalQueueStats();
  res.json({ success: true, data: stats });
}));

// Admin: manually trigger distribution cycle
router.post('/distribution/run-cycle', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const result = await reqEngine.runDistributionCycle();
  res.json({ success: true, data: result });
}));

// ====================================================================
// ---- ADMIN TOOLS (Super Admin Only) ---------------------------------
// ====================================================================
const bcrypt = require('bcryptjs');

// --- 1. Activity Logs (audit_logs viewer) ---
router.get('/admin/activity-logs', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(10, parseInt(req.query.page_size || '25', 10)));
  const offset = (page - 1) * pageSize;

  // Filters get applied to a UNION view that covers BOTH the legacy
  // audit_logs table (562+ historical rows) AND the canonical
  // activity_logs table (where every new event is recorded going
  // forward via utils/auditLog.js). Activity logs is the richer table;
  // audit_logs entries are normalised so columns match.
  let where = 'WHERE 1=1';
  const params = [];
  if (req.query.user_id) { params.push(req.query.user_id); where += ` AND a.user_id = $${params.length}`; }
  if (req.query.entity)  { params.push(req.query.entity);  where += ` AND a.entity = $${params.length}`; }
  if (req.query.action)  { params.push(req.query.action);  where += ` AND a.action = $${params.length}`; }
  if (req.query.from)    { params.push(req.query.from);    where += ` AND a.created_at >= $${params.length}`; }
  if (req.query.to)      { params.push(req.query.to);      where += ` AND a.created_at <= $${params.length}`; }

  const unionView = `
    (
      SELECT al.id::text AS id, al.user_id, al.user_name, al.user_role,
             al.entity, al.entity_id, al.action, al.metadata, al.ip_address::text AS ip_address,
             al.old_value, al.new_value, al.user_agent, al.session_id::text AS session_id,
             al.created_at
        FROM activity_logs al
      UNION ALL
      SELECT 'a' || aud.id::text AS id, aud.user_id,
             u.full_name AS user_name, u.role::text AS user_role,
             aud.entity, aud.entity_id::text AS entity_id, aud.action,
             aud.metadata, aud.ip_address::text AS ip_address,
             NULL::text AS old_value, NULL::text AS new_value,
             NULL::text AS user_agent, NULL::text AS session_id,
             aud.created_at
        FROM audit_logs aud
        LEFT JOIN users u ON u.id = aud.user_id
    )
  `;

  const countParams = [...params];
  const { rows: [{ total }] } = await query(
    `SELECT COUNT(*) AS total FROM ${unionView} a ${where}`, countParams
  );

  params.push(pageSize, offset);
  const { rows } = await query(`
    SELECT a.id, a.user_id, a.user_name, a.user_role,
           a.entity, a.entity_id, a.action, a.metadata, a.ip_address,
           a.old_value, a.new_value, a.user_agent, a.session_id,
           a.created_at,
           -- Session enrichment: when a row carries a session_id, expose
           -- login_at / logout_at / last_activity_at / duration_secs so the
           -- Activity Logs UI can show the full session lifecycle in one row.
           s.created_at        AS login_at,
           s.revoked_at        AS logout_at,
           s.last_activity_at  AS last_activity_at,
           s.last_activity_ip  AS last_activity_ip,
           CASE
             WHEN s.id IS NULL THEN NULL
             WHEN s.revoked_at IS NOT NULL
               THEN EXTRACT(EPOCH FROM (s.revoked_at - s.created_at))::int
             ELSE EXTRACT(EPOCH FROM (NOW() - s.created_at))::int
           END AS session_duration_secs
      FROM ${unionView} a
      LEFT JOIN auth_sessions s ON a.session_id IS NOT NULL AND s.id::text = a.session_id
      ${where}
     ORDER BY a.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  res.json({ success: true, data: { rows, total: parseInt(total, 10), page, pageSize } });
}));

// --- 2. Export Leads as CSV ---
router.get('/admin/export/leads', authenticate, requireRole('super_admin', 'admin'), asyncHandler(async (req, res) => {
  let where = 'WHERE l.deleted_at IS NULL';
  const params = [];
  if (req.query.category) { params.push(req.query.category); where += ` AND l.category = $${params.length}`; }
  if (req.query.stage)    { params.push(req.query.stage);    where += ` AND l.stage = $${params.length}`; }
  if (req.query.call_status) { params.push(req.query.call_status); where += ` AND l.call_status = $${params.length}`; }
  if (req.query.from) { params.push(req.query.from); where += ` AND l.created_at >= $${params.length}`; }
  if (req.query.to)   { params.push(req.query.to);   where += ` AND l.created_at <= $${params.length}`; }
  if (req.query.assigned_to) {
    if (req.query.assigned_to === '__unassigned') {
      where += ` AND l.assigned_to_user_id IS NULL`;
    } else {
      params.push(req.query.assigned_to);
      where += ` AND l.assigned_to_user_id = $${params.length}`;
    }
  }
  if (req.query.campaign_id) {
    params.push(req.query.campaign_id);
    where += ` AND l.meta_campaign_id = $${params.length}`;
  }
  if (req.query.campaign) {
    params.push(`%${String(req.query.campaign).trim()}%`);
    where += ` AND (l.campaign_name ILIKE $${params.length} OR l.campaign_label ILIKE $${params.length} OR l.meta_campaign_id ILIKE $${params.length})`;
  }

  const { rows } = await query(`
    SELECT l.id, l.full_name, l.phone, l.email, l.city, l.state,
           l.source, l.category, l.stage, l.call_status,
           l.campaign_label, l.product_tag,
           l.campaign_name, l.adset_name, l.ad_name,
           u.full_name AS assigned_to,
           l.assigned_at, l.next_followup_at, l.call_attempts,
           l.created_at, l.updated_at
      FROM leads l
      LEFT JOIN users u ON u.id = l.assigned_to_user_id
      ${where}
     ORDER BY l.created_at DESC
  `, params);

  // Build CSV
  const headers = ['ID','Name','Phone','Email','City','State','Source','Category','Category Label','Stage','Call Status','Campaign Label','Product','Campaign Name','Ad Set','Ad Name','Assigned To','Assigned At','Next Followup','Call Attempts','Created','Updated'];
  const csvRows = [headers.join(',')];
  for (const r of rows) {
    csvRows.push([
      r.id, esc(r.full_name), esc(r.phone), esc(r.email), esc(r.city), esc(r.state),
      r.source, r.category, r.category === 'trader' ? 'Trader Lead' : r.category === 'partner' ? 'Partner Lead' : 'Unknown', r.stage, r.call_status,
      esc(r.campaign_label), esc(r.product_tag),
      esc(r.campaign_name), esc(r.adset_name), esc(r.ad_name),
      esc(r.assigned_to),
      r.assigned_at || '', r.next_followup_at || '', r.call_attempts,
      r.created_at, r.updated_at
    ].join(','));
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=leads_export_${new Date().toISOString().slice(0,10)}.csv`);
  res.send(csvRows.join('\n'));

  // Audit the download — record what filters were applied + how many rows
  // left the system. Don't block response on this.
  try {
    const { logActivity } = require('../utils/auditLog');
    await logActivity(req, {
      entity: 'export', action: 'leads_csv_downloaded',
      new_value: `${rows.length} rows`,
      metadata: { filters: req.query, row_count: rows.length },
    });
  } catch { /* non-fatal */ }
}));

function esc(v) {
  if (v == null) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

// --- 3. Export Reports as CSV ---
router.get('/admin/export/reports', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT u.id, u.full_name, u.email, u.role, u.team_name, u.member_type,
           COUNT(l.id) AS total_leads,
           COUNT(l.id) FILTER (WHERE l.is_pending) AS pending,
           COUNT(l.id) FILTER (WHERE l.call_status = 'converted') AS conversions,
           COUNT(l.id) FILTER (WHERE l.call_status IN ('ni', 'not_interested')) AS not_interested,
           COUNT(l.id) FILTER (WHERE l.call_status = 'cnr') AS cnr,
           ROUND(
             COUNT(l.id) FILTER (WHERE l.call_status = 'converted')::numeric /
             NULLIF(COUNT(l.id), 0) * 100, 2
           ) AS conv_rate
      FROM users u
      LEFT JOIN leads l ON l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
     WHERE u.deleted_at IS NULL AND u.role = 'member'
     GROUP BY u.id, u.full_name, u.email, u.role, u.team_name, u.member_type
     ORDER BY u.role, u.full_name
  `);

  const headers = ['ID','Name','Email','Role','Team','Member Type','Total Leads','Pending','Conversions','Not Interested','CNR','Conv Rate %'];
  const csvRows = [headers.join(',')];
  for (const r of rows) {
    csvRows.push([r.id, esc(r.full_name), esc(r.email), r.role, esc(r.team_name), r.member_type || '', r.total_leads, r.pending, r.conversions, r.not_interested, r.cnr, r.conv_rate || '0.00'].join(','));
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=team_report_${new Date().toISOString().slice(0,10)}.csv`);
  res.send(csvRows.join('\n'));
}));

// --- 4. Reset Password (Admin resets for any user) ---
router.post('/admin/reset-password/:userId', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    throw new AppError(400, 'INVALID', 'Password must be at least 6 characters');
  }

  const { rows: [user] } = await query(`SELECT id, full_name FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId]);
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');

  const hash = await bcrypt.hash(new_password, 12);
  await query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [hash, userId]);

  // Revoke all sessions for this user
  await query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);

  // Log the reset
  await query(
    `INSERT INTO password_resets (user_id, reset_by, ip_address) VALUES ($1, $2, $3)`,
    [userId, req.user.id, req.ip]
  );
  await query(
    `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata, ip_address) VALUES ($1, 'user', $2, 'password_reset', $3, $4)`,
    [req.user.id, userId, JSON.stringify({ target_user: user.full_name }), req.ip]
  );

  res.json({ success: true, data: { message: `Password reset for ${user.full_name}` } });
}));

// --- 5. Force Assign Leads ---
router.post('/admin/force-assign', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { lead_ids, user_id, reason } = req.body;
  if (!lead_ids || !Array.isArray(lead_ids) || lead_ids.length === 0) {
    throw new AppError(400, 'INVALID', 'lead_ids array required');
  }
  if (!user_id) throw new AppError(400, 'INVALID', 'user_id required');

  const target = await validateLeadAssignee({ query }, user_id, { actor: req.user });
  const result = await assignmentEngine.assignLeadsBulk({
    leadIds: lead_ids,
    memberId: user_id,
    assignedBy: req.user.id,
    actor: req.user,
    assignmentType: 'manual_reassign',
    reason: reason || 'admin_force_assign',
  });
  const assigned = result.assigned_count ?? result.assigned ?? 0;

  await query(
    `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata, ip_address)
       VALUES ($1, 'lead', $2, 'force_assign', $3, $4)`,
    [req.user.id, lead_ids[0], JSON.stringify({ count: assigned, target: target.full_name, reason }), req.ip]
  );

  res.json({ success: true, data: { assigned, target: target.full_name } });
}));

// --- 6. Broadcast Message ---
router.post('/admin/broadcast', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { title, body: msgBody, priority, target_role, target_user_ids } = req.body;
  if (!title || !msgBody) throw new AppError(400, 'INVALID', 'title and body are required');

  const { rows: [msg] } = await query(
    `INSERT INTO broadcast_messages (sender_id, title, body, priority, target_role, target_user_ids)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.user.id, title, msgBody, priority || 'normal', target_role || 'all', target_user_ids || null]
  );

  await query(
    `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata, ip_address)
       VALUES ($1, 'broadcast', $2, 'send', $3, $4)`,
    [req.user.id, msg.id, JSON.stringify({ title, target_role, priority }), req.ip]
  );

  res.status(201).json({ success: true, data: msg });
}));

router.get('/admin/broadcast', authenticate, asyncHandler(async (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit || '20', 10));
  let where = '1=1';
  const params = [];

  // Non-admin users only see messages targeted to them
  if (req.user.role !== 'super_admin') {
    where = `(bm.target_role = 'all' OR bm.target_role = $1 OR $2 = ANY(bm.target_user_ids))
             AND (bm.expires_at IS NULL OR bm.expires_at > NOW())`;
    params.push(req.user.role, req.user.id);
  }

  params.push(limit);
  const { rows } = await query(`
    SELECT bm.*, u.full_name AS sender_name
      FROM broadcast_messages bm
      JOIN users u ON u.id = bm.sender_id
     WHERE ${where}
     ORDER BY bm.created_at DESC
     LIMIT $${params.length}
  `, params);

  res.json({ success: true, data: rows });
}));

// --- 7. Block / Unblock User (status toggle) ---
router.post('/admin/block-user/:userId', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { reason } = req.body;

  const { rows: [user] } = await query(
    `UPDATE users SET status = 'blocked', is_available = FALSE, updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL AND status != 'blocked' RETURNING id, full_name`,
    [userId]
  );
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found or already blocked');

  await query(
    `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata, ip_address)
       VALUES ($1, 'user', $2, 'block', $3, $4)`,
    [req.user.id, userId, JSON.stringify({ target: user.full_name, reason }), req.ip]
  );

  invalidateUser(userId);
  res.json({ success: true, data: { blocked: user.full_name } });
}));

router.post('/admin/unblock-user/:userId', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const { rows: [user] } = await query(
    `UPDATE users SET status = 'active', is_available = TRUE, updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL AND status = 'blocked' RETURNING id, full_name`,
    [userId]
  );
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found or not blocked');

  await query(
    `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata, ip_address)
       VALUES ($1, 'user', $2, 'unblock', $3, $4)`,
    [req.user.id, userId, JSON.stringify({ target: user.full_name }), req.ip]
  );

  invalidateUser(userId);
  res.json({ success: true, data: { unblocked: user.full_name } });
}));

// --- 8. Notifications ---
router.get('/admin/notifications', authenticate, requireRole('super_admin', 'admin'), asyncHandler(async (req, res) => {
  const unreadOnly = req.query.unread === 'true';
  const limit = Math.min(50, parseInt(req.query.limit || '20', 10));
  const where = unreadOnly ? 'WHERE is_read = FALSE' : '';

  const { rows } = await query(
    `SELECT * FROM admin_notifications ${where} ORDER BY created_at DESC LIMIT $1`, [limit]
  );
  const { rows: [{ count: unread_count }] } = await query(
    `SELECT COUNT(*) FROM admin_notifications WHERE is_read = FALSE`
  );
  res.json({ success: true, data: { rows, unread_count: parseInt(unread_count, 10) } });
}));

router.post('/admin/notifications/:id/read', authenticate, requireRole('super_admin', 'admin'), asyncHandler(async (req, res) => {
  await query(`UPDATE admin_notifications SET is_read = TRUE WHERE id = $1`, [req.params.id]);
  res.json({ success: true });
}));

router.post('/admin/notifications/read-all', authenticate, requireRole('super_admin', 'admin'), asyncHandler(async (_req, res) => {
  await query(`UPDATE admin_notifications SET is_read = TRUE WHERE is_read = FALSE`);
  res.json({ success: true });
}));

// --- 9. Team Hierarchy Controls (reassign member to different RM) ---
router.post('/admin/reassign-member', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { member_id, new_rm_id } = req.body;
  if (!member_id) throw new AppError(400, 'INVALID', 'member_id required');
  if (!new_rm_id) throw new AppError(400, 'RM_REQUIRED', 'Member must report to an active RM');

  const { rows: [rm] } = await query(
    `SELECT id, team_name FROM users
      WHERE id = $1 AND role = 'rm' AND deleted_at IS NULL AND COALESCE(status, 'active') = 'active'`,
    [new_rm_id],
  );
  if (!rm) throw new AppError(404, 'NOT_FOUND', 'Target RM not found');

  const { rows: [user] } = await query(
    `UPDATE users
        SET report_to_id = $1, team_name = $2, updated_at = NOW()
      WHERE id = $3 AND role = 'member' AND deleted_at IS NULL
      RETURNING id, full_name`,
    [new_rm_id, rm.team_name || null, member_id],
  );
  if (!user) throw new AppError(404, 'NOT_FOUND', 'Member not found');

  await query(
    `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata, ip_address)
       VALUES ($1, 'user', $2, 'reassign_team', $3, $4)`,
    [req.user.id, member_id, JSON.stringify({ new_rm_id, team_name: rm.team_name || null }), req.ip]
  );

  res.json({ success: true, data: { member: user.full_name } });
}));

// --- 10. Bulk Lead Actions ---
router.post('/admin/bulk-leads', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { action, lead_ids, params: actionParams } = req.body;
  if (!lead_ids || !Array.isArray(lead_ids) || lead_ids.length === 0) {
    throw new AppError(400, 'INVALID', 'lead_ids array required');
  }

  let affected = 0;

  switch (action) {
    case 'delete': {
      const { rowCount } = await query(
        `UPDATE leads SET deleted_at = NOW(), updated_at = NOW()
           WHERE id = ANY($1) AND deleted_at IS NULL`, [lead_ids]
      );
      affected = rowCount;
      break;
    }
    case 'reassign': {
      if (!actionParams?.user_id) throw new AppError(400, 'INVALID', 'params.user_id required for reassign');
      const result = await assignmentEngine.assignLeadsBulk({
        leadIds: lead_ids,
        memberId: actionParams.user_id,
        assignedBy: req.user.id,
        actor: req.user,
        assignmentType: 'manual_reassign',
        reason: actionParams.reason || 'bulk_reassign',
      });
      affected = result.assigned_count ?? result.assigned ?? 0;
      break;
    }
    case 'update_stage': {
      if (!actionParams?.stage) throw new AppError(400, 'INVALID', 'params.stage required');
      const normalizedStage = leadStatusOptions.validateLeadStage(actionParams.stage);
      if (normalizedStage === null) throw new AppError(400, 'INVALID_LEAD_STATUS_VALUE', 'Invalid status value. Please select one of the available CRM statuses.');
      const { rowCount } = await query(
        `UPDATE leads SET stage = $1, updated_at = NOW()
           WHERE id = ANY($2) AND deleted_at IS NULL`, [normalizedStage, lead_ids]
      );
      affected = rowCount;
      break;
    }
    case 'unassign': {
      const { rowCount } = await query(
        `UPDATE leads SET assigned_to_user_id = NULL, assigned_at = NULL, updated_at = NOW()
           WHERE id = ANY($1) AND deleted_at IS NULL`, [lead_ids]
      );
      affected = rowCount;
      break;
    }
    default:
      throw new AppError(400, 'INVALID', `Unknown action: ${action}`);
  }

  await query(
    `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata, ip_address)
       VALUES ($1, 'lead', $2, 'bulk_action', $3, $4)`,
    [req.user.id, lead_ids[0], JSON.stringify({ action, count: affected, lead_ids: lead_ids.slice(0, 10) }), req.ip]
  );

  if (['update_stage', 'unassign'].includes(action)) {
    const userSheets = require('../services/userGoogleSheetsService');
    await Promise.all(lead_ids.map(leadId => userSheets.enqueueLeadSync(leadId, {
      eventType: action,
      source: 'admin_bulk_action',
      userId: req.user.id,
    })));
  }

  res.json({ success: true, data: { action, affected } });
}));

// --- 11. Live Admin Stats (comprehensive real-time) ---
router.get('/admin/live-stats', authenticate, requireRole('super_admin'), responseCache(10000), asyncHandler(async (_req, res) => {
  const { rows: [s] } = await query(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND role = 'rm') AS total_rms,
      (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND role = 'member') AS total_members,
      (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND status = 'active') AS active_users,
      (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND status = 'blocked') AS blocked_users,
      (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND is_available = TRUE AND role = 'member') AS available_members,
      (SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL) AS total_leads,
      (SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL AND assigned_to_user_id IS NULL) AS unassigned_leads,
      (SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL AND is_pending = TRUE) AS pending_leads,
      (SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL AND call_status = 'converted') AS converted_leads,
      (SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_leads,
      (SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL AND assigned_at::date = CURRENT_DATE) AS today_assigned,
      (SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL AND call_status = 'converted' AND updated_at::date = CURRENT_DATE) AS today_conversions,
      (SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL AND next_followup_at::date = CURRENT_DATE) AS today_followups,
      (SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL AND next_followup_at < NOW() AND next_followup_at IS NOT NULL) AS overdue_followups,
      (SELECT COUNT(*) FROM lead_requests WHERE status = 'pending') AS pending_lead_requests,
      (SELECT COUNT(*) FROM distribution_approvals WHERE status = 'pending') AS pending_approvals,
      (SELECT COUNT(*) FROM lead_remarks WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_remarks,
      (SELECT COUNT(DISTINCT user_id) FROM audit_logs WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_active_users,
      (SELECT COUNT(*) FROM broadcast_messages WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_broadcasts,
      (SELECT COUNT(*) FROM admin_notifications WHERE is_read = FALSE) AS unread_notifications,
      -- Ingestion gate: leads rejected today (fake phone / test pattern / no contact) — see services/leadValidator.js
      (SELECT COUNT(*) FROM audit_logs
         WHERE entity = 'lead_ingestion' AND action = 'rejected'
           AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_rejected_leads,
      -- Total dedup-rejected sync events from meta_sync_log (lifetime)
      (SELECT COALESCE(SUM(leads_duplicate), 0)::int FROM meta_sync_log) AS lifetime_duplicate_skipped
  `);
  // Cast all to numbers
  const data = {};
  for (const [k, v] of Object.entries(s)) data[k] = parseInt(v, 10) || 0;
  res.json({ success: true, data });
}));

// --- 12. Unassigned Leads (for force-assign picker) ---
router.get('/admin/unassigned-leads', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit || '50', 10));
  const category = req.query.category;

  let where = 'WHERE l.assigned_to_user_id IS NULL AND l.deleted_at IS NULL';
  const params = [];
  if (category) { params.push(category); where += ` AND l.category = $${params.length}`; }

  params.push(limit);
  const { rows } = await query(`
    SELECT l.id, l.full_name, l.phone, l.category, l.source, l.stage, l.created_at
      FROM leads l
      ${where}
     ORDER BY l.created_at ASC
     LIMIT $${params.length}
  `, params);

  const { rows: [{ total }] } = await query(
    `SELECT COUNT(*) AS total FROM leads l ${where}`, params.slice(0, -1)
  );

  res.json({ success: true, data: { rows, total: parseInt(total, 10) } });
}));

// --- 13. Active Members list (for assignment dropdowns) ---
router.get('/admin/active-members', authenticate, requireRole('super_admin', 'admin'), asyncHandler(async (_req, res) => {
  const { rows } = await query(`
    SELECT u.id, u.full_name, u.role, u.team_name, u.member_type, u.is_available,
           r.full_name AS rm_name,
           (SELECT COUNT(*) FROM leads l WHERE l.assigned_to_user_id = u.id AND l.deleted_at IS NULL) AS lead_count,
           (SELECT COUNT(*) FROM leads l2 WHERE l2.assigned_to_user_id = u.id AND l2.is_pending = TRUE AND l2.deleted_at IS NULL) AS pending_count
      FROM users u
      LEFT JOIN users r ON r.id = u.report_to_id
     WHERE u.deleted_at IS NULL
       AND u.role = 'member'
       AND u.status = 'active'
       AND COALESCE(u.is_available, TRUE) = TRUE
       AND COALESCE(u.distribution_blocked, FALSE) = FALSE
     ORDER BY u.role, u.full_name
  `);
  res.json({ success: true, data: rows });
}));

// ---- Campaign Reports & Filter Data ------------------------------------

// Distinct campaign names (for filter dropdowns) — merges meta_campaigns + leads
router.get('/campaigns/names', authenticate, responseCache(60000), asyncHandler(async (_req, res) => {
  const { rows } = await query(`
    SELECT DISTINCT name FROM (
      SELECT campaign_name AS name FROM meta_campaigns WHERE campaign_name IS NOT NULL
      UNION
      SELECT campaign_name AS name FROM leads WHERE campaign_name IS NOT NULL AND deleted_at IS NULL
    ) AS combined
    ORDER BY name
  `);
  res.json({ success: true, data: rows.map(r => r.name) });
}));

// Distinct adset names (for filter dropdowns)
router.get('/campaigns/adsets', authenticate, responseCache(60000), asyncHandler(async (_req, res) => {
  const { rows } = await query(`
    SELECT DISTINCT adset_name
      FROM leads
     WHERE adset_name IS NOT NULL AND deleted_at IS NULL
     ORDER BY adset_name
  `);
  res.json({ success: true, data: rows.map(r => r.adset_name) });
}));

// Campaign performance report (leads per campaign with stats)
router.get('/reports/campaigns', authenticate, asyncHandler(async (_req, res) => {
  const { rows } = await query(`
    SELECT
      COALESCE(l.campaign_name, l.campaign_label, 'Unknown') AS campaign,
      l.adset_name AS adset,
      COUNT(*) AS total_leads,
      COUNT(*) FILTER (WHERE (COALESCE(l.meta_created_time, l.created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_leads,
      COUNT(*) FILTER (WHERE l.call_status = 'converted') AS conversions,
      COUNT(*) FILTER (WHERE l.call_status = 'interested') AS interested,
      COUNT(*) FILTER (WHERE l.call_status = 'not_interested') AS not_interested,
      COUNT(*) FILTER (WHERE l.stage = 'new') AS new_leads,
      COUNT(*) FILTER (WHERE l.is_pending = TRUE) AS pending,
      ROUND(
        COUNT(*) FILTER (WHERE l.call_status = 'converted')::numeric /
        NULLIF(COUNT(*), 0) * 100, 2
      ) AS conv_rate
    FROM leads l
    WHERE l.deleted_at IS NULL
    GROUP BY COALESCE(l.campaign_name, l.campaign_label, 'Unknown'), l.adset_name
    ORDER BY total_leads DESC
  `);
  res.json({ success: true, data: rows });
}));

// Campaign summary cards (aggregated, no adset breakdown)
router.get('/reports/campaign-summary', authenticate, asyncHandler(async (_req, res) => {
  const { rows } = await query(`
    SELECT
      COALESCE(l.campaign_name, l.campaign_label, 'Unknown') AS campaign,
      COUNT(*) AS total_leads,
      COUNT(*) FILTER (WHERE (COALESCE(l.meta_created_time, l.created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_leads,
      COUNT(*) FILTER (WHERE l.call_status = 'converted') AS conversions,
      ROUND(
        COUNT(*) FILTER (WHERE l.call_status = 'converted')::numeric /
        NULLIF(COUNT(*), 0) * 100, 2
      ) AS conv_rate
    FROM leads l
    WHERE l.deleted_at IS NULL
    GROUP BY COALESCE(l.campaign_name, l.campaign_label, 'Unknown')
    ORDER BY total_leads DESC
  `);
  res.json({ success: true, data: rows });
}));

// ---- Meta Token Update + Campaign Sync Trigger (Super Admin) ----------
const metaSync = require('../services/metaSyncService');
const config = require('../config/env');

async function subscribeAndVerifyMetaPage(pageId) {
  const result = { page_id: String(pageId), webhook: 'not_subscribed', subscribed: false };
  try {
    await metaSync.subscribePageToLeadgen(pageId);
    const status = await metaSync.getPageSubscriptions(pageId);
    const apps = status.data || [];
    const subscribed = apps.some(app => Array.isArray(app.subscribed_fields) && app.subscribed_fields.includes('leadgen'));
    await require('../services/metaTokenResolver').updatePageWebhookStatus(pageId, { subscribed });
    return { ...result, webhook: subscribed ? 'subscribed' : 'not_subscribed', subscribed, subscriptions: apps };
  } catch (error) {
    await require('../services/metaTokenResolver').updatePageWebhookStatus(pageId, { subscribed: false, error: error.message }).catch(() => {});
    return { ...result, webhook: 'error', error: error.message, code: error.code || 'META_GRAPH_ERROR' };
  }
}

async function syncFormsForMetaPage(pageId) {
  try {
    const forms = await metaSync.syncPageForms(pageId);
    return { page_id: String(pageId), forms: forms.total ? 'accessible' : 'accessible_empty', formsCount: forms.total, created: forms.created, updated: forms.updated };
  } catch (error) {
    const isPermission = /permission|permissions|does not have/i.test(error.message || '');
    await require('../services/metaTokenResolver').updatePageFormsStatus(pageId, {
      status: isPermission ? 'permission_error' : 'error',
      error: error.message,
    }).catch(() => {});
    return { page_id: String(pageId), forms: isPermission ? 'permission_error' : 'error', formsCount: 0, error: error.message, code: error.code || 'META_GRAPH_ERROR' };
  }
}

async function updateMetaPageTokenWorkflow({ pageId, pageAccessToken, subscribeWebhook = true, syncForms = true }) {
  const tokenResolver = require('../services/metaTokenResolver');
  const page = await tokenResolver.validateAndSavePageToken({ pageId, token: pageAccessToken });
  const result = {
    page_id: page.page_id,
    page_name: page.page_name,
    pageToken: 'valid',
    webhook: 'skipped',
    forms: 'skipped',
  };
  if (!page.is_active) {
    result.connection_status = page.connection_status || 'discovered';
    result.selection_required = true;
    return result;
  }
  if (subscribeWebhook) Object.assign(result, await subscribeAndVerifyMetaPage(page.page_id));
  if (syncForms) Object.assign(result, await syncFormsForMetaPage(page.page_id));
  return result;
}

// Update Meta access token at runtime (no restart needed)
router.post('/meta/update-token', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const tokenResolver = require('../services/metaTokenResolver');
  const accessToken = req.body?.accessToken || req.body?.user_access_token;
  const pageAccessToken = req.body?.pageAccessToken || req.body?.page_access_token;
  const pageId = req.body?.pageId || req.body?.page_id || null;
  const tokenType = req.body?.tokenType || (accessToken ? 'user' : 'page');

  if (tokenType === 'page' || pageAccessToken) {
    if (!pageId || !pageAccessToken) throw new AppError(400, 'META_PAGE_ID_REQUIRED', 'page_id and pageAccessToken are required for a Page Access Token update');
    const pageResult = await updateMetaPageTokenWorkflow({
      pageId,
      pageAccessToken,
      subscribeWebhook: req.body?.subscribeWebhook !== false,
      syncForms: req.body?.syncForms !== false,
    });
    return res.json({ success: true, data: { token_updated: true, userToken: null, pages: [pageResult], warnings: [] } });
  }

  if (!accessToken) throw new AppError(400, 'INVALID', 'Provide accessToken or user_access_token');

  let permissionInfo;
  try {
    permissionInfo = await tokenResolver.validateUserTokenPermissions(accessToken);
  } catch (error) {
    await tokenResolver.updateUserTokenStatus({ status: 'invalid', error: error.message }).catch(() => {});
    throw error;
  }

  const derivedPages = await tokenResolver.deriveAndSavePageTokenFromUserToken({ userToken: accessToken, pageId });
  await tokenResolver.saveUserToken(accessToken, req.user.id, {
    status: 'valid',
    permissions: permissionInfo.permissions,
  });
  process.env.META_USER_ACCESS_TOKEN = accessToken;
  config.meta.userAccessToken = accessToken;

  const stalePages = pageId
    ? []
    : await tokenResolver.markPagesStaleExcept(derivedPages.map(page => page.page_id)).catch(() => []);
  const pageResults = [];
  for (const page of derivedPages) {
    const result = {
      page_id: page.page_id,
      page_name: page.page_name,
      pageToken: 'valid',
      webhook: 'skipped',
      forms: 'skipped',
      formsCount: 0,
      activeInCrm: !!page.is_active,
      connection_status: page.connection_status || (page.is_active ? 'active' : 'discovered'),
    };
    if (page.is_active && req.body?.subscribeWebhooks !== false) Object.assign(result, await subscribeAndVerifyMetaPage(page.page_id));
    if (page.is_active && req.body?.syncForms !== false) Object.assign(result, await syncFormsForMetaPage(page.page_id));
    if (!page.is_active) result.selection_required = true;
    pageResults.push(result);
  }

  let adAccounts = null;
  let campaignSync = null;
  const warnings = [];
  if (req.body?.syncAdAccounts !== false) {
    try {
      adAccounts = await metaSync.syncAdAccounts();
    } catch (error) {
      adAccounts = { error: error.message };
      warnings.push(`Ad account sync failed: ${error.message}`);
    }
  }
  if (req.body?.syncCampaigns !== false) {
    try {
      campaignSync = await metaSync.syncAllCampaigns();
    } catch (error) {
      campaignSync = { error: error.message };
      warnings.push(`Campaign sync failed: ${error.message}`);
    }
  }
  if (permissionInfo.missing_recommended?.length) {
    warnings.push(`Recommended Meta permissions missing: ${permissionInfo.missing_recommended.join(', ')}`);
  }
  const discoveredCount = pageResults.filter(page => !page.activeInCrm).length;
  if (discoveredCount) {
    warnings.push(`${discoveredCount} newly discovered or inactive page(s) were saved but not activated. Select them explicitly in Connected Meta Pages.`);
  }
  if (stalePages.length) {
    warnings.push(`${stalePages.length} stale page(s) were marked inactive because this user token no longer returned them.`);
  }

  query(
    `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata, ip_address)
       VALUES ($1, 'meta', NULL, 'update_token', $2, $3)`,
    [req.user.id, JSON.stringify({ updated: ['user_token', 'derived_page_tokens'], pages: pageResults.map(page => page.page_id), stale_pages: stalePages.map(page => page.page_id) }), req.ip]
  ).catch(error => logger.warn({ err: error.message }, '[Meta] audit log failed for update-token'));

  res.json({
    success: true,
    data: {
      token_updated: true,
      userToken: { status: 'valid', permissions: permissionInfo.permissions },
      pages: pageResults,
      adAccounts,
      campaign_sync: campaignSync,
      warnings,
    },
  });
}));

// Force campaign sync now (uses current token)
router.post('/meta/sync-campaigns-now', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  try {
    const results = await metaSync.syncAllCampaigns();
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(502).json({ success: false, error: metaGraphError(err, 'Campaign sync failed'), data: null });
  }
}));

// ---- Meta Sync & Campaign Management (Super Admin) -------------------

// Small helper for routes that call Meta Graph API — converts upstream failures
// into a clean 502 with the actual Meta error message instead of a generic 500.
function metaGraphError(err, fallbackMessage) {
  const fb = err?.response?.data?.error;
  return {
    code: 'META_GRAPH_ERROR',
    message: fb?.message || err?.message || fallbackMessage,
    type: fb?.type || null,
    meta_code: fb?.code || null,
  };
}

// Check Meta connectivity (live Graph API test)
router.get('/meta/connectivity', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  try {
    const result = await metaSync.checkConnectivity();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(502).json({ success: false, error: metaGraphError(err, 'Connectivity check failed'), data: null });
  }
}));

// Debug/validate access token
router.get('/meta/debug-token', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  try {
    const data = await metaSync.debugToken();
    res.json({ success: true, data });
  } catch (err) {
    res.status(502).json({ success: false, error: metaGraphError(err, 'Token debug failed'), data: null });
  }
}));

// List campaigns from DB
router.get('/meta/campaigns', authenticate, requireRole('super_admin', 'admin', 'rm'), asyncHandler(async (_req, res) => {
  const { rows } = await query(`SELECT * FROM meta_campaigns ORDER BY internal_label, campaign_name`);
  res.json({ success: true, data: rows });
}));

// Update campaign label/category
router.patch('/meta/campaigns/:campaignId', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { campaignId } = req.params;
  const { internal_label, category, description } = req.body;
  const sets = [];
  const vals = [];
  let idx = 1;
  if (internal_label) { sets.push(`internal_label = $${idx++}`); vals.push(internal_label); }
  if (category) { sets.push(`category = $${idx++}`); vals.push(category); }
  if (description !== undefined) { sets.push(`description = $${idx++}`); vals.push(description); }
  if (!sets.length) throw new AppError(400, 'INVALID', 'Nothing to update');
  vals.push(campaignId);
  const { rows: [r] } = await query(
    `UPDATE meta_campaigns SET ${sets.join(', ')} WHERE campaign_id = $${idx} RETURNING *`,
    vals
  );
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
  res.json({ success: true, data: r });
}));

// Sync campaigns from Meta ad accounts
router.post('/meta/sync-campaigns', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  try {
    const results = await metaSync.syncAllCampaigns();
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(502).json({ success: false, error: metaGraphError(err, 'Campaign sync failed'), data: null });
  }
}));

// Sync leads from all active forms
router.post('/meta/sync-leads', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { form_id, since } = req.body || {};
  try {
    let results;
    if (form_id) {
      results = await metaSync.syncFormLeads(form_id, { since });
    } else {
      results = await metaSync.syncAllFormLeads({ since });
    }
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(502).json({ success: false, error: metaGraphError(err, 'Lead sync failed'), data: null });
  }
}));

// Get campaign stats (leads grouped by campaign)
router.get('/meta/campaign-stats', authenticate, requireRole('super_admin', 'rm'), asyncHandler(async (_req, res) => {
  const stats = await metaSync.getCampaignStats();
  res.json({ success: true, data: stats });
}));

// List ad accounts from DB
router.get('/meta/ad-accounts', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const { rows } = await query(`SELECT * FROM meta_ad_accounts ORDER BY account_id`);
  res.json({ success: true, data: rows });
}));

// Fetch ad accounts from Meta API
router.get('/meta/ad-accounts/discover', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  try {
    const accounts = await metaSync.listAdAccounts();
    res.json({ success: true, data: accounts });
  } catch (err) {
    res.status(502).json({ success: false, error: metaGraphError(err, 'Failed to list ad accounts'), data: [] });
  }
}));

// List forms for a page from Meta API
router.get('/meta/forms/discover', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const pageId = req.query.page_id || null;
  try {
    const forms = await metaSync.listPageForms(pageId);
    res.json({ success: true, data: forms });
  } catch (err) {
    res.status(502).json({ success: false, error: metaGraphError(err, 'Failed to discover forms'), data: [] });
  }
}));

// Sync log history
router.get('/meta/sync-log', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const { rows } = await query(
    `SELECT * FROM meta_sync_log ORDER BY started_at DESC LIMIT $1`,
    [limit]
  );
  res.json({ success: true, data: rows });
}));

// Page subscriptions (webhook prep) — gracefully degrades if Meta token is expired
router.get('/meta/subscriptions', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const pageId = req.query.page_id || null;
  try {
    const data = await metaSync.getPageSubscriptions(pageId);
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const fb = err.response?.data?.error;
    const msg = fb?.message || err.message || 'Failed to fetch subscriptions';
    res.status(502).json({
      success: false,
      error: { code: 'META_GRAPH_ERROR', message: msg, type: fb?.type || null, meta_code: fb?.code || null },
      data: [],
    });
  }
}));

router.post('/meta/subscriptions', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { page_id } = req.body || {};
  try {
    const data = await metaSync.subscribePageToLeadgen(page_id);
    const verify = await metaSync.getPageSubscriptions(page_id);
    const apps = verify.data || [];
    const subscribed = apps.some(app => Array.isArray(app.subscribed_fields) && app.subscribed_fields.includes('leadgen'));
    if (page_id) await require('../services/metaTokenResolver').updatePageWebhookStatus(page_id, { subscribed });
    res.json({ success: true, data: { subscribe: data, status: verify, subscribed } });
  } catch (err) {
    if (page_id) await require('../services/metaTokenResolver').updatePageWebhookStatus(page_id, { subscribed: false, error: err.message }).catch(() => {});
    if (err instanceof AppError) throw err;
    const fb = err.response?.data?.error;
    const msg = fb?.message || err.message || 'Failed to subscribe page';
    res.status(502).json({
      success: false,
      error: { code: 'META_GRAPH_ERROR', message: msg, type: fb?.type || null, meta_code: fb?.code || null },
    });
  }
}));

// ══════════════════════════════════════════════════════════════════════
// PARTNER LEAD REQUESTS — full workflow with timeline + notifications
// ══════════════════════════════════════════════════════════════════════

async function notifyUser(userId, type, title, body, metadata = {}) {
  return notifications.notifyUser(userId, type, title, body, metadata);
}

async function notifyAdmins(type, title, body, metadata = {}) {
  return notifications.notifyAdmins(type, title, body, metadata);
}

async function logTimeline(requestId, actorId, action, detail, metadata = {}) {
  await query(
    `INSERT INTO partner_request_timeline(request_id, actor_id, action, detail, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
    [requestId, actorId, action, detail, JSON.stringify(metadata)]
  ).catch(() => {});
}

// Partner submits lead request
router.post('/partner-requests', authenticate, asyncHandler(async (req, res) => {
  if (!['partner', 'member'].includes(req.user.role)) throw new AppError(403, 'FORBIDDEN', 'Only partners can request leads');
  const { quantity, category, note } = req.body;
  if (!quantity || quantity < 1) throw new AppError(400, 'INVALID', 'Quantity required (1-500)');

  const dup = await query(`SELECT id FROM partner_lead_requests WHERE partner_id = $1 AND status = 'pending' LIMIT 1`, [req.user.id]);
  if (dup.rowCount > 0) throw new AppError(409, 'DUPLICATE', 'You already have a pending request');

  const { rows: [r] } = await query(
    `INSERT INTO partner_lead_requests(partner_id, quantity, category, note)
       VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.user.id, Math.min(500, quantity), category || null, note || null]
  );

  await logTimeline(r.id, req.user.id, 'created', `Requested ${r.quantity} leads${r.category ? ` (${r.category})` : ''}`);
  await notifications.notifyLeadRequestCreated({
    requestId: r.id,
    requesterId: req.user.id,
    requesterName: req.user.full_name || req.user.name,
    requesterRole: 'partner',
    rmId: req.user.reportToId || req.user.report_to_id,
    quantity: r.quantity,
    category: r.category,
    requestType: 'partner',
  });

  res.status(201).json({ success: true, data: r });
}));

// List partner requests — admin sees all, RM sees their partners, partner sees own
router.get('/partner-requests', authenticate, asyncHandler(async (req, res) => {
  const status = req.query.status;
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, parseInt(req.query.page_size || '25', 10));
  const offset = (page - 1) * pageSize;

  let where = '1=1';
  const params = [];

  if (req.user.role === 'partner' || req.user.role === 'member') {
    params.push(req.user.id);
    where += ` AND pr.partner_id = $${params.length}`;
  } else if (req.user.role === 'rm') {
    params.push(req.user.id);
    where += ` AND (pr.assigned_rm_id = $${params.length} OR u.report_to_id = $${params.length})`;
  }

  if (status) {
    params.push(status);
    where += ` AND pr.status = $${params.length}`;
  }

  const countSql = `SELECT COUNT(*) FROM partner_lead_requests pr JOIN users u ON u.id = pr.partner_id WHERE ${where}`;
  const { rows: [{ count: total }] } = await query(countSql, params);

  params.push(pageSize, offset);
  const { rows } = await query(`
    SELECT pr.*,
           u.full_name AS partner_name, u.email AS partner_email, u.phone AS partner_phone,
           u.cp_id AS partner_cp_id, u.member_type AS partner_type, u.team_name,
           rm.full_name AS rm_name,
           rb.full_name AS resolved_by_name
      FROM partner_lead_requests pr
      JOIN users u ON u.id = pr.partner_id
      LEFT JOIN users rm ON rm.id = pr.assigned_rm_id
      LEFT JOIN users rb ON rb.id = pr.resolved_by
     WHERE ${where}
     ORDER BY pr.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  res.json({ success: true, data: { rows, total: parseInt(total, 10), page, pageSize } });
}));

// Dashboard stats for partner requests (must be before :id route)
router.get('/partner-requests/stats/summary', authenticate, asyncHandler(async (req, res) => {
  const { rows: [s] } = await query(`
    SELECT
      (SELECT COUNT(*) FROM partner_lead_requests) AS total_requests,
      (SELECT COUNT(*) FROM partner_lead_requests WHERE status = 'pending') AS pending,
      (SELECT COUNT(*) FROM partner_lead_requests WHERE status = 'approved' AND updated_at::date = CURRENT_DATE) AS approved_today,
      (SELECT COUNT(*) FROM partner_lead_requests WHERE status IN ('assigned','completed')) AS assigned_total,
      (SELECT COALESCE(SUM(leads_assigned), 0) FROM partner_lead_requests WHERE status IN ('assigned','completed')) AS total_leads_assigned,
      (SELECT COUNT(DISTINCT partner_id) FROM partner_lead_requests WHERE created_at > NOW() - INTERVAL '7 days') AS active_partners_week
  `);
  const data = {};
  for (const [k, v] of Object.entries(s)) data[k] = parseInt(v, 10) || 0;
  res.json({ success: true, data });
}));

// Get single request with timeline
router.get('/partner-requests/:id', authenticate, asyncHandler(async (req, res) => {
  const { rows: [r] } = await query(`
    SELECT pr.*,
           u.full_name AS partner_name, u.email AS partner_email, u.phone AS partner_phone,
           u.cp_id AS partner_cp_id, u.member_type AS partner_type, u.team_name,
           rm.full_name AS rm_name,
           rb.full_name AS resolved_by_name
      FROM partner_lead_requests pr
      JOIN users u ON u.id = pr.partner_id
      LEFT JOIN users rm ON rm.id = pr.assigned_rm_id
      LEFT JOIN users rb ON rb.id = pr.resolved_by
     WHERE pr.id = $1
  `, [req.params.id]);
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Request not found');

  const { rows: timeline } = await query(`
    SELECT t.*, a.full_name AS actor_name
      FROM partner_request_timeline t
      LEFT JOIN users a ON a.id = t.actor_id
     WHERE t.request_id = $1
     ORDER BY t.created_at ASC
  `, [req.params.id]);

  res.json({ success: true, data: { ...r, timeline } });
}));

// Approve request (RM/Admin)
router.post('/partner-requests/:id/approve', authenticate, requireRole('super_admin', 'rm'), asyncHandler(async (req, res) => {
  const { note } = req.body || {};
  const { rows: [r] } = await query(
    `SELECT pr.*, u.full_name FROM partner_lead_requests pr JOIN users u ON u.id = pr.partner_id WHERE pr.id = $1 AND pr.status = 'pending'`,
    [req.params.id]
  );
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Request not found or not pending');

  await query(
    `UPDATE partner_lead_requests SET status = 'approved', assigned_rm_id = COALESCE(assigned_rm_id, $1),
            resolved_by = $1, resolved_at = NOW(), resolve_note = $2, updated_at = NOW()
       WHERE id = $3`,
    [req.user.id, note || null, r.id]
  );

  await logTimeline(r.id, req.user.id, 'approved', `Approved by ${req.user.full_name || req.user.name}${note ? ': ' + note : ''}`);
  await notifications.notifyLeadRequestResolved({
    requestId: r.id,
    requesterId: r.partner_id,
    quantity: r.quantity,
    assigned: r.leads_assigned || 0,
    status: 'approved',
    note,
    requestType: 'partner',
    resolvedByUserId: req.user.id,
    approvedByUserId: req.user.id,
    approverName: req.user.full_name || req.user.name,
  });

  res.json({ success: true, data: { message: 'Request approved' } });
}));

// Reject request (RM/Admin)
router.post('/partner-requests/:id/reject', authenticate, requireRole('super_admin', 'rm'), asyncHandler(async (req, res) => {
  const { note } = req.body || {};
  const { rows: [r] } = await query(
    `SELECT pr.*, u.full_name FROM partner_lead_requests pr JOIN users u ON u.id = pr.partner_id WHERE pr.id = $1 AND pr.status = 'pending'`,
    [req.params.id]
  );
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Request not found or not pending');

  await query(
    `UPDATE partner_lead_requests SET status = 'rejected', resolved_by = $1, resolved_at = NOW(),
            resolve_note = $2, updated_at = NOW()
       WHERE id = $3`,
    [req.user.id, note || null, r.id]
  );

  await logTimeline(r.id, req.user.id, 'rejected', `Rejected by ${req.user.full_name || req.user.name}${note ? ': ' + note : ''}`);
  await notifications.notifyLeadRequestResolved({
    requestId: r.id,
    requesterId: r.partner_id,
    quantity: r.quantity,
    assigned: 0,
    status: 'rejected',
    note,
    requestType: 'partner',
    resolvedByUserId: req.user.id,
    rejectedByUserId: req.user.id,
    approverName: req.user.full_name || req.user.name,
  });

  res.json({ success: true, data: { message: 'Request rejected' } });
}));

// Auto-assign leads to partner from approved request
router.post('/partner-requests/:id/assign', authenticate, requireRole('super_admin', 'rm'), asyncHandler(async (req, res) => {
  const { rows: [r] } = await query(
    `SELECT * FROM partner_lead_requests WHERE id = $1 AND status IN ('approved','assigned')`,
    [req.params.id]
  );
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Request not found or not approved');
  await validateLeadAssignee({ query }, r.partner_id, { actor: req.user });

  const remaining = r.quantity - r.leads_assigned;
  if (remaining <= 0) throw new AppError(400, 'ALREADY_FULFILLED', 'All leads already assigned');

  const { rows: leads } = await query(
    `SELECT id FROM leads
       WHERE assigned_to_user_id IS NULL AND deleted_at IS NULL
       ${r.category ? 'AND category = $2' : ''}
       ORDER BY created_at ASC
       LIMIT $1`,
    r.category ? [remaining, r.category] : [remaining]
  );

  let assigned = 0;
  for (const l of leads) {
    await query(
      `UPDATE leads SET assigned_to_user_id = $1, assigned_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [r.partner_id, l.id]
    );
    await query(
      `INSERT INTO lead_assignments(lead_id, user_id, reason) VALUES ($1, $2, 'partner_request')`,
      [l.id, r.partner_id]
    );
    assigned++;
  }

  const newTotal = r.leads_assigned + assigned;
  const newStatus = newTotal >= r.quantity ? 'completed' : 'assigned';
  await query(
    `UPDATE partner_lead_requests SET leads_assigned = $1, status = $2, updated_at = NOW() WHERE id = $3`,
    [newTotal, newStatus, r.id]
  );

  await logTimeline(r.id, req.user.id, 'assigned', `${assigned} leads auto-assigned (${newTotal}/${r.quantity} total)`, { assigned, total: newTotal });
  if (assigned > 0) {
    await notifications.notifyLeadAssigned(r.partner_id, assigned, {
      request_id: r.id,
      count: assigned,
      lead_ids: leads.slice(0, assigned).map(l => l.id),
      assignment_type: 'partner_request',
      assigned_by: req.user.id,
    });
    await notifications.notifyLeadRequestResolved({
      requestId: r.id,
      requesterId: r.partner_id,
      quantity: r.quantity,
      assigned: newTotal,
      status: newStatus === 'completed' ? 'approved' : 'partially_approved',
      requestType: 'partner',
      resolvedByUserId: req.user.id,
      approvedByUserId: req.user.id,
      approverName: req.user.full_name || req.user.name,
    });
  }

  res.json({ success: true, data: { assigned, total_assigned: newTotal, remaining: r.quantity - newTotal, status: newStatus } });
}));

// Manual assign specific leads to partner
router.post('/partner-requests/:id/manual-assign', authenticate, requireRole('super_admin', 'rm'), asyncHandler(async (req, res) => {
  const { lead_ids } = req.body;
  if (!lead_ids?.length) throw new AppError(400, 'INVALID', 'lead_ids required');

  const { rows: [r] } = await query(
    `SELECT * FROM partner_lead_requests WHERE id = $1 AND status IN ('approved','assigned')`,
    [req.params.id]
  );
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Request not found or not approved');
  await validateLeadAssignee({ query }, r.partner_id, { actor: req.user });

  let assigned = 0;
  for (const lid of lead_ids) {
    const { rowCount } = await query(
      `UPDATE leads SET assigned_to_user_id = $1, assigned_at = NOW(), updated_at = NOW()
         WHERE id = $2 AND assigned_to_user_id IS NULL AND deleted_at IS NULL`,
      [r.partner_id, lid]
    );
    if (rowCount > 0) {
      await query(`INSERT INTO lead_assignments(lead_id, user_id, reason) VALUES ($1, $2, 'partner_manual')`, [lid, r.partner_id]);
      assigned++;
    }
  }

  const newTotal = r.leads_assigned + assigned;
  const newStatus = newTotal >= r.quantity ? 'completed' : 'assigned';
  await query(
    `UPDATE partner_lead_requests SET leads_assigned = $1, status = $2, updated_at = NOW() WHERE id = $3`,
    [newTotal, newStatus, r.id]
  );

  await logTimeline(r.id, req.user.id, 'manual_assign', `${assigned} leads manually assigned`, { lead_ids: lead_ids.slice(0, 10), assigned });
  if (assigned > 0) {
    await notifications.notifyLeadAssigned(r.partner_id, assigned, {
      request_id: r.id,
      count: assigned,
      lead_ids: lead_ids.slice(0, assigned),
      assignment_type: 'partner_manual',
      assigned_by: req.user.id,
    });
  }

  res.json({ success: true, data: { assigned, total_assigned: newTotal, status: newStatus } });
}));

// Cancel own request (partner)
router.delete('/partner-requests/:id', authenticate, asyncHandler(async (req, res) => {
  const { rowCount } = await query(
    `DELETE FROM partner_lead_requests WHERE id = $1 AND partner_id = $2 AND status = 'pending' RETURNING id`,
    [req.params.id, req.user.id]
  );
  if (rowCount === 0) throw new AppError(404, 'NOT_FOUND', 'Cannot cancel — not found or not pending');
  res.json({ success: true, data: { deleted: true } });
}));

// ══════════════════════════════════════════════════════════════════════
// USER NOTIFICATIONS — bell system for ALL roles
// ══════════════════════════════════════════════════════════════════════

router.get('/notifications', authenticate, asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.max(1, Math.min(50, parseInt(req.query.page_size || '20', 10)));
  const offset = (page - 1) * pageSize;

  const { rows } = await query(
    `SELECT * FROM user_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [req.user.id, pageSize, offset]
  );
  const { rows: [{ count: unread }] } = await query(
    `SELECT COUNT(*) FROM user_notifications WHERE user_id = $1 AND is_read = FALSE`,
    [req.user.id]
  );
  const { rows: [{ count: total }] } = await query(
    `SELECT COUNT(*) FROM user_notifications WHERE user_id = $1`,
    [req.user.id]
  );
  const totalCount = parseInt(total, 10);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  res.json({
    success: true,
    data: {
      notifications: rows,
      unread: parseInt(unread, 10),
      pagination: {
        page,
        page_size: pageSize,
        total: totalCount,
        total_pages: totalPages,
        has_more: page < totalPages,
      },
    },
  });
}));

router.post('/notifications/:id/read', authenticate, asyncHandler(async (req, res) => {
  await query(`UPDATE user_notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
  res.json({ success: true });
}));

router.post('/notifications/read-all', authenticate, asyncHandler(async (req, res) => {
  await query(`UPDATE user_notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`, [req.user.id]);
  res.json({ success: true });
}));

// Live role-scoped leaderboard. It returns performance fields only: no email,
// phone, or personal contact details.
router.get('/leaderboard', authenticate, asyncHandler(async (req, res) => {
  const actor = req.user;
  const scope = normalizeLeaderboardScope(String(req.query.scope || ''), actor.role);
  const period = String(req.query.period || 'this_month');
  const page = Math.max(1, Number.parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(req.query.page_size || '20', 10)));
  const offset = (page - 1) * pageSize;

  if (!isLeaderboardScopeAllowed(scope, actor.role)) {
    throw new AppError(403, 'LEADERBOARD_FORBIDDEN', 'You are not allowed to view this leaderboard.');
  }

  const params = [];
  const userWhere = ['u.deleted_at IS NULL', "COALESCE(u.status::text, 'active') = 'active'"];
  const isAdmin = actor.role === 'super_admin' || actor.role === 'admin';

  if (scope === 'rms') {
    userWhere.push("u.role::text = 'rm'");
  } else if (scope === 'members') {
    userWhere.push("u.role::text = 'member'");
  } else if (scope === 'partners') {
    userWhere.push("u.role::text = 'partner'");
  } else if (scope === 'team') {
    userWhere.push("u.role::text IN ('member', 'partner')");
    if (actor.role === 'rm') {
      params.push(actor.id);
      userWhere.push(`u.report_to_id = $${params.length}`);
    } else if (actor.role === 'member' || actor.role === 'partner') {
      const { rows: [me] } = await query(`SELECT report_to_id FROM users WHERE id = $1`, [actor.id]);
      if (me?.report_to_id) {
        params.push(me.report_to_id);
        userWhere.push(`u.report_to_id = $${params.length}`);
      } else {
        params.push(actor.id);
        userWhere.push(`u.id = $${params.length}`);
      }
    }
  } else {
    userWhere.push("u.role::text IN ('rm', 'member', 'partner')");
  }

  const leadDateFilter = leaderboardDateFilter('l.assigned_at', period);
  const callDateFilter = leaderboardDateFilter('cl.created_at', period);
  const remarkDateFilter = leaderboardDateFilter('lr.created_at', period);
  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;

  const { rows } = await query(`
    WITH ranked AS (
      SELECT
        u.id AS user_id,
        u.full_name AS name,
        u.role::text AS role,
        u.team_name,
        rm.full_name AS rm_name,
        COALESCE(leads.total_leads, 0)::int AS total_leads,
        COALESCE(leads.converted_leads, 0)::int AS converted_leads,
        COALESCE(leads.completed_leads, 0)::int AS completed_leads,
        COALESCE(leads.contacted_leads, 0)::int AS contacted_leads,
        COALESCE(remarks.followups_done, 0)::int AS followups_done,
        COALESCE(calls.call_count, 0)::int AS call_count,
        CASE WHEN COALESCE(leads.total_leads, 0) > 0
          THEN ROUND(COALESCE(leads.converted_leads, 0)::numeric * 100 / leads.total_leads, 2)
          ELSE 0 END AS conversion_rate,
        CASE WHEN COALESCE(leads.total_leads, 0) > 0
          THEN ROUND(COALESCE(leads.completed_leads, 0)::numeric * 100 / leads.total_leads, 2)
          ELSE 0 END AS completion_rate,
        (
          COALESCE(leads.converted_leads, 0) * 50
          + COALESCE(leads.completed_leads, 0) * 20
          + COALESCE(leads.contacted_leads, 0) * 10
          + COALESCE(remarks.followups_done, 0) * 5
          + COALESCE(calls.call_count, 0) * 2
          + CASE WHEN COALESCE(leads.total_leads, 0) > 0
            THEN ROUND(COALESCE(leads.converted_leads, 0)::numeric * 100 / leads.total_leads)
            ELSE 0 END
        )::numeric AS performance_score,
        GREATEST(
          COALESCE(leads.last_lead_activity_at, 'epoch'::timestamptz),
          COALESCE(calls.last_call_at, 'epoch'::timestamptz),
          COALESCE(remarks.last_remark_at, 'epoch'::timestamptz)
        ) AS last_activity_at
      FROM users u
      LEFT JOIN users rm ON rm.id = u.report_to_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS total_leads,
          COUNT(*) FILTER (WHERE l.call_status::text = 'converted' OR l.stage::text = 'won') AS converted_leads,
          COUNT(*) FILTER (WHERE l.stage::text IN ('won', 'lost', 'dropped') OR l.call_status::text IN ('converted', 'not_interested', 'wrong_number', 'invalid_number', 'ni')) AS completed_leads,
          COUNT(*) FILTER (WHERE l.last_call_at IS NOT NULL OR l.call_status::text NOT IN ('not_called', 'rnr', 'cnr', 'busy', 'switched_off', 'so', 'nc', 'ccb', 'nn')) AS contacted_leads,
          MAX(COALESCE(l.last_call_at, l.updated_at, l.assigned_at, l.created_at)) AS last_lead_activity_at
        FROM leads l
        WHERE l.assigned_to_user_id = u.id
          AND l.deleted_at IS NULL
          ${leadDateFilter}
      ) leads ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS call_count, MAX(cl.created_at) AS last_call_at
        FROM lead_call_logs cl
        WHERE cl.user_id = u.id
          ${callDateFilter}
      ) calls ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE lr.next_followup_at IS NOT NULL) AS followups_done,
               MAX(lr.created_at) AS last_remark_at
        FROM lead_remarks lr
        WHERE lr.user_id = u.id
          ${remarkDateFilter}
      ) remarks ON true
      WHERE ${userWhere.join(' AND ')}
    ),
    numbered AS (
      SELECT *,
             ROW_NUMBER() OVER (
               ORDER BY performance_score DESC, converted_leads DESC, completed_leads DESC,
                        contacted_leads DESC, total_leads DESC, name ASC
             )::int AS rank
      FROM ranked
    )
    SELECT *, COUNT(*) OVER()::int AS total_count
    FROM numbered
    ORDER BY rank ASC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `, [...params, pageSize, offset]);

  const total = rows[0]?.total_count || 0;
  const data = rows.map((row) => ({
    rank: row.rank,
    user_id: row.user_id,
    name: row.name,
    role: row.role,
    team_name: row.team_name,
    rm_name: row.rm_name,
    total_leads: row.total_leads,
    converted_leads: row.converted_leads,
    completed_leads: row.completed_leads,
    contacted_leads: row.contacted_leads,
    followups_done: row.followups_done,
    call_count: row.call_count,
    conversion_rate: Number(row.conversion_rate || 0),
    completion_rate: Number(row.completion_rate || 0),
    performance_score: Number(row.performance_score || 0),
    badge: leaderboardBadge(row),
    last_activity_at: row.last_activity_at && String(row.last_activity_at).startsWith('1970') ? null : row.last_activity_at,
  }));

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  res.json({
    success: true,
    data,
    summary: {
      period,
      scope,
      total_ranked_users: total,
      visible_to_role: actor.role,
      scope_note: isAdmin ? 'Admin can view CRM-wide leaderboard.' : 'Results are scoped to your role and team.',
      score_formula: 'converted*50 + completed*20 + contacted*10 + followups*5 + calls*2 + conversion_rate_bonus',
    },
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: totalPages,
      has_more: page < totalPages,
    },
  });
}));

function normalizeLeaderboardScope(scope, role) {
  const mapped = {
    all: 'all',
    overall: 'all',
    rms: 'rms',
    rm: 'rms',
    members: 'members',
    member: 'members',
    partners: 'partners',
    partner: 'partners',
    team: 'team',
  }[scope] || null;
  if (mapped) return mapped;
  if (role === 'super_admin' || role === 'admin') return 'all';
  return 'team';
}

function isLeaderboardScopeAllowed(scope, role) {
  if (role === 'super_admin' || role === 'admin') return ['all', 'rms', 'members', 'partners', 'team'].includes(scope);
  if (role === 'rm') return ['team', 'rms'].includes(scope);
  if (role === 'member' || role === 'partner') return scope === 'team';
  return false;
}

function leaderboardDateFilter(column, period) {
  if (period === 'today') return `AND (${column} AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date`;
  if (period === 'this_week' || period === 'week') return `AND ${column} >= date_trunc('week', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`;
  if (period === 'all_time' || period === 'all') return '';
  return `AND ${column} >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`;
}

function leaderboardBadge(row) {
  if (Number(row.rank) === 1) return 'Champion';
  if (Number(row.rank) === 2) return 'Star Performer';
  if (Number(row.rank) === 3) return 'High Achiever';
  if (Number(row.total_leads) >= 10 && Number(row.conversion_rate) >= 50) return 'Conversion Pro';
  if (Number(row.completed_leads) >= 20) return 'Task Finisher';
  return 'Performer';
}

// ══════════════════════════════════════════════════════════════════════
// PERFORMANCE RANKINGS — real-time scoring from actual CRM activity
// ══════════════════════════════════════════════════════════════════════

const RANK_LABELS = [
  { pos: 1,  emoji: '⭐', label: 'Superstar Performer' },
  { pos: 2,  emoji: '👑', label: 'Excellent Leader' },
  { pos: 3,  emoji: '🔥', label: 'Great Performer' },
  { pos: 4,  emoji: '🚀', label: 'Rising Star' },
  { pos: 5,  emoji: '💎', label: 'Smart Worker' },
  { pos: 6,  emoji: '🎯', label: 'Fast Responder' },
  { pos: 7,  emoji: '⚡', label: 'Active Performer' },
  { pos: 8,  emoji: '🏆', label: 'Team Player' },
  { pos: 9,  emoji: '🌟', label: 'Consistent Worker' },
  { pos: 10, emoji: '🎉', label: 'Good Performer' },
];

const BADGE_MAP = {
  star: '⭐', excellent: '🔥', good_work: '👏', outstanding: '💎',
  fast_worker: '🚀', top_closer: '🏆', best_followup: '🎯',
};

function buildScoreSQL(roleFilter, teamFilter) {
  const where = [];
  const params = [];
  let pidx = 0;

  where.push("u.deleted_at IS NULL", "u.status = 'active'");

  if (roleFilter) {
    pidx++;
    where.push(`u.role = $${pidx}`);
    params.push(roleFilter);
  }
  if (teamFilter) {
    pidx++;
    where.push(`u.team_name = $${pidx}`);
    params.push(teamFilter);
  }

  return {
    sql: `
      SELECT
        u.id, u.full_name, u.role, u.team_name, u.email,
        COALESCE(ls.total, 0)       AS leads_total,
        COALESCE(ls.converted, 0)   AS leads_converted,
        COALESCE(rm.calls, 0)       AS calls_made,
        COALESCE(rm.followups, 0)   AS followups_done,
        COALESCE(rm.avg_resp, 0)    AS avg_response_hrs,
        CASE WHEN COALESCE(ls.total, 0) > 0
             THEN ROUND(COALESCE(ls.converted, 0)::numeric / ls.total * 100, 2)
             ELSE 0 END AS conv_rate,
        -- Composite score: conversions*10 + calls*2 + followups*3 + speed_bonus
        (COALESCE(ls.converted, 0) * 10
         + COALESCE(rm.calls, 0) * 2
         + COALESCE(rm.followups, 0) * 3
         + CASE WHEN COALESCE(rm.avg_resp, 999) < 2 THEN 15
                WHEN COALESCE(rm.avg_resp, 999) < 6 THEN 8
                WHEN COALESCE(rm.avg_resp, 999) < 24 THEN 3
                ELSE 0 END
         + COALESCE(ls.total, 0)
        ) AS score
      FROM users u
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE l.call_status = 'converted') AS converted
        FROM leads l
        WHERE l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
      ) ls ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS calls,
          COUNT(*) FILTER (WHERE r.next_followup_at IS NOT NULL) AS followups,
          EXTRACT(EPOCH FROM AVG(r.created_at - l2.assigned_at)) / 3600 AS avg_resp
        FROM lead_remarks r
        JOIN leads l2 ON l2.id = r.lead_id
        WHERE r.user_id = u.id
      ) rm ON true
      WHERE ${where.join(' AND ')}
      ORDER BY score DESC
      LIMIT 10
    `,
    params,
  };
}

// Compute & store daily rankings (called by scheduler or manually)
async function computeDailyRankings() {
  const today = new Date().toISOString().slice(0, 10);

  const scopes = [
    { scope: 'member',  roleFilter: 'member',  teamFilter: null },
    { scope: 'partner', roleFilter: 'partner', teamFilter: null },
    { scope: 'rm',      roleFilter: 'rm',      teamFilter: null },
    { scope: 'overall', roleFilter: null,       teamFilter: null },
  ];

  let totalInserted = 0;

  for (const { scope, roleFilter } of scopes) {
    const { sql, params } = buildScoreSQL(roleFilter, null);
    const { rows } = await query(sql, params);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const pos = i + 1;

      const { rows: prev } = await query(
        `SELECT rank_position FROM daily_rankings
         WHERE user_id = $1 AND scope = $2 AND rank_date < $3
         ORDER BY rank_date DESC LIMIT 1`,
        [r.id, scope, today]
      );
      const prevPos = prev[0]?.rank_position || null;
      const movement = !prevPos ? 'new' : prevPos > pos ? 'up' : prevPos < pos ? 'down' : 'stable';

      await query(`
        INSERT INTO daily_rankings (user_id, rank_date, scope, team_name, rank_position, prev_position, score,
          leads_total, leads_converted, calls_made, followups_done, avg_response_hrs, conv_rate, movement)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (user_id, rank_date, scope) DO UPDATE SET
          rank_position = EXCLUDED.rank_position, prev_position = EXCLUDED.prev_position,
          score = EXCLUDED.score, leads_total = EXCLUDED.leads_total,
          leads_converted = EXCLUDED.leads_converted, calls_made = EXCLUDED.calls_made,
          followups_done = EXCLUDED.followups_done, avg_response_hrs = EXCLUDED.avg_response_hrs,
          conv_rate = EXCLUDED.conv_rate, movement = EXCLUDED.movement
      `, [r.id, today, scope, r.team_name, pos, prevPos, r.score,
          r.leads_total, r.leads_converted, r.calls_made, r.followups_done,
          r.avg_response_hrs || 0, r.conv_rate, movement]);
      totalInserted++;
    }
  }

  // Team rankings — aggregate scores by team
  const { rows: teamRows } = await query(`
    SELECT u.team_name,
           SUM(COALESCE(ls.converted, 0) * 10 + COALESCE(rm2.calls, 0) * 2 + COALESCE(rm2.followups, 0) * 3 + COALESCE(ls.total, 0)) AS score,
           SUM(COALESCE(ls.total, 0)) AS leads_total,
           SUM(COALESCE(ls.converted, 0)) AS leads_converted,
           SUM(COALESCE(rm2.calls, 0)) AS calls_made,
           SUM(COALESCE(rm2.followups, 0)) AS followups_done,
           COUNT(u.id) AS member_count
    FROM users u
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE l.call_status = 'converted') AS converted
      FROM leads l WHERE l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
    ) ls ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS calls, COUNT(*) FILTER (WHERE r.next_followup_at IS NOT NULL) AS followups
      FROM lead_remarks r WHERE r.user_id = u.id
    ) rm2 ON true
    WHERE u.deleted_at IS NULL AND u.status = 'active' AND u.team_name IS NOT NULL
    GROUP BY u.team_name
    ORDER BY score DESC
    LIMIT 10
  `);

  for (let i = 0; i < teamRows.length; i++) {
    const t = teamRows[i];
    const pos = i + 1;
    const { rows: prev } = await query(
      `SELECT rank_position FROM daily_rankings WHERE team_name = $1 AND scope = 'team' AND rank_date < $2 ORDER BY rank_date DESC LIMIT 1`,
      [t.team_name, today]
    );
    const prevPos = prev[0]?.rank_position || null;
    const movement = !prevPos ? 'new' : prevPos > pos ? 'up' : prevPos < pos ? 'down' : 'stable';

    const dummyId = (await query(`SELECT id FROM users WHERE team_name = $1 AND role = 'rm' LIMIT 1`, [t.team_name])).rows[0]?.id;
    if (!dummyId) continue;

    await query(`
      INSERT INTO daily_rankings (user_id, rank_date, scope, team_name, rank_position, prev_position, score,
        leads_total, leads_converted, calls_made, followups_done, avg_response_hrs, conv_rate, movement)
      VALUES ($1,$2,'team',$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$12)
      ON CONFLICT (user_id, rank_date, scope) DO UPDATE SET
        rank_position = EXCLUDED.rank_position, prev_position = EXCLUDED.prev_position,
        score = EXCLUDED.score, leads_total = EXCLUDED.leads_total,
        leads_converted = EXCLUDED.leads_converted, calls_made = EXCLUDED.calls_made,
        followups_done = EXCLUDED.followups_done, conv_rate = EXCLUDED.conv_rate, movement = EXCLUDED.movement
    `, [dummyId, today, t.team_name, pos, prevPos, t.score || 0,
        t.leads_total, t.leads_converted, t.calls_made, t.followups_done,
        t.leads_total > 0 ? Math.round(t.leads_converted / t.leads_total * 10000) / 100 : 0, movement]);
    totalInserted++;
  }

  return totalInserted;
}

// POST /rankings/compute — manually trigger ranking computation (must be before :scope)
router.post('/rankings/compute', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const count = await computeDailyRankings();
  res.json({ success: true, data: { computed: count, date: new Date().toISOString().slice(0, 10) } });
}));

// GET /rankings/my — current user's rank across all scopes (must be before :scope)
router.get('/rankings/my', authenticate, asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT scope, rank_position, prev_position, score, movement, rank_date
    FROM daily_rankings
    WHERE user_id = $1 AND rank_date = CURRENT_DATE
    ORDER BY scope
  `, [req.user.id]);

  const badges = await query(`
    SELECT badge_type, COUNT(*) AS count FROM appreciations WHERE to_user_id = $1 GROUP BY badge_type
  `, [req.user.id]);

  res.json({ success: true, data: { ranks: rows, badges: badges.rows } });
}));

// GET /rankings/rm-insights — RM-specific: top/weak members, daily changes
router.get('/rankings/rm-insights', authenticate, requireRole('rm'), asyncHandler(async (req, res) => {
  const { rows: topMembers } = await query(`
    SELECT dr.*, u.full_name, u.team_name AS user_team
    FROM daily_rankings dr JOIN users u ON u.id = dr.user_id
    WHERE dr.scope = 'member' AND dr.rank_date = CURRENT_DATE
      AND u.report_to_id = $1
    ORDER BY dr.score DESC LIMIT 5
  `, [req.user.id]);

  const { rows: weakMembers } = await query(`
    SELECT u.id, u.full_name, u.team_name,
           COALESCE(ls.total, 0) AS leads_total,
           COALESCE(ls.converted, 0) AS leads_converted,
           COALESCE(rm3.calls, 0) AS calls_made
    FROM users u
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE l.call_status = 'converted') AS converted
      FROM leads l WHERE l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
    ) ls ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS calls FROM lead_remarks r WHERE r.user_id = u.id
    ) rm3 ON true
    WHERE u.report_to_id = $1 AND u.deleted_at IS NULL AND u.status = 'active' AND u.role = 'member'
    ORDER BY COALESCE(ls.converted, 0) ASC, COALESCE(rm3.calls, 0) ASC
    LIMIT 5
  `, [req.user.id]);

  const { rows: bestConverter } = await query(`
    SELECT u.id, u.full_name, COUNT(*) FILTER (WHERE l.call_status = 'converted') AS conversions,
           COUNT(*) AS total
    FROM users u JOIN leads l ON l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
    WHERE u.report_to_id = $1 AND u.role = 'member' AND u.deleted_at IS NULL
    GROUP BY u.id, u.full_name
    ORDER BY conversions DESC LIMIT 1
  `, [req.user.id]);

  const { rows: mostActive } = await query(`
    SELECT u.id, u.full_name, COUNT(*) AS activity
    FROM users u JOIN lead_remarks r ON r.user_id = u.id
    WHERE u.report_to_id = $1 AND u.role = 'member' AND u.deleted_at IS NULL
      AND r.created_at >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY u.id, u.full_name
    ORDER BY activity DESC LIMIT 1
  `, [req.user.id]);

  res.json({
    success: true,
    data: {
      top_members: topMembers,
      weak_members: weakMembers,
      best_converter: bestConverter[0] || null,
      most_active: mostActive[0] || null,
      rank_labels: RANK_LABELS,
    },
  });
}));

// GET /rankings/user-history/:userId — ranking trend over time
router.get('/rankings/user-history/:userId', authenticate, asyncHandler(async (req, res) => {
  const days = Math.min(90, parseInt(req.query.days || '30', 10));
  const scope = req.query.scope || 'overall';

  const { rows } = await query(`
    SELECT rank_date, rank_position, prev_position, score, leads_converted, calls_made, followups_done, conv_rate, movement
    FROM daily_rankings
    WHERE user_id = $1 AND scope = $2 AND rank_date >= CURRENT_DATE - INTERVAL '${days} days'
    ORDER BY rank_date ASC
  `, [req.params.userId, scope]);

  const current = rows[rows.length - 1];
  const oldest = rows[0];
  const growth = current && oldest && oldest.score > 0
    ? Math.round((current.score - oldest.score) / oldest.score * 100)
    : 0;

  res.json({ success: true, data: { history: rows, growth_pct: growth, current_rank: current?.rank_position || null } });
}));

// GET /rankings/:scope — live top 10 (MUST be after all static /rankings/* routes)
router.get('/rankings/:scope', authenticate, asyncHandler(async (req, res) => {
  const scope = req.params.scope;
  if (!['member', 'partner', 'rm', 'team', 'overall'].includes(scope)) {
    throw new AppError(400, 'INVALID', 'Scope must be member, partner, rm, team, or overall');
  }
  const period = req.query.period || 'today';
  const teamFilter = req.query.team || null;

  let dateFilter;
  if (period === 'week') dateFilter = "rank_date >= CURRENT_DATE - INTERVAL '7 days'";
  else if (period === 'month') dateFilter = "rank_date >= CURRENT_DATE - INTERVAL '30 days'";
  else dateFilter = 'rank_date = CURRENT_DATE';

  const { rows } = await query(`
    SELECT dr.*, u.full_name, u.email, u.role, u.team_name AS user_team,
           (SELECT COUNT(*) FROM appreciations a WHERE a.to_user_id = dr.user_id AND a.created_at > NOW() - INTERVAL '30 days') AS recent_appreciations,
           (SELECT json_agg(json_build_object('badge_type', a2.badge_type, 'note', a2.note, 'from_name', fu.full_name, 'created_at', a2.created_at))
            FROM (SELECT * FROM appreciations WHERE to_user_id = dr.user_id ORDER BY created_at DESC LIMIT 3) a2
            LEFT JOIN users fu ON fu.id = a2.from_user_id) AS latest_badges
    FROM daily_rankings dr
    JOIN users u ON u.id = dr.user_id
    WHERE dr.scope = $1 AND ${dateFilter}
    ${teamFilter ? 'AND dr.team_name = $2' : ''}
    ORDER BY dr.rank_position ASC
    LIMIT 10
  `, teamFilter ? [scope, teamFilter] : [scope]);

  const ranked = rows.map((r, i) => ({
    ...r,
    rank_label: RANK_LABELS[i] || null,
    badge_emoji: BADGE_MAP,
  }));

  res.json({ success: true, data: ranked });
}));

// ══════════════════════════════════════════════════════════════════════
// APPRECIATION SYSTEM — RM/Admin can give badges
// ══════════════════════════════════════════════════════════════════════

router.post('/appreciations', authenticate, requireRole('super_admin', 'rm'), asyncHandler(async (req, res) => {
  const { to_user_id, badge_type, note } = req.body;
  if (!to_user_id || !badge_type) throw new AppError(400, 'INVALID', 'to_user_id and badge_type required');

  const validBadges = ['star', 'excellent', 'good_work', 'outstanding', 'fast_worker', 'top_closer', 'best_followup'];
  if (!validBadges.includes(badge_type)) throw new AppError(400, 'INVALID', 'Invalid badge type');

  const { rows: [target] } = await query(`SELECT id, full_name FROM users WHERE id = $1 AND deleted_at IS NULL`, [to_user_id]);
  if (!target) throw new AppError(404, 'NOT_FOUND', 'User not found');

  const { rows: [a] } = await query(`
    INSERT INTO appreciations (from_user_id, to_user_id, badge_type, note)
    VALUES ($1, $2, $3, $4) RETURNING *
  `, [req.user.id, to_user_id, badge_type, note || null]);

  await notifyUser(to_user_id, 'appreciation', `${BADGE_MAP[badge_type] || '⭐'} ${req.user.name} gave you "${badge_type.replace(/_/g, ' ')}"`,
    note || 'Great work! Keep it up.', { badge_type, from_user_id: req.user.id });

  res.json({ success: true, data: a });
}));

router.get('/appreciations/:userId', authenticate, asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT a.*, fu.full_name AS from_name
    FROM appreciations a JOIN users fu ON fu.id = a.from_user_id
    WHERE a.to_user_id = $1
    ORDER BY a.created_at DESC LIMIT 50
  `, [req.params.userId]);

  const { rows: summary } = await query(`
    SELECT badge_type, COUNT(*) AS count FROM appreciations WHERE to_user_id = $1 GROUP BY badge_type
  `, [req.params.userId]);

  res.json({ success: true, data: { appreciations: rows, summary } });
}));

// GET /rankings/user-badge/:userId — compact badge info for displaying beside name
router.get('/rankings/user-badge/:userId', authenticate, asyncHandler(async (req, res) => {
  const { rows: [rank] } = await query(`
    SELECT rank_position, score, movement, scope FROM daily_rankings
    WHERE user_id = $1 AND scope = 'overall' AND rank_date = CURRENT_DATE
  `, [req.params.userId]);

  const { rows: badges } = await query(`
    SELECT badge_type, COUNT(*) AS count FROM appreciations
    WHERE to_user_id = $1 AND created_at > NOW() - INTERVAL '30 days'
    GROUP BY badge_type ORDER BY count DESC LIMIT 3
  `, [req.params.userId]);

  const label = rank ? RANK_LABELS[rank.rank_position - 1] || null : null;

  res.json({ success: true, data: { rank: rank || null, label, badges, badge_map: BADGE_MAP } });
}));

// ══════════════════════════════════════════════════════════════════════
// RM MONITORING — read-only team activity & request visibility layer
// ══════════════════════════════════════════════════════════════════════

// Live counters for RM dashboard
router.get('/rm-monitoring/live-counters', authenticate, requireRole('rm', 'super_admin'), asyncHandler(async (req, res) => {
  const rmId = req.user.role === 'rm' ? req.user.id : req.query.rm_id;
  if (!rmId) throw new AppError(400, 'INVALID', 'rm_id required for admin view');

  const { rows: [c] } = await query(`
    WITH rm_people AS (
      SELECT id
      FROM users
      WHERE deleted_at IS NULL
        AND (
          report_to_id = $1
          OR id IN (
            SELECT partner_id
            FROM partner_lead_requests
            WHERE assigned_rm_id = $1
          )
        )
    )
    SELECT
      (
        SELECT COUNT(*)
        FROM lead_requests lr
        JOIN users u2 ON u2.id = lr.user_id AND u2.report_to_id = $1
        WHERE (lr.created_at AT TIME ZONE 'Asia/Kolkata')::date =
              (NOW() AT TIME ZONE 'Asia/Kolkata')::date
      )
      +
      (
        SELECT COUNT(*)
        FROM partner_lead_requests pr
        WHERE pr.assigned_rm_id = $1
          AND (pr.created_at AT TIME ZONE 'Asia/Kolkata')::date =
              (NOW() AT TIME ZONE 'Asia/Kolkata')::date
      ) AS requests_today,

      (
        SELECT COUNT(*)
        FROM lead_requests lr
        JOIN users u2 ON u2.id = lr.user_id AND u2.report_to_id = $1
        WHERE lr.status = 'pending'
      )
      +
      (
        SELECT COUNT(*)
        FROM partner_lead_requests pr
        WHERE pr.assigned_rm_id = $1
          AND pr.status IN ('pending','approved','assigned')
      ) AS requests_pending,

      (
        SELECT COUNT(*)
        FROM leads l2
        WHERE l2.assigned_to_user_id IN (SELECT id FROM rm_people)
          AND (l2.assigned_at AT TIME ZONE 'Asia/Kolkata')::date =
              (NOW() AT TIME ZONE 'Asia/Kolkata')::date
          AND l2.deleted_at IS NULL
      ) AS leads_distributed_today,

      (
        SELECT COUNT(*)
        FROM leads l2
        WHERE l2.assigned_to_user_id IN (SELECT id FROM rm_people)
          AND l2.deleted_at IS NULL
      ) AS leads_total,

      (
        SELECT COUNT(*)
        FROM users
        WHERE report_to_id = $1
          AND deleted_at IS NULL
          AND role = 'member'
      ) AS team_size,

      (
        SELECT COUNT(*)
        FROM users
        WHERE report_to_id = $1
          AND deleted_at IS NULL
          AND role = 'member'
          AND status = 'active'
          AND is_available = TRUE
          AND COALESCE(distribution_blocked, FALSE) = FALSE
      ) AS active_today,

      (
        SELECT COUNT(DISTINCT l2.assigned_to_user_id)
        FROM leads l2
        WHERE l2.assigned_to_user_id IN (SELECT id FROM rm_people)
          AND l2.is_pending = TRUE
          AND l2.deleted_at IS NULL
      ) AS pending_work_users,

      (
        SELECT COUNT(DISTINCT lr.user_id)
        FROM lead_requests lr
        JOIN users u2 ON u2.id = lr.user_id AND u2.report_to_id = $1
        WHERE lr.status = 'pending'
      )
      +
      (
        SELECT COUNT(DISTINCT pr.partner_id)
        FROM partner_lead_requests pr
        WHERE pr.assigned_rm_id = $1
          AND pr.status IN ('pending','approved','assigned')
      ) AS members_waiting,

      (
        SELECT COUNT(*)
        FROM leads l2
        WHERE l2.assigned_to_user_id IN (SELECT id FROM rm_people)
          AND l2.call_status = 'converted'
          AND (l2.updated_at AT TIME ZONE 'Asia/Kolkata')::date =
              (NOW() AT TIME ZONE 'Asia/Kolkata')::date
          AND l2.deleted_at IS NULL
      ) AS conversions_today
  `, [rmId]);

  const { rows: [topActive] } = await query(`
    SELECT u.id, u.full_name, COUNT(*)::int AS activity
    FROM lead_remarks r JOIN users u ON u.id = r.user_id AND u.report_to_id = $1
    WHERE (r.created_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date AND u.deleted_at IS NULL
    GROUP BY u.id, u.full_name ORDER BY activity DESC LIMIT 1
  `, [rmId]);

  const { rows: [topConverter] } = await query(`
    SELECT u.id, u.full_name, COUNT(*)::int AS conversions
    FROM leads l JOIN users u ON u.id = l.assigned_to_user_id AND u.report_to_id = $1
    WHERE l.call_status = 'converted' AND l.deleted_at IS NULL AND u.deleted_at IS NULL
    GROUP BY u.id, u.full_name ORDER BY conversions DESC LIMIT 1
  `, [rmId]);

  const data = {};
  for (const [k, v] of Object.entries(c)) data[k] = parseInt(v, 10) || 0;
  data.top_active_member = topActive || null;
  data.top_conversion_member = topConverter || null;

  res.json({ success: true, data });
}));

// Per-member comprehensive overview for monitoring
router.get('/rm-monitoring/team-overview', authenticate, requireRole('rm', 'super_admin'), asyncHandler(async (req, res) => {
  const rmId = req.user.role === 'rm' ? req.user.id : req.query.rm_id;
  if (!rmId) throw new AppError(400, 'INVALID', 'rm_id required');

  const { rows } = await query(`
    SELECT
      u.id, u.full_name, u.email, u.role, u.member_type, u.team_name,
      u.is_available, u.status,
      COALESCE(lc.total, 0)::int AS leads_received_total,
      COALESCE(lc.today_count, 0)::int AS leads_received_today,
      COALESCE(lc.pending, 0)::int AS leads_pending,
      COALESCE(lc.worked, 0)::int AS leads_worked,
      COALESCE(lc.converted, 0)::int AS leads_converted,
      (COALESCE(lc.total, 0) - COALESCE(lc.worked, 0))::int AS leads_remaining,
      CASE WHEN COALESCE(lc.total, 0) > 0
        THEN ROUND(COALESCE(lc.converted, 0)::numeric / lc.total * 100, 1)
        ELSE 0 END AS conv_rate,
      COALESCE(rq.total_req, 0)::int AS requests_total,
      COALESCE(rq.today_req, 0)::int AS requests_today,
      COALESCE(rq.pending_req, 0)::int AS requests_pending,
      lact.last_remark_at,
      COALESCE(lact.remarks_today, 0)::int AS remarks_today,
      CASE WHEN COALESCE(lact.remarks_today, 0) > 0
                OR COALESCE(lc.today_count, 0) > 0 THEN true ELSE false END AS is_active_today
    FROM users u
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE l.assigned_at::date = CURRENT_DATE) AS today_count,
             COUNT(*) FILTER (WHERE l.is_pending = TRUE) AS pending,
             COUNT(*) FILTER (WHERE l.call_status <> 'not_called') AS worked,
             COUNT(*) FILTER (WHERE l.call_status = 'converted') AS converted
      FROM leads l WHERE l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
    ) lc ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS total_req,
             COUNT(*) FILTER (WHERE (lr.created_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_req,
             COUNT(*) FILTER (WHERE lr.status = 'pending') AS pending_req
      FROM lead_requests lr WHERE lr.user_id = u.id
    ) rq ON true
    LEFT JOIN LATERAL (
      SELECT MAX(r.created_at) AS last_remark_at,
             COUNT(*) FILTER (WHERE (r.created_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS remarks_today
      FROM lead_remarks r WHERE r.user_id = u.id
    ) lact ON true
    WHERE u.report_to_id = $1 AND u.deleted_at IS NULL AND u.role = 'member'
    ORDER BY lc.converted DESC NULLS LAST, lc.worked DESC NULLS LAST, u.full_name
  `, [rmId]);

  res.json({ success: true, data: rows });
}));

// Enhanced member/partner requests with lead stats
router.get('/rm-monitoring/member-requests', authenticate, requireRole('rm', 'super_admin'), asyncHandler(async (req, res) => {
  const rmId = req.user.role === 'rm' ? req.user.id : req.query.rm_id;
  if (!rmId) throw new AppError(400, 'INVALID', 'rm_id required');
  const category = req.query.category;

  const params1 = [rmId];
  let catFilter1 = '';
  if (category && ['partner', 'trader'].includes(category)) {
    params1.push(category);
    catFilter1 = ` AND lr.category = $${params1.length}`;
  }

  const { rows: memberReqs } = await query(`
    SELECT 'member' AS request_source,
           lr.id, lr.user_id, lr.quantity, lr.category, lr.status,
           COALESCE(lr.leads_assigned, 0)::int AS leads_assigned,
           lr.note, lr.created_at, lr.updated_at,
           u.full_name, u.email, u.member_type, u.team_name, u.role,
           (SELECT COUNT(*)::int FROM leads l WHERE l.assigned_to_user_id = u.id AND l.deleted_at IS NULL) AS member_leads_total,
           (SELECT COUNT(*)::int FROM leads l WHERE l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
              AND l.assigned_at::date = CURRENT_DATE) AS member_leads_today,
           (SELECT COUNT(*)::int FROM leads l WHERE l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
              AND l.is_pending = TRUE) AS member_leads_pending,
           (SELECT COUNT(*)::int FROM leads l WHERE l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
              AND l.call_status <> 'not_called') AS member_leads_worked,
           (SELECT COUNT(*)::int FROM leads l WHERE l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
              AND l.call_status = 'converted') AS member_leads_converted
    FROM lead_requests lr
    JOIN users u ON u.id = lr.user_id AND u.report_to_id = $1 AND u.deleted_at IS NULL
    WHERE 1=1 ${catFilter1}
    ORDER BY lr.created_at DESC LIMIT 30
  `, params1);

  const params2 = [rmId];
  let catFilter2 = '';
  if (category && ['partner', 'trader'].includes(category)) {
    params2.push(category);
    catFilter2 = ` AND pr.category = $${params2.length}`;
  }

  const { rows: partnerReqs } = await query(`
    SELECT 'partner' AS request_source,
           pr.id, pr.partner_id AS user_id, pr.quantity, pr.category, pr.status,
           COALESCE(pr.leads_assigned, 0)::int AS leads_assigned,
           pr.note, pr.created_at, pr.updated_at,
           u.full_name, u.email, u.member_type, u.team_name, u.role,
           (SELECT COUNT(*)::int FROM leads l WHERE l.assigned_to_user_id = u.id AND l.deleted_at IS NULL) AS member_leads_total,
           (SELECT COUNT(*)::int FROM leads l WHERE l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
              AND l.assigned_at::date = CURRENT_DATE) AS member_leads_today,
           (SELECT COUNT(*)::int FROM leads l WHERE l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
              AND l.is_pending = TRUE) AS member_leads_pending,
           (SELECT COUNT(*)::int FROM leads l WHERE l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
              AND l.call_status <> 'not_called') AS member_leads_worked,
           (SELECT COUNT(*)::int FROM leads l WHERE l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
              AND l.call_status = 'converted') AS member_leads_converted
    FROM partner_lead_requests pr
    JOIN users u ON u.id = pr.partner_id AND u.deleted_at IS NULL
      AND (u.report_to_id = $1 OR pr.assigned_rm_id = $1)
    WHERE 1=1 ${catFilter2}
    ORDER BY pr.created_at DESC LIMIT 30
  `, params2);

  const all = [...memberReqs, ...partnerReqs]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 50);

  res.json({ success: true, data: all });
}));

// ═══════════════════════════════════════════════════════════════════
// ADMIN ENTERPRISE CONTROL CENTER ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// ── Campaign Management (CRUD) ───────────────────────────────────
router.get('/admin/campaigns', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT mc.*,
      mc.campaign_id AS meta_campaign_id,
      mc.category AS lead_category,
      CASE mc.category WHEN 'trader' THEN 'Trader Lead' WHEN 'partner' THEN 'Partner Lead' ELSE 'Unknown' END AS lead_category_label,
      category_user.full_name AS category_updated_by_name,
      (SELECT COUNT(*)::int FROM leads l WHERE l.meta_campaign_id = mc.campaign_id AND l.deleted_at IS NULL) AS total_leads,
      (SELECT COUNT(*)::int FROM leads l WHERE l.meta_campaign_id = mc.campaign_id AND l.deleted_at IS NULL
        AND (COALESCE(l.meta_created_time, l.created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_leads,
      (SELECT COUNT(*)::int FROM leads l WHERE l.meta_campaign_id = mc.campaign_id AND l.deleted_at IS NULL
        AND l.call_status = 'converted') AS conversions,
      (SELECT COUNT(*)::int FROM leads l WHERE l.meta_campaign_id = mc.campaign_id AND l.deleted_at IS NULL
        AND l.is_pending = TRUE) AS pending_leads
    FROM meta_campaigns mc
    LEFT JOIN users category_user ON category_user.id = mc.category_updated_by_user_id
    ORDER BY mc.created_at DESC
  `);
  res.json({ success: true, data: rows });
}));

router.post('/admin/campaigns', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { campaign_name, internal_label, category, ad_account_id } = req.body;
  if (!campaign_name) throw new AppError(400, 'INVALID', 'campaign_name is required');
  const campaignId = 'manual_' + Date.now();
  const { rows: [c] } = await query(
    `INSERT INTO meta_campaigns (campaign_id, campaign_name, internal_label, category, ad_account_id, is_active, created_at)
     VALUES ($1, $2, $3, $4, $5, true, NOW()) RETURNING *`,
    [campaignId, campaign_name, internal_label || null, category || null, ad_account_id || null]
  );
  {
    const { logActivity } = require('../utils/auditLog');
    await logActivity(req, {
      entity: 'campaign', entity_id: c.id, action: 'created',
      new_value: campaign_name,
      metadata: { campaign_id: campaignId, internal_label, category, ad_account_id },
    });
  }
  res.status(201).json({ success: true, data: c });
}));

router.patch('/admin/campaigns/:id', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { campaign_name, internal_label, is_active, category } = req.body;
  // Capture before-state for the audit diff.
  const { rows: [prev] } = await query(`SELECT campaign_name, is_active FROM meta_campaigns WHERE id = $1`, [id]);
  const sets = []; const vals = []; let idx = 0;
  if (campaign_name !== undefined) { sets.push(`campaign_name = $${++idx}`); vals.push(campaign_name); }
  if (internal_label !== undefined) { sets.push(`internal_label = $${++idx}`); vals.push(internal_label); }
  if (is_active !== undefined) { sets.push(`is_active = $${++idx}`); vals.push(is_active); }
  if (category !== undefined) { sets.push(`category = $${++idx}`); vals.push(category); }
  if (sets.length === 0) throw new AppError(400, 'INVALID', 'Nothing to update');
  vals.push(id);
  const { rows: [c] } = await query(
    `UPDATE meta_campaigns SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals
  );
  if (!c) throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
  // Was this specifically a pause/resume? Surface as a distinct action.
  let action = 'updated';
  if (typeof is_active === 'boolean' && prev && prev.is_active !== is_active) {
    action = is_active ? 'resumed' : 'paused';
  }
  {
    const { logActivity } = require('../utils/auditLog');
    await logActivity(req, {
      entity: 'campaign', entity_id: id, action,
      old_value: prev?.campaign_name || null,
      new_value: c.campaign_name,
      metadata: { changed: req.body },
    });
  }
  res.json({ success: true, data: c });
}));

router.delete('/admin/campaigns/:id', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { rows: [prev] } = await query(`SELECT campaign_name FROM meta_campaigns WHERE id = $1`, [req.params.id]);
  const { rowCount } = await query(`DELETE FROM meta_campaigns WHERE id = $1`, [req.params.id]);
  if (rowCount === 0) throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
  {
    const { logActivity } = require('../utils/auditLog');
    await logActivity(req, {
      entity: 'campaign', entity_id: req.params.id, action: 'deleted',
      old_value: prev?.campaign_name || req.params.id,
      metadata: {},
    });
  }
  res.json({ success: true, data: { message: 'Campaign deleted' } });
}));

// ── Lead Sources Analytics ───────────────────────────────────────
router.get('/admin/lead-sources', authenticate, requireRole('super_admin'), responseCache(10000), asyncHandler(async (req, res) => {
  const { rows: sources } = await query(`
    SELECT l.source,
      COUNT(*)::int AS total_leads,
      COUNT(*) FILTER (WHERE (COALESCE(l.meta_created_time, l.created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date)::int AS today_leads,
      COUNT(*) FILTER (WHERE l.call_status = 'converted')::int AS conversions,
      COUNT(*) FILTER (WHERE l.is_pending = TRUE)::int AS pending,
      COUNT(*) FILTER (WHERE l.stage = 'won')::int AS won,
      ROUND(COUNT(*) FILTER (WHERE l.call_status = 'converted')::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS conv_rate,
      MAX(l.created_at) AS last_lead_at
    FROM leads l WHERE l.deleted_at IS NULL
    GROUP BY l.source ORDER BY total_leads DESC
  `);

  const { rows: campaigns } = await query(`
    SELECT COALESCE(l.campaign_name, mc.campaign_name, 'Unknown') AS campaign,
      l.source,
      COUNT(*)::int AS total_leads,
      COUNT(*) FILTER (WHERE (COALESCE(l.meta_created_time, l.created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date)::int AS today_leads,
      COUNT(*) FILTER (WHERE l.call_status = 'converted')::int AS conversions,
      ROUND(COUNT(*) FILTER (WHERE l.call_status = 'converted')::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS conv_rate
    FROM leads l
    LEFT JOIN meta_campaigns mc ON mc.campaign_id = l.meta_campaign_id
    WHERE l.deleted_at IS NULL
    GROUP BY campaign, l.source ORDER BY total_leads DESC LIMIT 50
  `);

  const { rows: daily } = await query(`
    SELECT l.created_at::date AS day, l.source, COUNT(*)::int AS count
    FROM leads l WHERE l.deleted_at IS NULL AND l.created_at >= CURRENT_DATE - INTERVAL '14 days'
    GROUP BY l.created_at::date, l.source ORDER BY day
  `);

  res.json({ success: true, data: { sources, campaigns, daily } });
}));

// ── Google Sheets Control ────────────────────────────────────────
router.get('/admin/sheets/config', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const config = await sheetsResolveConfigStatus();
  let syncLog = [];
  try {
    const { rows } = await query(`SELECT * FROM activity_logs WHERE entity = 'sheets' ORDER BY created_at DESC LIMIT 20`);
    syncLog = rows;
  } catch { /* table may not have sheets entries */ }
  res.json({ success: true, data: { config, sync_logs: syncLog } });
}));

router.post('/admin/sheets/trigger-sync', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  await query(`INSERT INTO activity_logs(user_id, user_name, user_role, entity, entity_id, action, metadata, ip_address)
    VALUES($1,$2,$3,'sheets','manual','sync_triggered',$4,$5)`,
    [req.user.id, req.user.full_name, req.user.role, '{}', req.ip]);
  try {
    const sheetSync = require('../services/googleSheetsService');
    const r = await sheetSync.syncAllLeads();
    res.json({ success: true, data: { message: 'Sync completed', synced: r.synced || 0 } });
  } catch (err) {
    res.status(502).json({ success: false, error: { code: 'SHEETS_SYNC_FAILED', message: err.message } });
  }
}));

// ══════════════════════════════════════════════════════════════════════
// DYNAMIC SHEETS INTEGRATION — admin-managed credentials + sheet configs
// ══════════════════════════════════════════════════════════════════════
const multer = require('multer');
const sheetsSvc = require('../services/googleSheetsService');
const googleUserOAuth = require('../services/googleUserOAuthService');
const userGoogleSheets = require('../services/userGoogleSheetsService');
const secretsCrypto = require('../utils/secretsCrypto');

// Memory storage — the JSON never touches disk. Max 64KB (service-account JSONs are ~2KB).
const credsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    // Accept .json by mimetype or by extension (some browsers send application/octet-stream)
    const ok = /json/i.test(file.mimetype) || /\.json$/i.test(file.originalname);
    cb(ok ? null : new AppError(400, 'BAD_FILE', 'Only .json files allowed'), ok);
  },
});

function parseCreds(input) {
  if (!input) throw new AppError(400, 'INVALID', 'credentials_json is required');
  let creds;
  try {
    creds = typeof input === 'string' ? JSON.parse(input) : input;
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'credentials_json is not valid JSON');
  }
  if (!secretsCrypto.isGoogleServiceAccount(creds)) {
    throw new AppError(400, 'INVALID_CREDS', 'Not a valid Google service-account JSON (missing type / client_email / private_key)');
  }
  return creds;
}

function publicConfigRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    purpose: row.purpose || null,        // 'traders' | 'partners' | null
    is_active: row.is_active,
    sheet_id: row.config?.sheet_id || null,
    sheet_name: row.config?.sheet_name || 'Leads',
    default_sheet_name: row.config?.default_sheet_name || row.config?.sheet_name || 'Leads',
    trader_sheet_name: row.config?.trader_sheet_name || null,
    partner_sheet_name: row.config?.partner_sheet_name || null,
    unknown_sheet_name: row.config?.unknown_sheet_name || null,
    auto_create_missing_sheets: row.config?.auto_create_missing_sheets !== false,
    category_sheet_routing_enabled: row.config?.category_sheet_routing_enabled !== false,
    service_account_email: row.config?.service_account_email || null,
    has_credentials: !!row.secrets_encrypted,
    last_tested_at: row.last_tested_at,
    last_test_ok: row.last_test_ok,
    last_test_error: row.last_test_error,
    last_synced_at: row.last_synced_at,
    last_sync_count: row.last_sync_count,
    auto_import_enabled: !!row.auto_import_enabled,
    auto_import_minutes: row.auto_import_minutes || 5,
    last_import_at: row.last_import_at || null,
    last_import_stats: row.last_import_stats || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Normalise a body field into the strict 'traders' | 'partners' | null.
function normPurpose(v) {
  if (!v) return null;
  const s = String(v).toLowerCase().trim();
  if (s === 'traders' || s === 'trader')   return 'traders';
  if (s === 'partners' || s === 'partner') return 'partners';
  return null;
}

// List all stored sheet configs
router.get('/admin/sheets/configs', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const { rows } = await query(`SELECT * FROM integration_configs WHERE kind = 'google_sheets' ORDER BY is_active DESC, updated_at DESC`);
  res.json({ success: true, data: rows.map(publicConfigRow) });
}));

// Create a new sheet config — accepts either:
//   multipart/form-data with `credentials_file` (.json) + form fields, OR
//   application/json body with credentials_json (object or string) + fields
router.post('/admin/sheets/configs', authenticate, requireRole('super_admin'),
  credsUpload.single('credentials_file'),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const rawJson = req.file ? req.file.buffer.toString('utf8') : (body.credentials_json || null);
    const creds = parseCreds(rawJson);
    const sheetId = (body.sheet_id || '').trim();
    if (!sheetId) throw new AppError(400, 'INVALID', 'sheet_id is required');
    const purpose = normPurpose(body.purpose);
    const label = (body.label || `${purpose ? purpose[0].toUpperCase() + purpose.slice(1) + ' · ' : ''}Sheet ${sheetId.slice(0, 8)}`).trim();
    const sheetName = (body.sheet_name || 'Leads').trim();
    const makeActive = body.make_active === 'true' || body.make_active === true;

    const config = {
      sheet_id: sheetId,
      sheet_name: sheetName,
      service_account_email: creds.client_email,
      project_id: creds.project_id || null,
    };
    const secretsEnc = secretsCrypto.encrypt(creds);

    const { rows: [r] } = await query(
      `INSERT INTO integration_configs(kind, label, purpose, config, secrets_encrypted, is_active, created_by_user_id)
         VALUES ('google_sheets', $1, $2, $3, $4, FALSE, $5)
         RETURNING *`,
      [label, purpose, JSON.stringify(config), secretsEnc, req.user.id],
    );

    if (makeActive) {
      // Deactivate ONLY other configs sharing this purpose (or sharing the
      // 'no-purpose' bucket). Traders and Partners stay independently active.
      await query(
        `UPDATE integration_configs SET is_active = FALSE
          WHERE kind = 'google_sheets' AND COALESCE(purpose, '') = COALESCE($1, '') AND id <> $2`,
        [purpose, r.id],
      );
      await query(`UPDATE integration_configs SET is_active = TRUE WHERE id = $1`, [r.id]);
      sheetsSvc.reloadActiveConfig();
    }

    const { rows: [final] } = await query(`SELECT * FROM integration_configs WHERE id = $1`, [r.id]);
    res.json({ success: true, data: publicConfigRow(final) });
  }),
);

// Update sheet_id / sheet_name / label (and optionally replace the credentials)
router.patch('/admin/sheets/configs/:id', authenticate, requireRole('super_admin'),
  credsUpload.single('credentials_file'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { rows: [existing] } = await query(`SELECT * FROM integration_configs WHERE id = $1 AND kind = 'google_sheets'`, [id]);
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Config not found');

    const body = req.body || {};
    const newConfig = { ...(existing.config || {}) };
    if (body.sheet_id   !== undefined) newConfig.sheet_id   = String(body.sheet_id).trim();
    if (body.sheet_name !== undefined) newConfig.sheet_name = String(body.sheet_name).trim() || 'Leads';

    let secretsEnc = existing.secrets_encrypted;
    const rawJson = req.file ? req.file.buffer.toString('utf8') : body.credentials_json;
    if (rawJson) {
      const creds = parseCreds(rawJson);
      secretsEnc = secretsCrypto.encrypt(creds);
      newConfig.service_account_email = creds.client_email;
      newConfig.project_id = creds.project_id || null;
    }

    const label = body.label !== undefined ? String(body.label).trim() : existing.label;
    const purpose = body.purpose !== undefined ? normPurpose(body.purpose) : existing.purpose;

    await query(
      `UPDATE integration_configs
          SET label = $1, config = $2, secrets_encrypted = $3, purpose = $4, updated_at = NOW()
        WHERE id = $5`,
      [label, JSON.stringify(newConfig), secretsEnc, purpose, id],
    );
    if (existing.is_active) sheetsSvc.reloadActiveConfig();
    const { rows: [final] } = await query(`SELECT * FROM integration_configs WHERE id = $1`, [id]);
    res.json({ success: true, data: publicConfigRow(final) });
  }),
);

// Activate a config — scoped per purpose. Activating a Traders sheet does
// NOT deactivate the Partners sheet, and vice versa.
router.post('/admin/sheets/configs/:id/activate', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: [existing] } = await query(`SELECT id, purpose FROM integration_configs WHERE id = $1 AND kind = 'google_sheets'`, [id]);
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Config not found');

  await query(
    `UPDATE integration_configs SET is_active = FALSE
      WHERE kind = 'google_sheets' AND COALESCE(purpose, '') = COALESCE($1, '') AND id <> $2`,
    [existing.purpose, id],
  );
  await query(`UPDATE integration_configs SET is_active = TRUE WHERE id = $1`, [id]);
  sheetsSvc.reloadActiveConfig();

  const { rows: [final] } = await query(`SELECT * FROM integration_configs WHERE id = $1`, [id]);
  res.json({ success: true, data: publicConfigRow(final) });
}));

// Test a config (live Google API call, persists last_test_* on the row)
router.post('/admin/sheets/configs/:id/test', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: [row] } = await query(`SELECT * FROM integration_configs WHERE id = $1 AND kind = 'google_sheets'`, [id]);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Config not found');
  if (!row.secrets_encrypted) throw new AppError(400, 'NO_CREDS', 'No credentials stored on this config');

  const creds = secretsCrypto.decrypt(row.secrets_encrypted);
  const result = await sheetsSvc.testCredentials({
    creds,
    sheetId:   row.config?.sheet_id,
    sheetName: row.config?.sheet_name || 'Leads',
  });

  await query(
    `UPDATE integration_configs SET last_tested_at = NOW(), last_test_ok = $1, last_test_error = $2 WHERE id = $3`,
    [!!result.ok, result.ok ? null : (result.error || 'unknown error'), id],
  );

  res.json({ success: result.ok, data: result, error: result.ok ? null : { code: 'TEST_FAILED', message: result.error } });
}));

// Manual sync from a specific config (must be the active one for now)
router.post('/admin/sheets/configs/:id/sync-now', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: [row] } = await query(`SELECT id, is_active, label FROM integration_configs WHERE id = $1 AND kind = 'google_sheets'`, [id]);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Config not found');
  if (!row.is_active) throw new AppError(409, 'NOT_ACTIVE', 'Activate this config first, then sync.');
  const { logActivity } = require('../utils/auditLog');
  try {
    const r = await sheetsSvc.syncAllLeads();
    await logActivity(req, {
      entity: 'sheet_sync', entity_id: id, action: 'manual_sync_completed',
      new_value: `${r.synced || 0} rows synced`,
      metadata: { config_label: row.label, synced: r.synced || 0 },
    });
    res.json({ success: true, data: { synced: r.synced || 0 } });
  } catch (err) {
    await logActivity(req, {
      entity: 'sheet_sync', entity_id: id, action: 'manual_sync_failed',
      metadata: { config_label: row.label, error: err.message },
    });
    res.status(502).json({ success: false, error: { code: 'SHEETS_SYNC_FAILED', message: err.message } });
  }
}));

// Preview last N rows of an active sheet (optionally per purpose)
router.get('/admin/sheets/preview', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  const purpose = normPurpose(req.query.purpose);
  try {
    const data = await sheetsSvc.previewRows(limit, purpose);
    res.json({ success: true, data });
  } catch (err) {
    res.status(502).json({ success: false, error: { code: 'SHEETS_PREVIEW_FAILED', message: err.message } });
  }
}));

/**
 * Fresh-leads feed for the Admin Fresh Leads tab.
 *
 * Query params:
 *   - scope=today|trader|partner|all  (default = today)
 *   - limit (default 100, max 500)
 *
 * Returns:
 *   - counts: { today_total, today_trader, today_partner, trader_total, partner_total, total_active }
 *   - rows: paginated list filtered to the requested scope, newest first
 *   - sheet_links: { traders: <url>|null, partners: <url>|null } — quick "Open Sheet" buttons
 */
router.get('/admin/leads/fresh', authenticate, requireRole('super_admin', 'rm'), asyncHandler(async (req, res) => {
  const scope = ['today', 'trader', 'partner', 'all'].includes(req.query.scope) ? req.query.scope : 'today';
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));

  // RM must only see their own team's leads; super_admin sees everything.
  const { getVisibleUserIds } = require('../middleware/rbac');
  const visible = await getVisibleUserIds(req.user);
  let scopeSqlAgg = '';
  let scopeSqlRow = '';
  const aggParams = [];
  const rowParams = [limit];
  if (visible !== null) {
    if (visible.length === 0) {
      return res.json({ success: true, data: { scope, counts: { today_total: 0, today_trader: 0, today_partner: 0, trader_total: 0, partner_total: 0, unassigned: 0, assigned: 0, total_active: 0 }, rows: [], sheet_links: { traders: null, partners: null } } });
    }
    aggParams.push(visible);
    scopeSqlAgg = ` AND assigned_to_user_id = ANY($${aggParams.length}::uuid[])`;
    rowParams.push(visible);
    scopeSqlRow = ` AND l.assigned_to_user_id = ANY($${rowParams.length}::uuid[])`;
  }

  // "Today" is the calendar day in IST regardless of the DB's session timezone.
  // We compare created_at::date AT IST against now()::date AT IST so the answer
  // is identical whether prod's PostgreSQL is set to UTC or Asia/Kolkata.
  // "Today" for leads = Meta-side created_time when available, DB created_at fallback.
  // Stops backfilled historic Meta leads from polluting the Today tile.
  const TODAY_IST = `(COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date`;
  const L_TODAY_IST = `(COALESCE(l.meta_created_time, l.created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date`;

  const { rows: [c] } = await query(`
    SELECT
      COUNT(*) FILTER (WHERE ${TODAY_IST})                                                                AS today_total,
      COUNT(*) FILTER (WHERE ${TODAY_IST} AND category = 'trader')                                        AS today_trader,
      COUNT(*) FILTER (WHERE ${TODAY_IST} AND category = 'partner')                                       AS today_partner,
      COUNT(*) FILTER (WHERE category = 'trader')                                                         AS trader_total,
      COUNT(*) FILTER (WHERE category = 'partner')                                                        AS partner_total,
      COUNT(*) FILTER (WHERE assigned_to_user_id IS NULL)                                                 AS unassigned,
      COUNT(*) FILTER (WHERE assigned_to_user_id IS NOT NULL)                                             AS assigned,
      COUNT(*)                                                                                            AS total_active
      FROM leads WHERE deleted_at IS NULL${scopeSqlAgg}
  `, aggParams);

  // Build WHERE for the requested scope
  let where = `l.deleted_at IS NULL${scopeSqlRow}`;
  if (scope === 'today')        where += ` AND ${L_TODAY_IST}`;
  else if (scope === 'trader')  where += ` AND l.category = 'trader' AND ${L_TODAY_IST}`;
  else if (scope === 'partner') where += ` AND l.category = 'partner' AND ${L_TODAY_IST}`;
  // scope=all → no extra filter

  const { rows } = await query(`
    SELECT l.id, l.full_name, l.phone, l.email, l.city, l.state,
           l.category, l.source, l.stage, l.call_status,
           l.campaign_name, l.adset_name, l.ad_name, l.campaign_label, l.product_tag,
           l.meta_form_id, l.meta_campaign_id,
           l.assigned_to_user_id, u.full_name AS assigned_to_name, u.role AS assigned_to_role,
           l.created_at, l.assigned_at
      FROM leads l
      LEFT JOIN users u ON u.id = l.assigned_to_user_id
     WHERE ${where}
     ORDER BY l.created_at DESC
     LIMIT $1
  `, rowParams);

  // Sheet links — let the admin jump straight to the source Google Sheet
  const { rows: cfgs } = await query(
    `SELECT purpose, config->>'sheet_id' AS sheet_id
       FROM integration_configs
      WHERE kind = 'google_sheets' AND is_active = TRUE AND config->>'sheet_id' IS NOT NULL`,
  );
  const sheet_links = { traders: null, partners: null };
  for (const r of cfgs) {
    const url = r.sheet_id ? `https://docs.google.com/spreadsheets/d/${r.sheet_id}` : null;
    if (r.purpose === 'traders')  sheet_links.traders  = url;
    if (r.purpose === 'partners') sheet_links.partners = url;
    if (!r.purpose && !sheet_links.traders) sheet_links.traders = url; // legacy un-tagged → treat as traders
  }

  res.json({
    success: true,
    data: {
      scope,
      counts: {
        today_total:   Number(c.today_total),
        today_trader:  Number(c.today_trader),
        today_partner: Number(c.today_partner),
        trader_total:  Number(c.trader_total),
        partner_total: Number(c.partner_total),
        unassigned:    Number(c.unassigned),
        assigned:      Number(c.assigned),
        total_active:  Number(c.total_active),
      },
      rows,
      sheet_links,
    },
  });
}));

// Per-purpose lead stats — drives the Traders / Partners stat cards
router.get('/admin/sheets/stats', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const { rows: [s] } = await query(`
    SELECT
      COUNT(*) FILTER (WHERE category = 'trader')                              AS trader_total,
      COUNT(*) FILTER (WHERE category = 'trader' AND assigned_to_user_id IS NULL) AS trader_unassigned,
      COUNT(*) FILTER (WHERE category = 'trader' AND assigned_to_user_id IS NOT NULL) AS trader_assigned,
      COUNT(*) FILTER (WHERE category = 'trader' AND call_status = 'converted') AS trader_converted,
      COUNT(*) FILTER (WHERE category = 'trader' AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS trader_today,
      COUNT(*) FILTER (WHERE category = 'partner')                              AS partner_total,
      COUNT(*) FILTER (WHERE category = 'partner' AND assigned_to_user_id IS NULL) AS partner_unassigned,
      COUNT(*) FILTER (WHERE category = 'partner' AND assigned_to_user_id IS NOT NULL) AS partner_assigned,
      COUNT(*) FILTER (WHERE category = 'partner' AND call_status = 'converted') AS partner_converted,
      COUNT(*) FILTER (WHERE category = 'partner' AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS partner_today
      FROM leads WHERE deleted_at IS NULL
  `);
  res.json({
    success: true,
    data: {
      traders: {
        total: Number(s.trader_total), unassigned: Number(s.trader_unassigned),
        assigned: Number(s.trader_assigned), converted: Number(s.trader_converted),
        today: Number(s.trader_today),
      },
      partners: {
        total: Number(s.partner_total), unassigned: Number(s.partner_unassigned),
        assigned: Number(s.partner_assigned), converted: Number(s.partner_converted),
        today: Number(s.partner_today),
      },
    },
  });
}));

// Delete a config
router.delete('/admin/sheets/configs/:id', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: [existing] } = await query(`SELECT is_active FROM integration_configs WHERE id = $1 AND kind = 'google_sheets'`, [id]);
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Config not found');
  await query(`DELETE FROM integration_configs WHERE id = $1`, [id]);
  if (existing.is_active) sheetsSvc.reloadActiveConfig();
  res.json({ success: true, data: { deleted: id } });
}));

// Live connectivity status of whatever is active (DB-row or env fallback)
router.get('/admin/sheets/connectivity', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const result = await sheetsSvc.checkConnectivity();
  res.json({ success: true, data: result });
}));

function googleSheetsError(res, error) {
  const code = error?.code || 'GOOGLE_SHEETS_SYNC_FAILED';
  const status = [
    'GOOGLE_OAUTH_NOT_CONFIGURED',
    'GOOGLE_SHEETS_NOT_CONNECTED',
    'GOOGLE_SHEETS_SPREADSHEET_NOT_FOUND',
    'GOOGLE_SHEETS_HEADER_INVALID',
    'INVALID_SPREADSHEET_ID',
    'GOOGLE_SHEETS_QUOTA_EXCEEDED',
    'GOOGLE_SHEETS_SYNC_ALREADY_RUNNING',
    'GOOGLE_SHEET_ALREADY_CONNECTED',
    'INVALID_LEAD_STATUS_VALUE',
  ].includes(code) ? (code === 'GOOGLE_SHEETS_SYNC_ALREADY_RUNNING' ? 409 : code === 'GOOGLE_SHEETS_QUOTA_EXCEEDED' ? 429 : 400) : code === 'GOOGLE_SHEETS_ACCESS_DENIED' ? 403 : 500;
  return res.status(status).json({
    success: false,
    code,
    message: error?.message || 'Google Sheets request failed.',
    retry_after_at: error?.retry_after_at || null,
  });
}

router.get('/my/google-sheets/status', authenticate, asyncHandler(async (req, res) => {
  const data = await userGoogleSheets.getStatus(req.user);
  res.json({ success: true, data });
}));

router.get('/lead-status-options', authenticate, (_req, res) => {
  res.json({
    success: true,
    data: {
      lead_statuses: leadStatusOptions.leadStatuses,
      call_statuses: leadStatusOptions.callStatuses,
      stages: leadStatusOptions.leadStages,
      follow_up_statuses: leadStatusOptions.followUpStatuses,
    },
  });
});

router.get('/my/google-sheets/spreadsheets', authenticate, asyncHandler(async (req, res) => {
  try {
    const result = await userGoogleSheets.listSpreadsheets(req.user, { refresh: req.query.refresh === 'true' });
    res.json({ success: true, data: result.data, cached: result.cached });
  } catch (error) {
    return googleSheetsError(res, error);
  }
}));

router.get('/my/google-sheets/oauth/start', authenticate, asyncHandler(async (req, res) => {
  try {
    const url = await googleUserOAuth.generateAuthUrl({ userId: req.user.id });
    res.json({ success: true, data: { url } });
  } catch (error) {
    return googleSheetsError(res, error);
  }
}));

router.get('/my/google-sheets/oauth/callback', asyncHandler(async (req, res) => {
  const frontend = process.env.FRONTEND_URL || process.env.APP_FRONTEND_URL || 'https://www.crm.digitaladbird.com';
  try {
    if (req.query.error) {
      const oauthError = new Error('Google account access was not granted.');
      oauthError.code = req.query.error === 'access_denied' ? 'access_denied' : 'GOOGLE_OAUTH_FAILED';
      throw oauthError;
    }
    const callback = await googleUserOAuth.exchangeCallback({
      code: req.query.code,
      state: req.query.state,
    });
    const setup = await userGoogleSheets.setupAfterOAuth(callback.user_id);
    if (setup.status === 'partial_setup') {
      const code = encodeURIComponent(setup.error_code || 'PARTIAL_SETUP');
      return res.redirect(`${frontend.replace(/\/$/, '')}/my-google-sheet?googleSheets=partial_setup&code=${code}`);
    }
    res.redirect(`${frontend.replace(/\/$/, '')}/my-google-sheet?googleSheets=connected`);
  } catch (error) {
    const code = encodeURIComponent(error?.code || 'GOOGLE_OAUTH_FAILED');
    res.redirect(`${frontend.replace(/\/$/, '')}/my-google-sheet?googleSheets=error&code=${code}`);
  }
}));

router.post('/my/google-sheets/create', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await userGoogleSheets.createSpreadsheet(req.user, req.body || {});
    res.json({ success: true, data, message: 'Google Sheet created successfully.' });
  } catch (error) {
    return googleSheetsError(res, error);
  }
}));

router.post('/my/google-sheets/connect-existing', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await userGoogleSheets.connectExisting(req.user, req.body || {});
    res.json({ success: true, data, message: 'Google Sheet connected successfully.' });
  } catch (error) {
    return googleSheetsError(res, error);
  }
}));

router.patch('/my/google-sheets/settings', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await userGoogleSheets.updateSettings(req.user, req.body || {});
    res.json({ success: true, data, message: 'My Google Sheet settings saved successfully.' });
  } catch (error) {
    return googleSheetsError(res, error);
  }
}));

router.post('/my/google-sheets/test', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await userGoogleSheets.testConnection(req.user);
    res.json({ success: true, data, ...data, message: 'Google Sheet test completed.' });
  } catch (error) {
    return googleSheetsError(res, error);
  }
}));

router.post('/my/google-sheets/create-missing-tabs', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await userGoogleSheets.testConnection(req.user);
    res.json({ success: true, data, message: 'Missing tabs were created and headers were verified.' });
  } catch (error) { return googleSheetsError(res, error); }
}));

router.post('/my/google-sheets/fix-headers', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await userGoogleSheets.testConnection(req.user);
    res.json({ success: true, data, message: 'Google Sheet headers were repaired.' });
  } catch (error) { return googleSheetsError(res, error); }
}));

router.post('/my/google-sheets/sync-now', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await userGoogleSheets.syncNow(req.user);
    res.json({ success: true, data, message: 'My leads synced to Google Sheets.' });
  } catch (error) {
    return googleSheetsError(res, error);
  }
}));

router.post('/my/google-sheets/pull-sync', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await userGoogleSheets.pullSync(req.user);
    res.json({ success: true, data, message: 'Allowed Google Sheet changes were synced to CRM.' });
  } catch (error) { return googleSheetsError(res, error); }
}));

router.post('/my/google-sheets/two-way-sync', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await userGoogleSheets.twoWaySync(req.user);
    res.json({ success: true, data, message: 'Two-way Google Sheet sync completed.' });
  } catch (error) { return googleSheetsError(res, error); }
}));

router.post('/my/google-sheets/disconnect', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await userGoogleSheets.disconnect(req.user);
    res.json({ success: true, data, message: 'Google Sheet disconnected.' });
  } catch (error) {
    return googleSheetsError(res, error);
  }
}));

router.get('/my/google-sheets/sync-logs', authenticate, asyncHandler(async (req, res) => {
  const data = await userGoogleSheets.getLogs(req.user, {
    page: req.query.page,
    pageSize: req.query.page_size,
  });
  res.json({ success: true, data });
}));

router.get('/admin/google-sheets/settings', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const data = await sheetsSvc.getSheetRoutingSettings();
  res.json({ success: true, data });
}));

router.patch('/admin/google-sheets/settings', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  let data;
  try {
    data = await sheetsSvc.updateSheetRoutingSettings(req.body || {});
  } catch (error) {
    if (error?.code === 'GOOGLE_SHEETS_NOT_CONFIGURED') {
      return res.status(400).json({
        success: false,
        code: 'GOOGLE_SHEETS_NOT_CONFIGURED',
        message: 'Google Sheets is not configured on the server.',
      });
    }
    throw error;
  }
  res.json({
    success: true,
    data: {
      default_sheet_name: data.default_sheet_name,
      trader_sheet_name: data.trader_sheet_name,
      partner_sheet_name: data.partner_sheet_name,
      unknown_sheet_name: data.unknown_sheet_name,
    },
    message: 'Google Sheet names saved successfully.',
  });
}));

router.post('/admin/google-sheets/test-connection', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const data = await sheetsSvc.checkConnectivity();
  res.json({ success: true, data });
}));

router.post('/admin/google-sheets/test-sheet-routing', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  let data;
  try {
    data = await sheetsSvc.testSheetRouting(req.body || {});
  } catch (error) {
    if (error?.code === 'GOOGLE_SHEETS_NOT_CONFIGURED' || /No active Google Sheets config|No Google credentials configured|No active Google Sheets configuration|Google Sheets is not configured/i.test(error.message || '')) {
      return res.status(400).json({
        success: false,
        code: 'GOOGLE_SHEETS_NOT_CONFIGURED',
        message: 'Google Sheets is not configured on the server.',
      });
    }
    throw error;
  }
  res.json({ success: true, data, ...data });
}));

router.post('/admin/google-sheets/create-missing-tabs', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const data = await sheetsSvc.createMissingTabs();
  res.json({ success: true, data });
}));

router.post('/admin/google-sheets/export-leads-by-category', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const data = await sheetsSvc.exportLeadsByCategory({
    mode: body.mode || 'dry_run',
    category: body.category || 'all',
    dateFrom: body.date_from || null,
    dateTo: body.date_to || null,
    skipDuplicates: body.skip_duplicates !== false,
  });
  res.json({ success: true, data, ...data });
}));

// ── Sheet → CRM import ────────────────────────────────────────────────
router.get('/admin/google-sheets/master/status', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const data = await sheetsSvc.checkConnectivity();
  res.json({ success: true, data });
}));

router.post('/admin/google-sheets/master/test', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const data = await sheetsSvc.testSheetRouting(req.body || {});
  res.json({ success: true, data, ...data });
}));

router.post('/admin/google-sheets/master/sync-now', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const data = await sheetsSvc.exportLeadsByCategory({
    mode: req.body?.mode || 'export',
    category: req.body?.category || 'all',
  });
  res.json({ success: true, data, ...data, message: 'Company master sheet sync completed.' });
}));

router.post('/admin/google-sheets/master/create-missing-tabs', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const data = await sheetsSvc.createMissingTabs();
  res.json({ success: true, data });
}));

router.get('/admin/google-sheets/master/read', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.page_size || req.query.limit) || 20));
  const data = await sheetsSvc.previewRows(limit);
  res.json({ success: true, data });
}));

router.get('/admin/user-google-sheets/connections', authenticate, requireRole('super_admin', 'admin'), asyncHandler(async (req, res) => {
  const data = await userGoogleSheets.listConnections({
    page: req.query.page,
    pageSize: req.query.page_size,
    search: req.query.search,
    role: req.query.role,
    status: req.query.status,
    userId: req.query.user_id,
  });
  res.json({ success: true, data, connections: data.data, pagination: data.pagination });
}));

router.get('/admin/user-google-sheets/sync-logs', authenticate, requireRole('super_admin', 'admin'), asyncHandler(async (req, res) => {
  const data = await userGoogleSheets.listAllLogs({
    page: req.query.page,
    pageSize: req.query.page_size,
    userId: req.query.user_id,
    status: req.query.status,
  });
  res.json({ success: true, data, logs: data.data, pagination: data.pagination });
}));

router.get('/admin/user-google-sheets/connections/:connectionId/preview', authenticate, requireRole('super_admin', 'admin'), asyncHandler(async (req, res) => {
  try {
    const data = await userGoogleSheets.adminPreview(req.params.connectionId, {
      sheetName: req.query.sheet_name,
      page: req.query.page,
      pageSize: req.query.page_size,
      search: req.query.search,
    });
    res.json({ success: true, data });
  } catch (error) {
    return googleSheetsError(res, error);
  }
}));

router.post('/admin/user-google-sheets/connections/:connectionId/test', authenticate, requireRole('super_admin', 'admin'), asyncHandler(async (req, res) => {
  try {
    const data = await userGoogleSheets.adminTestConnection(req.params.connectionId);
    res.json({ success: true, data, message: 'User Google Sheet connection test completed.' });
  } catch (error) {
    return googleSheetsError(res, error);
  }
}));

router.post('/admin/user-google-sheets/connections/:connectionId/sync-now', authenticate, requireRole('super_admin', 'admin'), asyncHandler(async (req, res) => {
  try {
    const data = await userGoogleSheets.adminSyncNow(req.params.connectionId);
    const { logActivity } = require('../utils/auditLog');
    logActivity(req, {
      action: 'user_google_sheet_sync',
      entity: 'google_sheet_connection',
      entity_id: req.params.connectionId,
      metadata: { records_attempted: data.attempted, records_synced: data.synced, records_failed: data.failed },
    }).catch(error => logger.warn({ err: error.message }, '[Google Sheets] admin sync audit failed'));
    res.json({ success: true, data, message: 'User Google Sheet sync completed.' });
  } catch (error) {
    return googleSheetsError(res, error);
  }
}));

router.post('/admin/user-google-sheets/connections/:connectionId/pull-sync', authenticate, requireRole('super_admin', 'admin'), asyncHandler(async (req, res) => {
  try {
    const data = await userGoogleSheets.adminPullSync(req.params.connectionId);
    const { logActivity } = require('../utils/auditLog');
    logActivity(req, { entity: 'google_sheet_connection', entity_id: req.params.connectionId, action: 'user_google_sheet_pull', metadata: data });
    res.json({ success: true, data, message: 'User Google Sheet changes synced to CRM.' });
  } catch (error) { return googleSheetsError(res, error); }
}));

const sheetImport = require('../services/sheetImportService');

// Trigger an import from a specific config (must have credentials).
router.post('/admin/sheets/configs/:id/import', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  try {
    const stats = await sheetImport.importFromConfig({
      configId:    id,
      triggeredBy: 'manual',
      userId:      req.user.id,
      assign:      req.body?.assign !== false,
      maxRows:     Math.min(50000, parseInt(req.body?.max_rows) || 5000),
    });
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(502).json({ success: false, error: { code: 'IMPORT_FAILED', message: err.message } });
  }
}));

// List recent imports for a config
router.get('/admin/sheets/configs/:id/import-logs', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const limit = parseInt(req.query.limit) || 20;
  const logs = await sheetImport.getRecentLogs(id, limit);
  res.json({ success: true, data: logs });
}));

// Toggle auto-import (every N minutes)
router.patch('/admin/sheets/configs/:id/auto-import', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { enabled, minutes } = req.body || {};
  const m = Math.max(1, Math.min(60, Number(minutes) || 5));
  const { rowCount, rows } = await query(
    `UPDATE integration_configs
        SET auto_import_enabled = COALESCE($1, auto_import_enabled),
            auto_import_minutes = COALESCE($2, auto_import_minutes),
            updated_at = NOW()
      WHERE id = $3 AND kind = 'google_sheets'
      RETURNING id, auto_import_enabled, auto_import_minutes`,
    [enabled === undefined ? null : !!enabled, minutes === undefined ? null : m, id],
  );
  if (!rowCount) throw new AppError(404, 'NOT_FOUND', 'Config not found');
  res.json({ success: true, data: rows[0] });
}));

// ── Distribution Rules Management ────────────────────────────────
router.patch('/admin/rules/:id', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, strategy, is_active, eligible_user_ids, priority, form_id } = req.body;
  if (strategy !== undefined && strategy !== 'round_robin') {
    throw new AppError(422, 'DISTRIBUTION_METHOD_DISABLED', 'Only round robin auto distribution is supported.');
  }
  const sets = []; const vals = []; let idx = 0;
  if (name !== undefined) { sets.push(`name = $${++idx}`); vals.push(name); }
  if (strategy !== undefined) { sets.push(`strategy = $${++idx}`); vals.push(strategy); }
  if (is_active !== undefined) { sets.push(`is_active = $${++idx}`); vals.push(is_active); }
  if (eligible_user_ids !== undefined) { sets.push(`eligible_user_ids = $${++idx}`); vals.push(JSON.stringify(eligible_user_ids)); }
  if (priority !== undefined) { sets.push(`priority = $${++idx}`); vals.push(priority); }
  if (form_id !== undefined) { sets.push(`form_id = $${++idx}`); vals.push(form_id); }
  if (sets.length === 0) throw new AppError(400, 'INVALID', 'Nothing to update');
  vals.push(id);
  const { rows: [r] } = await query(`UPDATE distribution_rules SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Rule not found');
  res.json({ success: true, data: r });
}));

router.delete('/admin/rules/:id', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { rowCount } = await query(`DELETE FROM distribution_rules WHERE id = $1`, [req.params.id]);
  if (rowCount === 0) throw new AppError(404, 'NOT_FOUND', 'Rule not found');
  res.json({ success: true, data: { message: 'Rule deleted' } });
}));

// ── Admin Analytics Dashboard ────────────────────────────────────
router.get('/admin/analytics/overview', authenticate, requireRole('super_admin'), responseCache(15000), asyncHandler(async (_req, res) => {
  const { rows: [counts] } = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM users WHERE deleted_at IS NULL AND status = 'active') AS active_users,
      (SELECT COUNT(*)::int FROM users WHERE deleted_at IS NULL AND role = 'rm') AS total_rms,
      (SELECT COUNT(*)::int FROM users WHERE deleted_at IS NULL AND role::text IN ('member', 'partner')) AS total_members,
      0 AS total_partners,
      (SELECT COUNT(*)::int FROM users WHERE deleted_at IS NULL AND status = 'blocked') AS blocked_users,
      (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL) AS total_leads,
      (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND assigned_to_user_id IS NULL) AS unassigned_leads,
      (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND is_pending = TRUE) AS pending_leads,
      (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND call_status = 'converted') AS converted_leads,
      (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND stage = 'won') AS won_leads,
      (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND stage = 'lost') AS lost_leads,
      (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_leads,
      (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND call_status = 'converted' AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_conversions,
      (SELECT COUNT(*)::int FROM lead_requests WHERE status = 'pending') AS pending_requests,
      (SELECT COUNT(*)::int FROM lead_remarks WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_remarks
  `);

  const { rows: dailyTrend } = await query(`
    SELECT d::date AS day,
      (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND created_at::date = d::date) AS leads,
      (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND call_status = 'converted' AND created_at::date = d::date) AS conversions,
      (SELECT COUNT(*)::int FROM lead_remarks WHERE created_at::date = d::date) AS remarks
    FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE, '1 day') AS d
    ORDER BY d
  `);

  const { rows: topPerformers } = await query(`
    SELECT u.id, u.full_name, u.role, u.team_name,
      COUNT(l.id)::int AS total_leads,
      COUNT(l.id) FILTER (WHERE l.call_status = 'converted')::int AS conversions,
      ROUND(COUNT(l.id) FILTER (WHERE l.call_status = 'converted')::numeric / NULLIF(COUNT(l.id), 0) * 100, 1) AS conv_rate
    FROM users u
    LEFT JOIN leads l ON l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
    WHERE u.deleted_at IS NULL AND u.role = 'member'
    GROUP BY u.id, u.full_name, u.role, u.team_name
    ORDER BY conversions DESC LIMIT 15
  `);

  const { rows: stageBreakdown } = await query(`
    SELECT stage, COUNT(*)::int AS count
    FROM leads WHERE deleted_at IS NULL GROUP BY stage ORDER BY count DESC
  `);

  const { rows: statusBreakdown } = await query(`
    SELECT call_status, COUNT(*)::int AS count
    FROM leads WHERE deleted_at IS NULL GROUP BY call_status ORDER BY count DESC
  `);

  const { rows: hourlyToday } = await query(`
    SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::int AS count
    FROM leads WHERE deleted_at IS NULL AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
    GROUP BY hour ORDER BY hour
  `);

  res.json({ success: true, data: { counts, dailyTrend, topPerformers, stageBreakdown, statusBreakdown, hourlyToday } });
}));

// ── Admin: User Detail (enhanced) ────────────────────────────────
router.get('/admin/users/:userId/detail', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { rows: [user] } = await query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId]);
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');

  const { rows: leadStats } = await query(`
    SELECT
      COUNT(*)::int AS total_leads,
      COUNT(*) FILTER (WHERE is_pending = TRUE)::int AS pending,
      COUNT(*) FILTER (WHERE call_status = 'converted')::int AS conversions,
      COUNT(*) FILTER (WHERE call_status = 'not_called')::int AS not_called,
      COUNT(*) FILTER (WHERE (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date)::int AS today_received,
      COUNT(*) FILTER (WHERE call_status = 'converted' AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date)::int AS today_conversions
    FROM leads WHERE assigned_to_user_id = $1 AND deleted_at IS NULL
  `, [userId]);

  const { rows: recentRemarks } = await query(`
    SELECT lr.*, l.full_name AS lead_name
    FROM lead_remarks lr
    JOIN leads l ON l.id = lr.lead_id AND l.deleted_at IS NULL
    WHERE lr.user_id = $1
    ORDER BY lr.created_at DESC LIMIT 10
  `, [userId]);

  const { rows: reportees } = await query(`
    SELECT id, full_name, email, role, status, team_name FROM users WHERE report_to_id = $1 AND deleted_at IS NULL
  `, [userId]);

  res.json({ success: true, data: { user, lead_stats: leadStats[0], recent_remarks: recentRemarks, reportees } });
}));

// ── Admin: Update user lead cap / weight / role ──────────────────
router.post('/admin/users/:userId/update-settings', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { daily_lead_cap, distribution_weight, role, is_available, team_name, report_to_id } = req.body;
  const { rows: [current] } = await query(
    `SELECT role, report_to_id, team_name FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  if (!current) throw new AppError(404, 'NOT_FOUND', 'User not found');

  const nextRole = role !== undefined ? normalizeRole(role) : null;
  const effectiveRole = nextRole || normalizeRole(current.role);
  const effectiveReportTo = report_to_id !== undefined ? report_to_id : current.report_to_id;
  let derivedTeamName = team_name !== undefined ? team_name : current.team_name;

  if (effectiveRole === 'rm') {
    if (!String(derivedTeamName || '').trim()) throw new AppError(400, 'TEAM_NAME_REQUIRED', 'Team name is required for RM');
    derivedTeamName = String(derivedTeamName).trim();
  }

  if (effectiveRole === 'member') {
    if (!effectiveReportTo) throw new AppError(400, 'RM_REQUIRED', 'Member must report to an active RM');
    const { rows: [rm] } = await query(
      `SELECT id, team_name FROM users
        WHERE id = $1 AND role = 'rm' AND deleted_at IS NULL AND COALESCE(status, 'active') = 'active'`,
      [effectiveReportTo],
    );
    if (!rm) throw new AppError(400, 'INVALID_RM', 'Member must report to an active RM');
    derivedTeamName = rm.team_name || null;
  }

  const sets = []; const vals = []; let idx = 0;
  if (daily_lead_cap !== undefined) { sets.push(`daily_lead_cap = $${++idx}`); vals.push(daily_lead_cap); }
  if (distribution_weight !== undefined) { sets.push(`distribution_weight = $${++idx}`); vals.push(distribution_weight); }
  if (role !== undefined) { sets.push(`role = $${++idx}`); vals.push(nextRole); }
  if (is_available !== undefined) {
    sets.push(`is_available = $${++idx}`); vals.push(is_available);
    sets.push(`lead_assignment_enabled = $${++idx}`); vals.push(is_available === true);
    sets.push(`lead_assignment_status = $${++idx}`); vals.push(is_available === true ? 'available' : 'unavailable');
    sets.push(`lead_assignment_updated_by = $${++idx}`); vals.push(req.user.id);
    sets.push(`lead_assignment_updated_at = NOW()`);
  }
  if (team_name !== undefined || effectiveRole === 'member') { sets.push(`team_name = $${++idx}`); vals.push(derivedTeamName); }
  if (report_to_id !== undefined || effectiveRole === 'rm' || effectiveRole === 'member') {
    sets.push(`report_to_id = $${++idx}`);
    vals.push(effectiveRole === 'rm' ? null : effectiveReportTo);
  }
  if (sets.length === 0) throw new AppError(400, 'INVALID', 'Nothing to update');
  sets.push(`updated_at = NOW()`);
  vals.push(userId);
  const { rows: [u] } = await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length} AND deleted_at IS NULL RETURNING *`, vals);
  if (!u) throw new AppError(404, 'NOT_FOUND', 'User not found');
  await query(`INSERT INTO activity_logs(user_id, user_name, user_role, entity, entity_id, action, metadata, ip_address)
    VALUES($1,$2,$3,'user',$4,'admin_update_settings',$5,$6)`,
    [req.user.id, req.user.full_name, req.user.role, userId, JSON.stringify(req.body), req.ip]);
  invalidateUser(userId);
  res.json({ success: true, data: u });
}));

// ── Campaign Performance Report ──────────────────────────────────
router.get('/reports/campaign-summary', authenticate, asyncHandler(async (_req, res) => {
  const { rows } = await query(`
    SELECT COALESCE(l.campaign_name, 'Unknown') AS campaign,
      COUNT(*)::int AS total_leads,
      COUNT(*) FILTER (WHERE (COALESCE(l.meta_created_time, l.created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date)::int AS today_leads,
      COUNT(*) FILTER (WHERE l.call_status = 'converted')::int AS conversions,
      ROUND(COUNT(*) FILTER (WHERE l.call_status = 'converted')::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS conv_rate
    FROM leads l WHERE l.deleted_at IS NULL
    GROUP BY campaign ORDER BY total_leads DESC
  `);
  res.json({ success: true, data: rows });
}));

// ── Meta Forms + Subscriptions (extended for admin) ──────────────
router.get('/admin/meta/overview', authenticate, requireRole('super_admin'), responseCache(30000), asyncHandler(async (_req, res) => {
  const { rows: forms } = await query(`SELECT * FROM meta_forms ORDER BY created_at DESC`);
  const { rows: pages } = await query(`SELECT * FROM meta_pages ORDER BY created_at DESC`);

  let campaigns = [];
  try { const r = await query(`SELECT * FROM meta_campaigns ORDER BY created_at DESC`); campaigns = r.rows; } catch {}

  const { rows: recentLeads } = await query(`
    SELECT l.id, l.full_name, l.phone, l.source, l.campaign_name, l.meta_form_id, l.created_at
    FROM leads l WHERE l.deleted_at IS NULL AND l.source IN ('meta', 'google', 'website')
    ORDER BY l.created_at DESC LIMIT 20
  `);

  res.json({ success: true, data: { forms, pages, campaigns, recent_leads: recentLeads } });
}));

// ── Followup Management ──────────────────────────────────────────
router.get('/admin/followups', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const type = req.query.type || 'all';
  let filter = '';
  if (type === 'overdue') filter = `AND l.next_followup_at < NOW() AND l.next_followup_at::date < CURRENT_DATE`;
  else if (type === 'today') filter = `AND l.next_followup_at::date = CURRENT_DATE`;
  else if (type === 'upcoming') filter = `AND l.next_followup_at::date > CURRENT_DATE AND l.next_followup_at::date <= CURRENT_DATE + INTERVAL '7 days'`;

  const { rows } = await query(`
    SELECT l.id, l.full_name, l.phone, l.source, l.campaign_name, l.stage, l.call_status,
      l.next_followup_at, l.assigned_to_user_id, u.full_name AS assigned_to_name
    FROM leads l
    LEFT JOIN users u ON u.id = l.assigned_to_user_id
    WHERE l.deleted_at IS NULL AND l.next_followup_at IS NOT NULL
      AND l.stage NOT IN ('won', 'lost') ${filter}
    ORDER BY l.next_followup_at ASC LIMIT 100
  `);
  res.json({ success: true, data: rows });
}));

// ── Conversion Analytics ─────────────────────────────────────────
router.get('/admin/analytics/conversions', authenticate, requireRole('super_admin'), responseCache(20000), asyncHandler(async (_req, res) => {
  const { rows: byUser } = await query(`
    SELECT u.id, u.full_name, u.role, u.team_name,
      COUNT(l.id)::int AS total_leads,
      COUNT(l.id) FILTER (WHERE l.call_status = 'converted')::int AS conversions,
      ROUND(COUNT(l.id) FILTER (WHERE l.call_status = 'converted')::numeric / NULLIF(COUNT(l.id), 0) * 100, 1) AS conv_rate,
      AVG(EXTRACT(EPOCH FROM (lr_first.first_remark - l.created_at)) / 3600)::numeric(10,1) AS avg_response_hours
    FROM users u
    LEFT JOIN leads l ON l.assigned_to_user_id = u.id AND l.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT MIN(lr.created_at) AS first_remark FROM lead_remarks lr WHERE lr.lead_id = l.id
    ) lr_first ON TRUE
    WHERE u.deleted_at IS NULL AND u.role = 'member'
    GROUP BY u.id, u.full_name, u.role, u.team_name
    HAVING COUNT(l.id) > 0
    ORDER BY conversions DESC
  `);

  const { rows: bySource } = await query(`
    SELECT source,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE call_status = 'converted')::int AS conversions,
      ROUND(COUNT(*) FILTER (WHERE call_status = 'converted')::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS conv_rate
    FROM leads WHERE deleted_at IS NULL GROUP BY source ORDER BY total DESC
  `);

  const { rows: byCampaign } = await query(`
    SELECT COALESCE(campaign_name, 'Unknown') AS campaign,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE call_status = 'converted')::int AS conversions,
      ROUND(COUNT(*) FILTER (WHERE call_status = 'converted')::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS conv_rate
    FROM leads WHERE deleted_at IS NULL GROUP BY campaign ORDER BY total DESC
  `);

  res.json({ success: true, data: { byUser, bySource, byCampaign } });
}));

// ══════════════════════════════════════════════════════════════════════
// ENTERPRISE SETTINGS — Meta Pages/Forms enriched, Webhook logs, Sheets detail
// ══════════════════════════════════════════════════════════════════════

// Enriched Meta pages — with lead counts, form counts, token status
router.get('/admin/meta/pages-enriched', authenticate, requireRole('super_admin'), responseCache(15000), asyncHandler(async (_req, res) => {
  const { rows } = await query(`
    SELECT p.id, p.page_id, p.page_name, p.is_active, p.created_at,
      p.token_is_valid, p.token_last_checked, p.token_last_error,
      p.webhook_subscribed, p.webhook_last_checked, p.forms_status,
      p.forms_last_checked, p.stale_at, p.deactivated_at,
      p.connection_status, p.selected_at, p.selected_by_user_id,
      p.deactivation_reason,
      (p.page_access_token IS NOT NULL AND p.page_access_token != '') AS has_token,
      (SELECT COUNT(*)::int FROM meta_forms f WHERE f.page_id = p.page_id) AS form_count,
      (SELECT COUNT(*)::int FROM leads l WHERE l.deleted_at IS NULL AND l.meta_page_id = p.page_id) AS lead_count,
      (SELECT COUNT(*)::int FROM leads l WHERE l.deleted_at IS NULL AND l.meta_page_id = p.page_id AND (COALESCE(l.meta_created_time, l.created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_leads,
      (SELECT COUNT(*)::int FROM leads l WHERE l.deleted_at IS NULL AND l.meta_page_id = p.page_id AND l.call_status = 'converted') AS conversions,
      (SELECT MAX(l.created_at) FROM leads l WHERE l.deleted_at IS NULL AND l.meta_page_id = p.page_id) AS last_lead_at
    FROM meta_pages p
    ORDER BY p.is_active DESC, p.connection_status, p.page_name
  `);
  res.json({ success: true, data: rows });
}));

// Enriched Meta forms — with lead counts, latest leads, page name
router.get('/admin/meta/forms-enriched', authenticate, requireRole('super_admin'), responseCache(15000), asyncHandler(async (_req, res) => {
  const { rows } = await query(`
    SELECT f.id, f.form_id, f.form_name, f.page_id, f.campaign_label, f.product_tag, f.is_active, f.created_at,
      p.page_name,
      (SELECT COUNT(*)::int FROM leads l WHERE l.deleted_at IS NULL AND l.meta_form_id = f.form_id) AS lead_count,
      (SELECT COUNT(*)::int FROM leads l WHERE l.deleted_at IS NULL AND l.meta_form_id = f.form_id AND (COALESCE(l.meta_created_time, l.created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_leads,
      (SELECT COUNT(*)::int FROM leads l WHERE l.deleted_at IS NULL AND l.meta_form_id = f.form_id AND l.call_status = 'converted') AS conversions,
      (SELECT COUNT(*)::int FROM leads l WHERE l.deleted_at IS NULL AND l.meta_form_id = f.form_id AND l.is_pending = TRUE) AS pending_leads,
      (SELECT MAX(l.created_at) FROM leads l WHERE l.deleted_at IS NULL AND l.meta_form_id = f.form_id) AS last_lead_at
    FROM meta_forms f
    JOIN meta_pages p ON p.page_id = f.page_id AND p.is_active = TRUE AND p.connection_status = 'active'
    ORDER BY f.form_name
  `);
  res.json({ success: true, data: rows });
}));

// Leads for a specific form — with pagination and filters
router.get('/admin/meta/form-leads/:formId', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { formId } = req.params;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(50, parseInt(req.query.page_size) || 20);
  const offset = (page - 1) * pageSize;
  const stage = req.query.stage || null;
  const callStatus = req.query.call_status || null;

  let where = `l.deleted_at IS NULL AND l.meta_form_id = $1`;
  const vals = [formId];
  let idx = 1;
  if (stage) { where += ` AND l.stage = $${++idx}`; vals.push(stage); }
  if (callStatus) { where += ` AND l.call_status = $${++idx}`; vals.push(callStatus); }

  const countQ = await query(`SELECT COUNT(*)::int AS total FROM leads l WHERE ${where}`, vals);
  const total = countQ.rows[0].total;

  vals.push(pageSize, offset);
  const { rows } = await query(`
    SELECT l.id, l.full_name, l.phone, l.email, l.source, l.stage, l.call_status,
      l.campaign_name, l.is_pending, l.assigned_to_user_id, l.created_at,
      u.full_name AS assigned_to_name
    FROM leads l
    LEFT JOIN users u ON u.id = l.assigned_to_user_id
    WHERE ${where}
    ORDER BY l.created_at DESC
    LIMIT $${idx + 1} OFFSET $${idx + 2}
  `, vals);

  res.json({ success: true, data: { rows, total, page, page_size: pageSize } });
}));

// Leads for a specific page — with pagination
router.get('/admin/meta/page-leads/:pageId', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { pageId } = req.params;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(50, parseInt(req.query.page_size) || 20);
  const offset = (page - 1) * pageSize;

  const countQ = await query(`SELECT COUNT(*)::int AS total FROM leads WHERE deleted_at IS NULL AND meta_page_id = $1`, [pageId]);
  const total = countQ.rows[0].total;

  const { rows } = await query(`
    SELECT l.id, l.full_name, l.phone, l.email, l.source, l.stage, l.call_status,
      l.campaign_name, l.meta_form_id, l.is_pending, l.created_at,
      u.full_name AS assigned_to_name
    FROM leads l
    LEFT JOIN users u ON u.id = l.assigned_to_user_id
    WHERE l.deleted_at IS NULL AND l.meta_page_id = $1
    ORDER BY l.created_at DESC
    LIMIT $2 OFFSET $3
  `, [pageId, pageSize, offset]);

  res.json({ success: true, data: { rows, total, page, page_size: pageSize } });
}));

// Meta webhook & sync logs combined
router.get('/admin/meta/webhook-logs', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit) || 30);

  // Sync logs from meta_sync_log table
  let syncLogs = [];
  try {
    const r = await query(`SELECT id, sync_type, source_id, status, leads_fetched, leads_created, leads_duplicate, errors, started_at, completed_at FROM meta_sync_log ORDER BY started_at DESC LIMIT $1`, [limit]);
    syncLogs = r.rows;
  } catch { /* table may not exist */ }

  // Audit logs for meta-related actions
  let auditLogs = [];
  try {
    const r = await query(`
      SELECT id, user_id, entity, entity_id, action, metadata, ip_address, created_at,
        (SELECT full_name FROM users WHERE id = a.user_id) AS user_name
      FROM audit_logs a WHERE entity IN ('meta', 'webhook', 'lead_ingestion')
      ORDER BY created_at DESC LIMIT $1
    `, [limit]);
    auditLogs = r.rows;
  } catch { /* audit_logs may have different schema */ }

  // Activity logs for meta-related actions
  let activityLogs = [];
  try {
    const r = await query(`
      SELECT id, user_name, user_role, entity, entity_id, action, metadata, ip_address, created_at
      FROM activity_logs WHERE entity IN ('meta', 'webhook', 'campaign')
      ORDER BY created_at DESC LIMIT $1
    `, [limit]);
    activityLogs = r.rows;
  } catch { /* ok */ }

  res.json({ success: true, data: { sync_logs: syncLogs, audit_logs: auditLogs, activity_logs: activityLogs } });
}));

// Permanent webhook event log — every webhook call (good or bad) lands here.
// Use this when "Meta leads stopped" to see whether Meta is even reaching us
// and what the signature/payload looked like.
router.get('/admin/meta/webhook-events', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
  const hours = Math.min(720, parseInt(req.query.hours, 10) || 24);
  const onlyBad = req.query.bad_only === '1';
  let where = `received_at > NOW() - INTERVAL '${hours} hours'`;
  if (onlyBad) where += ' AND (signature_valid = FALSE OR leads_error > 0 OR status_code >= 400)';
  const { rows } = await query(`
    SELECT id, received_at, source, endpoint, method, remote_ip, user_agent,
           signature_valid, body_size, page_id, form_id, event_type,
           lead_count, leads_created, leads_dup, leads_error,
           status_code, processing_ms, error_summary
      FROM webhook_events
     WHERE ${where}
     ORDER BY received_at DESC
     LIMIT $1`, [limit]);
  const summary = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE signature_valid = TRUE)::int AS sig_ok,
      COUNT(*) FILTER (WHERE signature_valid = FALSE)::int AS sig_bad,
      COUNT(*) FILTER (WHERE leads_error > 0)::int AS had_errors,
      SUM(leads_created)::int AS leads_created,
      SUM(leads_dup)::int AS leads_dup
      FROM webhook_events
     WHERE received_at > NOW() - INTERVAL '${hours} hours'`);
  res.json({ success: true, data: { window_hours: hours, summary: summary.rows[0], events: rows } });
}));

// Token health snapshot for the admin UI. Reads DB-stored truth refreshed
// every 15 minutes by metaTokenHealthJob — not a cached UI test result.
router.get('/admin/meta/token-health', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const { rows } = await query(`
    SELECT page_id, page_name, is_active,
           token_is_valid, token_last_checked, token_expires_at, token_last_error
      FROM meta_pages
     WHERE is_active = TRUE
     ORDER BY page_name`);
  const anyInvalid = rows.some(r => r.token_is_valid === false);
  const anyUnknown = rows.some(r => r.token_is_valid === null);
  res.json({
    success: true,
    data: {
      pages: rows,
      any_invalid: anyInvalid,
      any_unknown: anyUnknown,
      overall_status: anyInvalid ? 'critical' : (anyUnknown ? 'unknown' : 'healthy'),
    },
  });
}));

// Enriched Google Sheets status with detailed sync history
router.get('/admin/sheets/enriched', authenticate, requireRole('super_admin'), responseCache(15000), asyncHandler(async (_req, res) => {
  const config = await sheetsResolveConfigStatus();

  // Try to get live sheet status from integration check
  let liveStatus = null;
  try {
    const sheetsCheck = require('../services/googleSheetsService').checkConnectivity;
    if (typeof sheetsCheck === 'function') {
      liveStatus = await sheetsCheck();
    }
  } catch { /* not available */ }

  // Sync activity logs
  let syncLogs = [];
  try {
    const { rows } = await query(`SELECT * FROM activity_logs WHERE entity = 'sheets' ORDER BY created_at DESC LIMIT 30`);
    syncLogs = rows;
  } catch { /* ok */ }

  // Total leads + synced count
  const { rows: [stats] } = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL) AS total_leads,
      (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_leads
  `);

  res.json({ success: true, data: { config, live_status: liveStatus, sync_logs: syncLogs, stats } });
}));

// Meta token status check (wraps debug-token with friendly output)
router.get('/admin/meta/token-status', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const tokenResolver = require('../services/metaTokenResolver');
  const { checkUserToken } = require('../jobs/metaTokenHealthJob');
  const pages = await tokenResolver.findActivePages();
  const { rows: [ignoredPageCounts] } = await query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE connection_status = 'discovered')::int AS discovered,
           COUNT(*) FILTER (WHERE connection_status = 'stale')::int AS stale
      FROM meta_pages
     WHERE is_active = FALSE
  `);
  const pageChecks = [];
  for (const page of pages) {
    if (!page.page_access_token) {
      pageChecks.push({ page_id: page.page_id, page_name: page.page_name, status: 'missing', forms_accessible: false, webhook_subscribed: false });
      continue;
    }
    let status = 'valid';
    let pageError = null;
    try {
      await require('../services/metaGraphClient').graphGet(page.page_id, { fields: 'id,name' }, page.page_access_token, { pageId: page.page_id, tokenSource: 'db_page_token' });
      await tokenResolver.updatePageHealth(page.page_id, { valid: true });
    } catch (error) {
      status = 'invalid';
      pageError = error.message;
    }
    let forms = [];
    let formsError = null;
    try { forms = await metaSync.listPageForms(page.page_id); } catch (error) { formsError = error.message; }
    let apps = [];
    let subscriptionError = null;
    try {
      const subscriptions = await metaSync.getPageSubscriptions(page.page_id);
      apps = subscriptions.data || [];
    } catch (error) { subscriptionError = error.message; }
    pageChecks.push({
      page_id: page.page_id,
      page_name: page.page_name,
      status,
      forms_accessible: !formsError,
      form_count: forms.length,
      webhook_subscribed: apps.some(app => Array.isArray(app.subscribed_fields) && app.subscribed_fields.includes('leadgen')),
      error: pageError,
      forms_error: formsError,
      subscription_error: subscriptionError,
    });
  }
  const userToken = await checkUserToken();
  const validPageCount = pageChecks.filter(page => page.status === 'valid').length;
  const invalidPageCount = pageChecks.filter(page => page.status === 'invalid').length;
  const subscribedCount = pageChecks.filter(page => page.webhook_subscribed).length;
  const webhookStatus = pageChecks.length === 0
    ? 'not_subscribed'
    : subscribedCount === pageChecks.length
      ? 'subscribed'
      : subscribedCount > 0
        ? 'partial'
        : 'not_subscribed';
  const formOkCount = pageChecks.filter(page => page.forms_accessible).length;
  const formErrorCount = pageChecks.filter(page => page.forms_error).length;
  const leadFormsStatus = pageChecks.length === 0
    ? 'error'
    : formOkCount > 0 && formErrorCount > 0
      ? 'partial_error'
      : formOkCount > 0
        ? (pageChecks.some(page => (page.form_count || 0) > 0) ? 'accessible' : 'accessible_empty')
        : 'error';
  const connectivity = validPageCount > 0
    ? { connected: true, token_source: 'db_page_token', pages: validPageCount }
    : { connected: false, error: pageChecks[0]?.error || 'No valid DB Page Access Token' };
  const appSecret = !!process.env.META_APP_SECRET;
  const verifyToken = !!process.env.META_VERIFY_TOKEN;

  res.json({
    success: true,
    data: {
      has_page_token: pages.some(page => !!page.page_access_token),
      has_user_token: userToken.status !== 'missing',
      has_app_secret: appSecret,
      has_verify_token: verifyToken,
      connectivity,
      token_info: userToken,
      error: validPageCount === 0 ? connectivity.error : null,
      pageTokens: { valid: validPageCount, invalid: invalidPageCount, missing: pageChecks.filter(page => page.status === 'missing').length, pages: pageChecks },
      userToken: { ...userToken, requiredFor: ['refresh_pages', 'adaccounts', 'campaign_sync'] },
      webhook: { status: webhookStatus, subscribed: webhookStatus === 'subscribed', subscribed_count: subscribedCount, total: pageChecks.length },
      leadForms: { status: leadFormsStatus, accessible: formOkCount > 0, accessible_count: formOkCount, error_count: formErrorCount },
      campaignSync: { status: userToken.status === 'valid' ? 'available' : 'degraded', required_user_token: true },
      connected: validPageCount > 0,
      ignoredPages: ignoredPageCounts,
      warnings: [
        ...(Number(ignoredPageCounts.total) > 0
          ? [`${ignoredPageCounts.total} inactive page(s) are ignored by health checks and lead sync.`]
          : []),
        ...(userToken.status !== 'valid' && validPageCount > 0 && webhookStatus === 'subscribed'
          ? ['User token is expired or missing, but page webhook subscription is active.']
          : []),
        ...(leadFormsStatus === 'error' || leadFormsStatus === 'partial_error'
          ? ['Some Meta Lead Forms could not be accessed. Check Page token permissions for leads_retrieval and pages_manage_ads.']
          : []),
      ],
      warning: userToken.status !== 'valid' && validPageCount > 0 && webhookStatus === 'subscribed'
        ? 'User token is expired or missing, but page webhook subscription is active.'
        : null,
    },
  });
}));

// Webhook subscription status for all pages
router.get('/admin/meta/subscription-status', authenticate, requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const { rows: pages } = await query(`SELECT page_id, page_name FROM meta_pages WHERE is_active = TRUE`);
  const results = [];
  for (const p of pages) {
    try {
      const subs = await metaSync.getPageSubscriptions(p.page_id);
      const apps = subs.data || [];
      const subscribed = apps.some(app => Array.isArray(app.subscribed_fields) && app.subscribed_fields.includes('leadgen'));
      results.push({ page_id: p.page_id, page_name: p.page_name, subscriptions: apps, subscribed, status: subscribed ? 'ok' : 'not_subscribed', token_source: 'db_page_token' });
    } catch (e) {
      results.push({ page_id: p.page_id, page_name: p.page_name, subscriptions: null, subscribed: false, status: 'error', error: e.message, code: e.code || 'META_GRAPH_ERROR', token_source: 'db_page_token' });
    }
  }
  res.json({ success: true, data: results });
}));

// Campaign enriched list (with lead stats from DB)
router.get('/admin/meta/campaigns-enriched', authenticate, requireRole('super_admin'), responseCache(15000), asyncHandler(async (_req, res) => {
  const { rows } = await query(`
    SELECT mc.id, mc.campaign_id, mc.campaign_name, mc.internal_label, mc.ad_account_id,
      mc.is_active, mc.category, mc.description, mc.created_at,
      mc.meta_status, mc.effective_status, mc.configured_status, mc.objective,
      mc.buying_type, mc.start_time, mc.stop_time, mc.meta_created_time,
      mc.meta_updated_time, mc.source, mc.last_meta_status_checked_at,
      (SELECT COUNT(*)::int FROM leads l WHERE l.deleted_at IS NULL AND l.meta_campaign_id = mc.campaign_id) AS lead_count,
      (SELECT COUNT(*)::int FROM leads l WHERE l.deleted_at IS NULL AND l.meta_campaign_id = mc.campaign_id AND (COALESCE(l.meta_created_time, l.created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_leads,
      (SELECT COUNT(*)::int FROM leads l WHERE l.deleted_at IS NULL AND l.meta_campaign_id = mc.campaign_id AND l.call_status = 'converted') AS conversions,
      (SELECT COUNT(*)::int FROM leads l WHERE l.deleted_at IS NULL AND l.meta_campaign_id = mc.campaign_id AND l.is_pending = TRUE) AS pending_leads,
      (SELECT MAX(l.created_at) FROM leads l WHERE l.deleted_at IS NULL AND l.meta_campaign_id = mc.campaign_id) AS last_lead_at,
      (SELECT DISTINCT f.form_name FROM meta_forms f WHERE f.campaign_label = mc.internal_label LIMIT 1) AS connected_form,
      (SELECT p.page_name FROM meta_pages p WHERE p.page_id = (
        SELECT f2.page_id FROM meta_forms f2 WHERE f2.campaign_label = mc.internal_label LIMIT 1
      )) AS connected_page
    FROM meta_campaigns mc
    ORDER BY mc.is_active DESC, mc.last_meta_status_checked_at DESC NULLS LAST, lead_count DESC
  `);
  res.json({ success: true, data: rows });
}));

// ══════════════════════════════════════════════════════════════════════
// MEMBER LEAD WORKFLOW — 4-step sequential workflow system
// ══════════════════════════════════════════════════════════════════════

const REMARK_OPTIONS = [
  'communication_completed', 'recall', 'respond_hi', 'cnr',
  'so', 'cw', 'nn', 'nc', 'ni', 'in', 'cb',
  'session_730_attend', 'yes_after_730_session'
];

// Final lead-level set — UH and HU removed; ALL Partner/ALL Trader are the
// canonical "everyone" buckets. Order matches the admin-spec final list.
const LEAD_LEVEL_OPTIONS = [
  'new_partner', 'hot_partner', 'all_partner', 'followup_partner', 'cold_partner',
  'advance_payment',
  'new_trader', 'hot_trader', 'all_trader', 'followup_trader', 'cold_trader',
  'closed',
];

// GET workflow state for a lead
router.get('/leads/:id/workflow', authenticate, asyncHandler(async (req, res) => {
  const leadId = req.params.id;

  const { rows: [lead] } = await query(
    `SELECT id, assigned_to_user_id FROM leads WHERE id = $1 AND deleted_at IS NULL`, [leadId]
  );
  if (!lead) throw new AppError(404, 'NOT_FOUND', 'Lead not found');

  if (req.user.role === 'member' && lead.assigned_to_user_id !== req.user.id) {
    throw new AppError(403, 'FORBIDDEN', 'Lead not assigned to you');
  }

  const { rows: [wf] } = await query(
    `SELECT * FROM lead_workflow WHERE lead_id = $1`, [leadId]
  );
  const { rows: [ft] } = await query(
    `SELECT * FROM lead_followup_tracker WHERE lead_id = $1`, [leadId]
  );
  const { rows: [conv] } = await query(
    `SELECT * FROM lead_conversion WHERE lead_id = $1`, [leadId]
  );

  const currentStep = !wf?.remark_status ? 1
    : !wf?.lead_level ? 2
    : !wf?.followup_completed ? 3
    : !wf?.conversion_completed ? 4
    : 5;

  res.json({
    success: true,
    data: {
      workflow: wf || null,
      followup_tracker: ft || null,
      conversion: conv || null,
      current_step: currentStep,
      remark_options: REMARK_OPTIONS,
      lead_level_options: LEAD_LEVEL_OPTIONS,
    },
  });
}));

// Step 1: Save remark status
router.post('/leads/:id/workflow/remark', authenticate, asyncHandler(async (req, res) => {
  const leadId = req.params.id;
  const { remark_status } = req.body;
  if (!remark_status) throw new AppError(400, 'INVALID', 'remark_status required');

  const { rows: [lead] } = await query(
    `SELECT id, assigned_to_user_id FROM leads WHERE id = $1 AND deleted_at IS NULL`, [leadId]
  );
  if (!lead) throw new AppError(404, 'NOT_FOUND', 'Lead not found');
  if (req.user.role === 'member' && lead.assigned_to_user_id !== req.user.id) {
    throw new AppError(403, 'FORBIDDEN', 'Lead not assigned to you');
  }

  const { rows: [wf] } = await query(`
    INSERT INTO lead_workflow (lead_id, user_id, remark_status, remark_saved_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (lead_id) DO UPDATE SET
      remark_status = $3, remark_saved_at = NOW(), updated_at = NOW()
    RETURNING *
  `, [leadId, req.user.id, remark_status]);

  await query(`
    INSERT INTO lead_workflow_history (lead_id, user_id, step, action, new_value)
    VALUES ($1, $2, 1, 'remark_saved', $3)
  `, [leadId, req.user.id, remark_status]);

  {
    const { logActivity } = require('../utils/auditLog');
    await logActivity(req, {
      entity: 'lead', entity_id: leadId, action: 'remark_saved',
      new_value: remark_status,
      metadata: { step: 1 },
    });
  }

  res.json({ success: true, data: wf });
}));

// Step 2: Save lead level
router.post('/leads/:id/workflow/level', authenticate, asyncHandler(async (req, res) => {
  const leadId = req.params.id;
  const { lead_level } = req.body;
  if (!lead_level) throw new AppError(400, 'INVALID', 'lead_level required');

  const { rows: [lead] } = await query(
    `SELECT id, assigned_to_user_id FROM leads WHERE id = $1 AND deleted_at IS NULL`, [leadId]
  );
  if (!lead) throw new AppError(404, 'NOT_FOUND', 'Lead not found');
  if (req.user.role === 'member' && lead.assigned_to_user_id !== req.user.id) {
    throw new AppError(403, 'FORBIDDEN', 'Lead not assigned to you');
  }

  const { rows: [existing] } = await query(
    `SELECT remark_status FROM lead_workflow WHERE lead_id = $1`, [leadId]
  );
  if (!existing?.remark_status) {
    throw new AppError(400, 'STEP_LOCKED', 'Complete Step 1 (Remark) first');
  }

  const { rows: [wf] } = await query(`
    UPDATE lead_workflow SET lead_level = $1, lead_level_saved_at = NOW(), updated_at = NOW()
    WHERE lead_id = $2 RETURNING *
  `, [lead_level, leadId]);

  await query(`
    INSERT INTO lead_workflow_history (lead_id, user_id, step, action, new_value)
    VALUES ($1, $2, 2, 'level_saved', $3)
  `, [leadId, req.user.id, lead_level]);

  {
    const { logActivity } = require('../utils/auditLog');
    await logActivity(req, {
      entity: 'lead', entity_id: leadId, action: 'level_saved',
      old_value: existing?.remark_status || null,
      new_value: lead_level,
      metadata: { step: 2 },
    });
  }

  res.json({ success: true, data: wf });
}));

// Step 3: Update follow-up tracker checkboxes
router.patch('/leads/:id/workflow/followup', authenticate, asyncHandler(async (req, res) => {
  const leadId = req.params.id;
  const fields = req.body;

  const { rows: [lead] } = await query(
    `SELECT id, assigned_to_user_id FROM leads WHERE id = $1 AND deleted_at IS NULL`, [leadId]
  );
  if (!lead) throw new AppError(404, 'NOT_FOUND', 'Lead not found');
  if (req.user.role === 'member' && lead.assigned_to_user_id !== req.user.id) {
    throw new AppError(403, 'FORBIDDEN', 'Lead not assigned to you');
  }

  const { rows: [existing] } = await query(
    `SELECT lead_level FROM lead_workflow WHERE lead_id = $1`, [leadId]
  );
  if (!existing?.lead_level) {
    throw new AppError(400, 'STEP_LOCKED', 'Complete Step 2 (Lead Level) first');
  }

  const allowed = [
    'attendance_730', 'yes_confirmation',
    'day_1', 'day_2', 'day_3', 'day_4', 'day_5', 'day_6', 'day_7',
    'day_8', 'day_9', 'day_10', 'day_11', 'day_12', 'day_13', 'day_14', 'day_15'
  ];
  const forceComplete = !!fields._force_complete;

  const sets = [];
  const params = [leadId];
  const changedFields = [];

  for (const f of allowed) {
    if (fields[f] !== undefined) {
      const val = !!fields[f];
      params.push(val);
      sets.push(`${f} = $${params.length}`);
      if (val) {
        sets.push(`${f}_at = NOW()`);
      }
      changedFields.push(`${f}=${val}`);
    }
  }

  if (sets.length === 0 && !forceComplete) throw new AppError(400, 'INVALID', 'No valid fields to update');
  if (sets.length > 0) sets.push('updated_at = NOW()');

  // Ensure row exists first
  await query(
    `INSERT INTO lead_followup_tracker (lead_id, user_id) VALUES ($1, $2) ON CONFLICT (lead_id) DO NOTHING`,
    [leadId, req.user.id]
  );

  let ft;
  if (sets.length > 0) {
    const { rows: [row] } = await query(
      `UPDATE lead_followup_tracker SET ${sets.join(', ')} WHERE lead_id = $1 RETURNING *`,
      params
    );
    ft = row;
  } else {
    const { rows: [row] } = await query(
      `SELECT * FROM lead_followup_tracker WHERE lead_id = $1`, [leadId]
    );
    ft = row;
  }

  // Step 3 unlocks Step 4 the moment ANY one follow-up option is selected
  // (any single day, attendance, or yes-confirmation). The frontend mirrors
  // this rule; admin/RM/partner/member all share the same loose gate.
  const anySelection = allowed.some(k => !!ft[k]);
  const shouldComplete = forceComplete && anySelection;

  if (shouldComplete) {
    await query(`
      UPDATE lead_workflow SET followup_completed = TRUE, followup_completed_at = NOW(), updated_at = NOW()
      WHERE lead_id = $1
    `, [leadId]);
  }

  await query(`
    INSERT INTO lead_workflow_history (lead_id, user_id, step, action, new_value, metadata)
    VALUES ($1, $2, 3, $3, $4, $5)
  `, [leadId, req.user.id, shouldComplete ? 'followup_completed' : 'followup_updated',
      changedFields.join(','), JSON.stringify(fields)]);

  res.json({ success: true, data: { followup_tracker: ft, all_complete: shouldComplete } });
}));

// Step 3: Mark follow-up complete manually (admin/RM override)
router.post('/leads/:id/workflow/followup/complete', authenticate, requireRole('super_admin', 'rm'), asyncHandler(async (req, res) => {
  const leadId = req.params.id;

  await query(`
    UPDATE lead_workflow SET followup_completed = TRUE, followup_completed_at = NOW(), updated_at = NOW()
    WHERE lead_id = $1
  `, [leadId]);

  await query(`
    INSERT INTO lead_workflow_history (lead_id, user_id, step, action, new_value)
    VALUES ($1, $2, 3, 'followup_force_completed', 'admin_override')
  `, [leadId, req.user.id]);

  res.json({ success: true });
}));

// Step 4: Save conversion data
router.post('/leads/:id/workflow/conversion', authenticate, asyncHandler(async (req, res) => {
  const leadId = req.params.id;
  const { followup_status, address, total_payment, part_payment, customer_type, services } = req.body;

  if (!customer_type || !['partner', 'trader'].includes(customer_type)) {
    throw new AppError(400, 'INVALID', 'customer_type must be partner or trader');
  }

  const { rows: [lead] } = await query(
    `SELECT id, assigned_to_user_id FROM leads WHERE id = $1 AND deleted_at IS NULL`, [leadId]
  );
  if (!lead) throw new AppError(404, 'NOT_FOUND', 'Lead not found');
  if (req.user.role === 'member' && lead.assigned_to_user_id !== req.user.id) {
    throw new AppError(403, 'FORBIDDEN', 'Lead not assigned to you');
  }

  const { rows: [existing] } = await query(
    `SELECT followup_completed FROM lead_workflow WHERE lead_id = $1`, [leadId]
  );
  if (!existing?.followup_completed) {
    throw new AppError(400, 'STEP_LOCKED', 'Complete Step 3 (Follow-up Tracker) first');
  }

  const { rows: [conv] } = await query(`
    INSERT INTO lead_conversion (lead_id, user_id, followup_status, address, total_payment, part_payment, customer_type, services)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (lead_id) DO UPDATE SET
      followup_status = $3, address = $4, total_payment = $5, part_payment = $6,
      customer_type = $7, services = $8,
      submitted_at = NOW(), updated_at = NOW()
    RETURNING *
  `, [leadId, req.user.id, followup_status || null, address || null,
      total_payment || null, part_payment || null,
      customer_type, services || null]);

  await query(`
    UPDATE lead_workflow SET conversion_completed = TRUE, conversion_completed_at = NOW(), updated_at = NOW()
    WHERE lead_id = $1
  `, [leadId]);

  await query(`
    UPDATE leads SET stage = 'won', call_status = 'converted', updated_at = NOW()
    WHERE id = $1
  `, [leadId]);

  await query(`
    INSERT INTO lead_workflow_history (lead_id, user_id, step, action, new_value, metadata)
    VALUES ($1, $2, 4, 'conversion_submitted', $3, $4)
  `, [leadId, req.user.id, customer_type, JSON.stringify({ total_payment, part_payment, services })]);

  {
    const { logActivity } = require('../utils/auditLog');
    await logActivity(req, {
      entity: 'lead', entity_id: leadId, action: 'converted',
      new_value: customer_type,
      metadata: { step: 4, total_payment, part_payment, services, followup_status },
    });
  }

  res.json({ success: true, data: conv });
}));

// ═══════════════════════════════════════════════════════════════════════
// STEP 4 — Conversion attachments (payment screenshot, receipt, UTR)
// ═══════════════════════════════════════════════════════════════════════
const fsx = require('fs');
const pathx = require('path');
const cryptox = require('crypto');

// Disk-backed multer storage under backend/uploads/payments/<leadId>/
const paymentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const leadId = req.params.id;
      const dir = pathx.resolve(__dirname, '..', '..', 'uploads', 'payments', leadId);
      fsx.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
    },
    filename: (_req, file, cb) => {
      const ext = (pathx.extname(file.originalname || '') || '').slice(0, 8);
      const safe = cryptox.randomBytes(12).toString('hex') + ext;
      cb(null, safe);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 3 }, // 8 MB per file, 3 per request
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(png|jpe?g|webp|gif|heic|heif)$/i.test(file.mimetype || '')
            || /^application\/pdf$/i.test(file.mimetype || '')
            || /\.(png|jpe?g|webp|gif|heic|heif|pdf)$/i.test(file.originalname || '');
    cb(ok ? null : new AppError(400, 'BAD_FILE', 'Only images or PDF allowed'), ok);
  },
});

function leadAccessGuard(user, lead) {
  if (user.role === 'super_admin') return true;
  if (user.role === 'rm') {
    // RM can manage attachments for leads assigned to their team
    // (full team scoping is done in the calling query, so accept here)
    return true;
  }
  return lead.assigned_to_user_id === user.id;
}

// Upload (1 to 3 files at once). Field name: `files` (multiple) OR `file` (single).
// Form fields: kind, note
router.post('/leads/:id/workflow/conversion/attachments',
  authenticate,
  (req, res, next) => paymentUpload.array('files', 3)(req, res, (err) => err ? next(err) : next()),
  asyncHandler(async (req, res) => {
    const leadId = req.params.id;
    const { rows: [lead] } = await query(`SELECT id, assigned_to_user_id FROM leads WHERE id = $1 AND deleted_at IS NULL`, [leadId]);
    if (!lead) throw new AppError(404, 'NOT_FOUND', 'Lead not found');
    if (!leadAccessGuard(req.user, lead)) throw new AppError(403, 'FORBIDDEN', 'You cannot upload attachments for this lead');

    const files = req.files || [];
    if (!files.length) throw new AppError(400, 'NO_FILES', 'No files uploaded');

    const kind = ['payment_screenshot', 'receipt', 'utr', 'other'].includes(req.body?.kind) ? req.body.kind : 'payment_screenshot';
    const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;

    // Tie the attachments to the lead's conversion row if it already exists
    const { rows: [conv] } = await query(`SELECT id FROM lead_conversion WHERE lead_id = $1`, [leadId]);

    const inserted = [];
    for (const f of files) {
      const relPath = `payments/${leadId}/${pathx.basename(f.path)}`;
      const { rows: [row] } = await query(
        `INSERT INTO lead_payment_attachments
           (lead_id, conversion_id, user_id, kind, file_name, file_path, mime_type, size_bytes, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, kind, file_name, file_path, mime_type, size_bytes, note, uploaded_at`,
        [leadId, conv?.id || null, req.user.id, kind, f.originalname || pathx.basename(f.path), relPath, f.mimetype, f.size, note],
      );
      inserted.push({ ...row, url: '/uploads/' + relPath });
    }

    // Audit trail
    await query(
      `INSERT INTO lead_workflow_history (lead_id, user_id, step, action, new_value, metadata)
         VALUES ($1, $2, 4, 'attachment_uploaded', $3, $4)`,
      [leadId, req.user.id, kind, JSON.stringify({ files: inserted.map(a => ({ name: a.file_name, size: a.size_bytes })) })],
    ).catch(() => {});

    res.status(201).json({ success: true, data: inserted });
  }),
);

// List attachments for a lead
router.get('/leads/:id/workflow/conversion/attachments', authenticate, asyncHandler(async (req, res) => {
  const leadId = req.params.id;
  const { rows: [lead] } = await query(`SELECT id, assigned_to_user_id FROM leads WHERE id = $1 AND deleted_at IS NULL`, [leadId]);
  if (!lead) throw new AppError(404, 'NOT_FOUND', 'Lead not found');
  if (!leadAccessGuard(req.user, lead)) throw new AppError(403, 'FORBIDDEN', 'No access');

  const { rows } = await query(
    `SELECT a.id, a.kind, a.file_name, a.file_path, a.mime_type, a.size_bytes, a.note, a.uploaded_at,
            u.full_name AS uploaded_by_name
       FROM lead_payment_attachments a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.lead_id = $1 AND a.deleted_at IS NULL
      ORDER BY a.uploaded_at DESC`,
    [leadId],
  );
  res.json({ success: true, data: rows.map(r => ({ ...r, url: '/uploads/' + r.file_path })) });
}));

// Delete one attachment (soft-delete DB row + remove file from disk)
router.delete('/leads/:id/workflow/conversion/attachments/:attId', authenticate, asyncHandler(async (req, res) => {
  const { id: leadId, attId } = req.params;
  const { rows: [a] } = await query(
    `SELECT a.id, a.user_id, a.file_path, l.assigned_to_user_id
       FROM lead_payment_attachments a
       JOIN leads l ON l.id = a.lead_id
      WHERE a.id = $1 AND a.lead_id = $2 AND a.deleted_at IS NULL`,
    [attId, leadId],
  );
  if (!a) throw new AppError(404, 'NOT_FOUND', 'Attachment not found');
  // Member can only delete their own uploads; RM/admin can delete any in scope
  if (req.user.role === 'member' && a.user_id !== req.user.id) {
    throw new AppError(403, 'FORBIDDEN', 'You can only delete your own uploads');
  }
  await query(`UPDATE lead_payment_attachments SET deleted_at = NOW() WHERE id = $1`, [attId]);
  // Best-effort disk cleanup — don't fail the request if it errors
  try {
    const full = pathx.resolve(__dirname, '..', '..', 'uploads', a.file_path);
    fsx.unlink(full, () => {});
  } catch (_) { /* ignore */ }
  res.json({ success: true, data: { deleted: attId } });
}));

// GET workflow history (audit trail)
router.get('/leads/:id/workflow/history', authenticate, asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT h.*, u.full_name AS user_name
    FROM lead_workflow_history h
    JOIN users u ON u.id = h.user_id
    WHERE h.lead_id = $1
    ORDER BY h.created_at DESC
    LIMIT 50
  `, [req.params.id]);
  res.json({ success: true, data: rows });
}));

// Admin/RM: Bulk workflow status for multiple leads
router.get('/workflow/summary', authenticate, requireRole('super_admin', 'rm'), asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, parseInt(req.query.limit || '50', 10));
  const offset = (page - 1) * limit;
  const stepFilter = req.query.step ? parseInt(req.query.step) : null;
  const userId = req.query.user_id;

  let where = 'WHERE l.deleted_at IS NULL AND l.assigned_to_user_id IS NOT NULL';
  const params = [];

  if (req.user.role === 'rm') {
    params.push(req.user.id);
    where += ` AND l.assigned_to_user_id IN (SELECT id FROM users WHERE report_to_id = $${params.length})`;
  }
  if (userId) {
    params.push(userId);
    where += ` AND l.assigned_to_user_id = $${params.length}`;
  }

  let having = '';
  if (stepFilter) {
    having = `HAVING (CASE
      WHEN wf.remark_status IS NULL THEN 1
      WHEN wf.lead_level IS NULL THEN 2
      WHEN wf.followup_completed IS NOT TRUE THEN 3
      WHEN wf.conversion_completed IS NOT TRUE THEN 4
      ELSE 5 END) = ${stepFilter}`;
  }

  const { rows: [{ total }] } = await query(`
    SELECT COUNT(*) AS total FROM leads l
    LEFT JOIN lead_workflow wf ON wf.lead_id = l.id
    ${where}
    ${stepFilter ? `AND (CASE
      WHEN wf.remark_status IS NULL THEN 1
      WHEN wf.lead_level IS NULL THEN 2
      WHEN wf.followup_completed IS NOT TRUE THEN 3
      WHEN wf.conversion_completed IS NOT TRUE THEN 4
      ELSE 5 END) = ${stepFilter}` : ''}
  `, params);

  params.push(limit, offset);
  const { rows } = await query(`
    SELECT l.id AS lead_id, l.full_name, l.phone, l.category,
           l.assigned_to_user_id, u.full_name AS assigned_to_name, u.team_name,
           wf.remark_status, wf.lead_level, wf.followup_completed, wf.conversion_completed,
           wf.remark_saved_at, wf.lead_level_saved_at, wf.followup_completed_at, wf.conversion_completed_at,
           CASE
             WHEN wf.remark_status IS NULL THEN 1
             WHEN wf.lead_level IS NULL THEN 2
             WHEN wf.followup_completed IS NOT TRUE THEN 3
             WHEN wf.conversion_completed IS NOT TRUE THEN 4
             ELSE 5
           END AS current_step
    FROM leads l
    LEFT JOIN lead_workflow wf ON wf.lead_id = l.id
    LEFT JOIN users u ON u.id = l.assigned_to_user_id
    ${where}
    ${stepFilter ? `AND (CASE
      WHEN wf.remark_status IS NULL THEN 1
      WHEN wf.lead_level IS NULL THEN 2
      WHEN wf.followup_completed IS NOT TRUE THEN 3
      WHEN wf.conversion_completed IS NOT TRUE THEN 4
      ELSE 5 END) = ${stepFilter}` : ''}
    ORDER BY COALESCE(wf.updated_at, l.created_at) DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  res.json({ success: true, data: { rows, total: parseInt(total, 10), page } });
}));

// Role-scoped workflow stats overview
router.get('/workflow/stats', authenticate, requireRole('super_admin', 'admin', 'rm', 'member', 'partner'), asyncHandler(async (req, res) => {
  let scope = '';
  const params = [];
  let scopeName = 'all';
  if (req.user.role === 'rm') {
    params.push(req.user.id);
    scopeName = 'team';
    scope = `AND l.assigned_to_user_id IN (SELECT id FROM users WHERE report_to_id = $1)`;
  } else if (req.user.role === 'member' || req.user.role === 'partner') {
    params.push(req.user.id);
    scopeName = 'own';
    scope = `AND l.assigned_to_user_id = $1`;
  }

  const { rows: [s] } = await query(`
    SELECT
      (SELECT COUNT(*) FROM leads l WHERE l.deleted_at IS NULL AND l.assigned_to_user_id IS NOT NULL ${scope}) AS total_assigned,
      (SELECT COUNT(*) FROM leads l LEFT JOIN lead_workflow wf ON wf.lead_id = l.id
        WHERE l.deleted_at IS NULL AND l.assigned_to_user_id IS NOT NULL ${scope}
        AND (wf.remark_status IS NULL OR wf.id IS NULL)) AS step1_pending,
      (SELECT COUNT(*) FROM leads l LEFT JOIN lead_workflow wf ON wf.lead_id = l.id
        WHERE l.deleted_at IS NULL AND l.assigned_to_user_id IS NOT NULL ${scope}
        AND (wf.remark_status IS NOT NULL OR wf.id IS NULL) AND (wf.lead_level IS NULL OR wf.id IS NULL)) AS step2_pending,
      (SELECT COUNT(*) FROM leads l LEFT JOIN lead_workflow wf ON wf.lead_id = l.id
        WHERE l.deleted_at IS NULL AND l.assigned_to_user_id IS NOT NULL ${scope}
        AND (wf.lead_level IS NULL OR wf.id IS NULL)) AS step3_pending,
      (SELECT COUNT(*) FROM leads l LEFT JOIN lead_workflow wf ON wf.lead_id = l.id
        WHERE l.deleted_at IS NULL AND l.assigned_to_user_id IS NOT NULL ${scope}
        AND (wf.followup_completed IS NOT TRUE OR wf.id IS NULL)) AS step4_pending,
      (SELECT COUNT(*) FROM leads l LEFT JOIN lead_workflow wf ON wf.lead_id = l.id
        WHERE l.deleted_at IS NULL AND l.assigned_to_user_id IS NOT NULL ${scope}
        AND (wf.conversion_completed IS NOT TRUE OR wf.id IS NULL)) AS completed,
      (SELECT COUNT(*) FROM lead_workflow_history h
        JOIN leads l ON l.id = h.lead_id
        WHERE (h.created_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date ${scope}) AS today_actions
  `, params);

  const data = {};
  for (const [k, v] of Object.entries(s)) data[k] = parseInt(v, 10) || 0;
  res.json({ success: true, scope: scopeName, data });
}));

// Admin: Edit any workflow step (override)
router.patch('/leads/:id/workflow/admin-edit', authenticate, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const leadId = req.params.id;
  const { remark_status, lead_level, followup_completed, conversion_completed } = req.body;

  const sets = ['updated_at = NOW()'];
  const params = [leadId];

  if (remark_status !== undefined) {
    params.push(remark_status);
    sets.push(`remark_status = $${params.length}`, 'remark_saved_at = NOW()');
  }
  if (lead_level !== undefined) {
    params.push(lead_level);
    sets.push(`lead_level = $${params.length}`, 'lead_level_saved_at = NOW()');
  }
  if (followup_completed !== undefined) {
    params.push(followup_completed);
    sets.push(`followup_completed = $${params.length}`, 'followup_completed_at = NOW()');
  }
  if (conversion_completed !== undefined) {
    params.push(conversion_completed);
    sets.push(`conversion_completed = $${params.length}`, 'conversion_completed_at = NOW()');
  }

  await query(
    `INSERT INTO lead_workflow (lead_id, user_id) VALUES ($1, $2) ON CONFLICT (lead_id) DO NOTHING`,
    [leadId, req.user.id]
  );
  const { rows: [wf] } = await query(
    `UPDATE lead_workflow SET ${sets.join(', ')} WHERE lead_id = $1 RETURNING *`,
    params
  );

  await query(`
    INSERT INTO lead_workflow_history (lead_id, user_id, step, action, new_value, metadata)
    VALUES ($1, $2, 0, 'admin_edit', 'override', $3)
  `, [leadId, req.user.id, JSON.stringify(req.body)]);

  res.json({ success: true, data: wf });
}));

module.exports = router;
