const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler, AppError } = require('../utils/errors');
const service = require('../services/leadCategory/leadCategoryService');
const { logActivity } = require('../utils/auditLog');

router.use(authenticate, requireRole('super_admin', 'admin'));

router.get('/admin/lead-category-rules', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await service.listRules() });
}));

router.post('/admin/lead-category-rules/test', asyncHandler(async (req, res) => {
  const result = await service.testRule({ leadPayload: req.body || {} });
  res.json({ success: true, ...result, matched_by: result.source.replace(/^rule_/, '') });
}));

router.post('/admin/lead-category-rules', asyncHandler(async (req, res) => {
  const rule = await service.createRule(req.body || {}, req.user.id);
  await logActivity(req, { entity: 'lead_category_rule', entity_id: rule.id, action: 'created', metadata: { rule_id: rule.id, category: rule.category } });
  res.status(201).json({ success: true, data: rule });
}));

router.patch('/admin/lead-category-rules/:id', asyncHandler(async (req, res) => {
  const rule = await service.updateRule(req.params.id, req.body || {});
  if (!rule) throw new AppError(404, 'CATEGORY_RULE_NOT_FOUND', 'Category rule not found');
  await logActivity(req, { entity: 'lead_category_rule', entity_id: rule.id, action: 'updated', metadata: { rule_id: rule.id, category: rule.category } });
  res.json({ success: true, data: rule });
}));

router.delete('/admin/lead-category-rules/:id', asyncHandler(async (req, res) => {
  const rule = await service.deleteRule(req.params.id);
  if (!rule) throw new AppError(404, 'CATEGORY_RULE_NOT_FOUND', 'Category rule not found');
  await logActivity(req, { entity: 'lead_category_rule', entity_id: rule.id, action: 'deleted', metadata: { rule_id: rule.id, category: rule.category } });
  res.json({ success: true, data: { id: rule.id } });
}));

router.patch('/admin/campaigns/:campaignId/category', asyncHandler(async (req, res) => {
  const campaign = await service.updateCampaignCategory(req.params.campaignId, req.body || {}, req.user.id);
  await logActivity(req, { entity: 'campaign', entity_id: campaign.id, action: 'lead_category_updated', metadata: { meta_campaign_id: campaign.campaign_id, old_category: campaign.old_category, new_category: campaign.category, notes: req.body?.notes || null } });
  res.json({ success: true, campaign });
}));

router.patch('/admin/meta/forms/:formId/category', asyncHandler(async (req, res) => {
  const form = await service.updateFormCategory(req.params.formId, req.body || {}, req.user.id);
  await logActivity(req, { entity: 'meta_form', entity_id: form.id, action: 'lead_category_updated', metadata: { meta_form_id: form.form_id, new_category: form.lead_category, notes: req.body?.notes || null } });
  res.json({ success: true, data: form });
}));

router.post('/admin/campaigns/:campaignId/backfill-category', asyncHandler(async (req, res) => {
  const summary = await service.backfillCampaign(req.params.campaignId, req.body?.mode || 'dry_run');
  await logActivity(req, { entity: 'campaign', entity_id: null, action: 'lead_category_backfill', metadata: { meta_campaign_id: req.params.campaignId, ...summary } }).catch(() => {});
  res.json({ success: true, ...summary });
}));

router.patch('/admin/leads/:leadId/category', asyncHandler(async (req, res) => {
  const lead = await service.manuallyUpdateLead(req.params.leadId, req.body?.category, req.user.id);
  await logActivity(req, { entity: 'lead', entity_id: lead.id, action: 'category_manually_updated', metadata: { old_category: lead.old_category, new_category: lead.category, reason: req.body?.reason || null } });
  res.json({ success: true, data: lead });
}));

router.patch('/admin/leads/bulk-category', asyncHandler(async (req, res) => {
  const summary = await service.bulkUpdateLeads(req.body?.lead_ids, req.body?.category, req.user.id);
  await logActivity(req, { entity: 'lead', entity_id: null, action: 'category_bulk_updated', metadata: { new_category: req.body?.category, reason: req.body?.reason || null, ...summary } }).catch(() => {});
  res.json({ success: true, data: summary });
}));

module.exports = router;
