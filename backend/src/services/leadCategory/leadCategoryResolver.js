const repository = require('../../repositories/leadCategoryRepository');

const CATEGORIES = new Set(['trader', 'partner', 'unknown']);
const LABELS = { trader: 'Trader Lead', partner: 'Partner Lead', unknown: 'Unknown' };
const PAYLOAD_FIELDS = ['category', 'lead_type', 'enquiry_type', 'campaign_type'];
const DEFAULT_KEYWORDS = {
  partner: ['partner', 'franchise', 'business partner', 'channel partner', 'dealership', 'distributor', 'agency', 'reseller'],
  trader: ['trader', 'trade', 'stockist', 'dealer', 'buyer', 'seller', 'merchant'],
};

function normalizeCategory(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return CATEGORIES.has(normalized) ? normalized : null;
}

function result(category, source, reason, ruleId = null) {
  const safeCategory = normalizeCategory(category) || 'unknown';
  return { category: safeCategory, label: LABELS[safeCategory], source, rule_id: ruleId, reason };
}

function matches(value, rule) {
  const input = String(value || '');
  const expected = String(rule.match_value || '');
  if (!input || !expected) return false;
  if (rule.match_mode === 'regex') {
    try { return new RegExp(expected, 'i').test(input); } catch { return false; }
  }
  if (rule.match_mode === 'contains') return input.toLowerCase().includes(expected.toLowerCase());
  return input.toLowerCase() === expected.toLowerCase();
}

function sourceValue(sourceType, context) {
  const payload = context.leadPayload || {};
  const values = {
    campaign_id: payload.meta_campaign_id || payload.campaign_id,
    campaign_name: payload.campaign_name || context.campaign?.campaign_name,
    form_id: payload.meta_form_id || payload.form_id,
    form_name: payload.form_name || context.form?.form_name,
    page_id: payload.meta_page_id || payload.page_id || context.form?.page_id,
    ad_account_id: payload.ad_account_id || context.campaign?.ad_account_id,
  };
  if (sourceType === 'payload_field') return PAYLOAD_FIELDS.map(key => payload[key]).filter(Boolean).join(' ');
  return values[sourceType];
}

async function resolveLeadCategory(input = {}) {
  const leadPayload = input.leadPayload || {};
  const metaCampaignId = leadPayload.meta_campaign_id || leadPayload.campaign_id;
  const metaFormId = leadPayload.meta_form_id || leadPayload.form_id;
  const loaded = input.rules && (input.campaign !== undefined || input.form !== undefined)
    ? { campaign: input.campaign || null, form: input.form || null, rules: input.rules || [] }
    : await repository.getContext({ metaCampaignId, metaFormId });
  const context = { ...input, leadPayload, campaign: input.campaign || loaded.campaign, form: input.form || loaded.form, rules: input.rules || loaded.rules };

  const existing = normalizeCategory(context.existingLead?.category);
  if (context.existingLead?.category_source === 'manual_override' && existing && existing !== 'unknown') {
    return result(existing, 'manual_override', 'Preserved administrator manual override');
  }
  const campaignCategory = normalizeCategory(context.campaign?.category);
  if (campaignCategory && campaignCategory !== 'unknown') return result(campaignCategory, 'campaign_mapping', 'Resolved from admin-saved campaign category');
  const formCategory = normalizeCategory(context.form?.lead_category);
  if (formCategory && formCategory !== 'unknown') return result(formCategory, 'form_mapping', 'Resolved from admin-saved form category');

  const ruleTypes = ['campaign_id', 'form_id', 'campaign_name', 'form_name', 'page_id', 'ad_account_id', 'payload_field'];
  for (const sourceType of ruleTypes) {
    const rule = context.rules.find(candidate => candidate.source_type === sourceType && matches(sourceValue(sourceType, context), candidate));
    if (rule) return result(rule.category, `rule_${sourceType}`, `Matched ${sourceType} rule: ${rule.rule_name}`, rule.id);
  }

  const campaignName = String(sourceValue('campaign_name', context) || '').toLowerCase();
  const formName = String(sourceValue('form_name', context) || '').toLowerCase();
  for (const [category, keywords] of Object.entries(DEFAULT_KEYWORDS)) {
    const campaignKeyword = keywords.find(keyword => campaignName.includes(keyword));
    if (campaignKeyword) return result(category, 'rule_campaign_name', `Campaign name contains ${campaignKeyword}`);
    const formKeyword = keywords.find(keyword => formName.includes(keyword));
    if (formKeyword) return result(category, 'rule_form_name', `Form name contains ${formKeyword}`);
  }

  for (const key of PAYLOAD_FIELDS) {
    const payloadCategory = normalizeCategory(leadPayload[key]);
    if (payloadCategory) return result(payloadCategory, 'payload_field', `Resolved from lead payload field ${key}`);
  }

  if (existing && existing !== 'unknown') return result(existing, 'existing_category', 'Preserved existing meaningful lead category');
  return result('unknown', 'unknown', 'No category mapping or rule matched');
}

async function resolveAndPersistLeadCategory(leadId, context = {}, options = {}) {
  const existingLead = context.existingLead || await repository.getLead(leadId, options.runner);
  if (!existingLead) return null;
  const resolution = await resolveLeadCategory({ ...context, existingLead });
  if (resolution.category === 'unknown' && ['trader', 'partner'].includes(existingLead.category)) return resolution;
  await repository.persistResolution(leadId, resolution, options);
  return resolution;
}

module.exports = { CATEGORIES, LABELS, normalizeCategory, resolveLeadCategory, resolveAndPersistLeadCategory };
