const repository = require('../../repositories/leadCategoryRepository');
const { AppError } = require('../../utils/errors');
const { normalizeCategory, resolveLeadCategory, LABELS } = require('./leadCategoryResolver');

const SOURCE_TYPES = new Set(['campaign_id','campaign_name','form_id','form_name','page_id','ad_account_id','payload_field']);
const MATCH_MODES = new Set(['exact','contains','regex']);

function requireCategory(value) {
  const category = normalizeCategory(value);
  if (!category) throw new AppError(400, 'INVALID_LEAD_CATEGORY', 'Category must be trader, partner, or unknown');
  return category;
}

function validateRule(input, partial = false) {
  if (!partial || input.rule_name !== undefined) if (!String(input.rule_name || '').trim()) throw new AppError(400, 'INVALID_CATEGORY_RULE', 'rule_name is required');
  if (!partial || input.source_type !== undefined) if (!SOURCE_TYPES.has(input.source_type)) throw new AppError(400, 'INVALID_CATEGORY_RULE', 'Invalid source_type');
  if (!partial || input.match_value !== undefined) if (!String(input.match_value || '').trim()) throw new AppError(400, 'INVALID_CATEGORY_RULE', 'match_value is required');
  if (input.match_value !== undefined && String(input.match_value).length > 200) throw new AppError(400, 'INVALID_CATEGORY_RULE', 'match_value is too long');
  if (input.match_mode !== undefined && !MATCH_MODES.has(input.match_mode)) throw new AppError(400, 'INVALID_CATEGORY_RULE', 'Invalid match_mode');
  if (!partial || input.category !== undefined) requireCategory(input.category);
  if (input.match_mode === 'regex') {
    try { new RegExp(input.match_value, 'i'); } catch { throw new AppError(400, 'INVALID_CATEGORY_RULE_REGEX', 'Invalid regular expression'); }
  }
}

async function createRule(input, userId) {
  validateRule(input);
  return repository.createRule({ ...input, match_mode: input.match_mode || 'exact', priority: Number(input.priority || 100), is_active: input.is_active !== false, notes: input.notes || null }, userId);
}

async function updateRule(id, input) { validateRule(input, true); return repository.updateRule(id, input); }

async function updateCampaignCategory(campaignId, input, userId) {
  const category = requireCategory(input.category);
  const previous = await repository.getCampaign(campaignId);
  const campaign = await repository.updateCampaignCategory(campaignId, category, input.notes, userId);
  if (!campaign) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');
  return { ...campaign, old_category: previous?.category || 'unknown', lead_category: category, lead_category_label: LABELS[category] };
}

async function updateFormCategory(formId, input, userId) {
  const category = requireCategory(input.category);
  const form = await repository.updateFormCategory(formId, category, input.notes, userId);
  if (!form) throw new AppError(404, 'FORM_NOT_FOUND', 'Lead form not found');
  return { ...form, lead_category_label: LABELS[category] };
}

async function backfillCampaign(campaignId, mode) {
  if (!['dry_run', 'unknown_only', 'force_all'].includes(mode)) throw new AppError(400, 'INVALID_BACKFILL_MODE', 'mode must be dry_run, unknown_only, or force_all');
  const campaign = await repository.getCampaign(campaignId);
  if (!campaign) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');
  const category = requireCategory(campaign.category);
  const summary = await repository.backfillCampaign(campaignId, category, mode);
  return { ...summary, category, category_label: LABELS[category], mode };
}

async function manuallyUpdateLead(leadId, category, userId) {
  const previous = await repository.getLead(leadId);
  const updated = await repository.manuallyUpdateLead(leadId, requireCategory(category), userId);
  if (!updated) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found');
  return { ...updated, old_category: previous?.category || 'unknown', category_label: LABELS[updated.category] };
}

async function bulkUpdateLeads(leadIds, category, userId) {
  if (!Array.isArray(leadIds) || !leadIds.length) throw new AppError(400, 'INVALID_LEAD_IDS', 'lead_ids must be a non-empty array');
  const updated = await repository.bulkUpdateLeads(leadIds, requireCategory(category), userId);
  return { requested: leadIds.length, updated: updated.length, skipped: leadIds.length - updated.length, lead_ids: updated.map(row => row.id) };
}

module.exports = {
  LABELS,
  listRules: repository.listRules,
  createRule,
  updateRule,
  deleteRule: repository.deleteRule,
  testRule: resolveLeadCategory,
  updateCampaignCategory,
  updateFormCategory,
  backfillCampaign,
  manuallyUpdateLead,
  bulkUpdateLeads,
};
