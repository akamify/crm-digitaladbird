/**
 * Meta Lead Ads integration.
 *
 * Flow:
 *   1. Meta sends GET /webhooks/meta?hub.verify_token=... -> we echo hub.challenge
 *   2. Meta sends POST /webhooks/meta with X-Hub-Signature-256 header
 *   3. We verify signature using META_APP_SECRET
 *   4. For each leadgen entry, we call Graph API /<lead_id> with page_access_token
 *      to fetch the full field data, then create + assign the lead.
 *
 * Docs: https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving
 */
const crypto = require('crypto');
const config = require('../config/env');
const { query, withTransaction } = require('../config/database');
const logger = require('../utils/logger');
const { isDistributionActive } = require('./distributionScheduler');
const assignmentEngine = require('./leadAssignmentEngine');
const { appendLead: sheetAppend } = require('./googleSheetsService');
const { onLeadCreated, findExistingByContact } = require('./leadEventService');
const { validateLead } = require('./leadValidator');
const metaTokens = require('./metaTokenResolver');
const { graphGet } = require('./metaGraphClient');

/** Constant-time HMAC compare of Meta webhook payloads. */
function verifySignature(rawBody, signatureHeader) {
  if (!signatureHeader || !config.meta.appSecret) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', config.meta.appSecret)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch { return false; }
}

/**
 * Fetch lead detail by leadgen_id using the Page's access token.
 * Returns the raw object: { id, created_time, ad_id, form_id, field_data: [...] }
 */
async function fetchLeadFromGraph(leadgenId, pageAccessToken) {
  return graphGet(leadgenId, {
    fields: 'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data,platform',
  }, pageAccessToken, { tokenSource: 'db_page_token' });
}

/** Look up our stored page access token for a page_id (set via /api/meta/pages). */
async function getPageAccessToken(pageId) {
  const resolved = await metaTokens.getPageTokenByPageId(pageId);
  return resolved?.token || null;
}

/** Convert Meta field_data array to { full_name, email, phone, city, state, ... }. */
function parseFieldData(fieldData = []) {
  const out = {};
  for (const { name, values } of fieldData) {
    const v = Array.isArray(values) ? values[0] : values;
    const key = (name || '').toLowerCase();
    if      (['full_name', 'name', 'first_name'].includes(key)) out.full_name = (out.full_name || '') + ' ' + v;
    else if (['last_name'].includes(key))                       out.full_name = (out.full_name || '') + ' ' + v;
    else if (['email'].includes(key))                           out.email     = v;
    else if (['phone_number', 'phone'].includes(key))           out.phone     = v;
    else if (['city'].includes(key))                            out.city      = v;
    else if (['state'].includes(key))                           out.state     = v;
    else { out.custom = out.custom || {}; out.custom[name] = v; }
  }
  if (out.full_name) out.full_name = out.full_name.trim();
  return out;
}

/**
 * Ingest a single leadgen event. Idempotent on meta_lead_id (unique constraint).
 */
async function ingestLeadgenEvent({ leadgen_id, page_id, form_id, created_time }) {
  const ctx = { leadgen_id, page_id, form_id };
  logger.info({ ...ctx, step: 'A.enter' }, '[meta-ingest]');

  // Fast path: same leadgen_id already in DB
  const dup = await query(`SELECT id FROM leads WHERE meta_lead_id = $1`, [leadgen_id]);
  if (dup.rowCount > 0) {
    logger.info({ ...ctx, step: 'B.dup_meta_lead_id', existing_lead: dup.rows[0].id }, '[meta-ingest] already ingested');
    return { status: 'duplicate', leadId: dup.rows[0].id, reason: 'meta_lead_id' };
  }

  const token = await getPageAccessToken(page_id);
  if (!token) {
    logger.error({ ...ctx, step: 'C.no_token' }, '[meta-ingest] No active page access token in meta_pages for this page_id. Add the page + a leads_retrieval token via POST /api/meta/pages.');
    return { status: 'no_token' };
  }
  logger.info({ ...ctx, step: 'C.token_ok' }, '[meta-ingest]');

  let detail;
  try {
    detail = await graphGet(leadgen_id, {
      fields: 'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data,platform',
    }, token, { pageId: page_id, tokenSource: 'db_page_token' });
    logger.info({ ...ctx, step: 'D.graph_ok', campaign_id: detail.campaign_id, ad_id: detail.ad_id, fields: detail.field_data?.length || 0 }, '[meta-ingest]');
  } catch (err) {
    logger.error({ ...ctx, step: 'D.graph_failed', err: err.message }, '[meta-ingest] Graph API rejected the lead lookup — token likely expired or missing leads_retrieval scope.');
    throw err;
  }

  const fields = parseFieldData(detail.field_data);
  logger.info({ ...ctx, step: 'E.parsed', has_name: !!fields.full_name, has_phone: !!fields.phone, has_email: !!fields.email }, '[meta-ingest]');

  // Gate: drop obviously-fake leads (test names, fake phones, no contact)
  // BEFORE we burn dedup-check time + distribution slot on them.
  const v = validateLead(fields);
  if (!v.valid) {
    logger.warn({ ...ctx, step: 'E2.validation_rejected', reason: v.reason, phone: fields.phone, email: fields.email, full_name: fields.full_name }, '[meta-ingest] LEAD REJECTED — looks fake/test/invalid');
    // Audit row so admin can count rejections per day
    try {
      await query(
        `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata)
           VALUES(NULL, 'lead_ingestion', NULL, 'rejected', $1)`,
        [JSON.stringify({ reason: v.reason, source: 'meta_webhook', leadgen_id, page_id, form_id, phone: fields.phone, email: fields.email })],
      );
    } catch { /* audit log table may not exist in dev; non-fatal */ }
    return { status: 'rejected', reason: v.reason };
  }

  // Phone / email cross-dedup — same person submitting multiple Meta forms
  // creates separate meta_lead_id values but should not create separate leads.
  const dupContact = await findExistingByContact({ phone: fields.phone, email: fields.email });
  if (dupContact) {
    logger.info({ ...ctx, step: 'F.dup_contact', reason: dupContact.reason, existing_lead: dupContact.id, dedup_window_days: process.env.LEAD_DEDUP_WINDOW_DAYS || '30' }, '[meta-ingest] skipped — same phone/email within dedup window. Set LEAD_DEDUP_WINDOW_DAYS=0 to disable.');
    return { status: 'duplicate', leadId: dupContact.id, reason: dupContact.reason };
  }
  logger.info({ ...ctx, step: 'F.dedup_clear' }, '[meta-ingest]');

  let { rows: [formRow] } = await query(
    `SELECT campaign_label, product_tag FROM meta_forms WHERE form_id = $1`,
    [form_id]
  );
  // FK on leads.meta_form_id requires the form row to exist. If Meta is
  // delivering a leadgen event for a form we haven't registered yet
  // (new form added in Meta, never synced), insert a stub now so the
  // leads INSERT below doesn't fail with 23503. Form metadata
  // (form_name, campaign_label, product_tag) stays NULL until the next
  // periodic Meta sync fills it in — losing the metadata is acceptable;
  // losing the lead is not.
  if (!formRow) {
    logger.info({ ...ctx, step: 'F2.auto_register_form' }, '[meta-ingest] form not in DB — inserting stub to satisfy FK');
    await query(
      `INSERT INTO meta_forms(form_id, page_id, form_name, is_active) VALUES($1, $2, NULL, TRUE)
         ON CONFLICT (form_id) DO NOTHING`,
      [form_id, page_id]
    );
    formRow = { campaign_label: null, product_tag: null };
  }

  // Resolve campaign label from meta_campaigns or derive from name
  let campaignLabel = formRow?.campaign_label || null;
  if (detail.campaign_id) {
    const { rows: [campRow] } = await query(
      `SELECT internal_label FROM meta_campaigns WHERE campaign_id = $1`,
      [detail.campaign_id]
    );
    if (campRow) {
      campaignLabel = campRow.internal_label;
    } else {
      // Auto-register unknown campaign
      const { deriveCampaignLabel } = require('./metaSyncService');
      const label = deriveCampaignLabel(detail.campaign_name);
      await query(
        `INSERT INTO meta_campaigns(campaign_id, campaign_name, internal_label) VALUES($1, $2, $3) ON CONFLICT(campaign_id) DO NOTHING`,
        [detail.campaign_id, detail.campaign_name || null, label]
      );
      campaignLabel = label;
    }
  }

  const metaCreatedTime = created_time ? new Date(created_time * 1000) : null;

  const inserted = await withTransaction(async (client) => {
    const ins = await client.query(
      `INSERT INTO leads (
         full_name, phone, email, city, state,
         source, meta_lead_id, meta_form_id, meta_page_id,
         meta_campaign_id, meta_adset_id, meta_ad_id, meta_created_time,
         campaign_label, product_tag, raw_payload,
         campaign_name, adset_name, ad_name
       ) VALUES ($1, $2, $3, $4, $5, 'meta', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (meta_lead_id) DO NOTHING
       RETURNING id`,
      [
        fields.full_name || null,
        fields.phone    || null,
        fields.email    || null,
        fields.city     || null,
        fields.state    || null,
        leadgen_id,
        form_id,
        page_id,
        detail.campaign_id || null,
        detail.adset_id    || null,
        detail.ad_id       || null,
        metaCreatedTime,
        campaignLabel,
        formRow?.product_tag    || null,
        detail,
        detail.campaign_name || null,
        detail.adset_name    || null,
        detail.ad_name       || null,
      ]
    );
    return ins.rows[0]?.id || null;
  });

  if (!inserted) {
    logger.info({ ...ctx, step: 'G.insert_skipped_conflict' }, '[meta-ingest] race condition — meta_lead_id ON CONFLICT triggered.');
    return { status: 'duplicate' };
  }
  logger.info({ ...ctx, step: 'G.insert_ok', leadId: inserted, campaign_label: campaignLabel }, '[meta-ingest] row inserted');

  // Only distribute immediately if within active distribution hours (08:00–22:00 IST).
  // Outside those hours the lead stays in the queue and will be distributed at 8 AM.
  let assigned = { reason: 'QUEUED_OUTSIDE_HOURS' };
  if (await isDistributionActive()) {
    const request = await assignmentEngine.runApprovedRequestFulfillment({ limit: 100 });
    const auto = await assignmentEngine.runAutoAssignment({ limit: 100, reason: 'meta_webhook' });
    assigned = { request, auto };
    logger.info({ ...ctx, step: 'H.assigned', leadId: inserted, assigned }, '[meta-ingest]');
  } else {
    logger.info({ ...ctx, step: 'H.queued_off_hours', leadId: inserted }, '[meta-ingest] distribution paused — lead stays unassigned until 08:00 IST');
  }

  // Fan out: broadcast to Socket.IO + append to Google Sheet (both non-blocking)
  onLeadCreated(inserted, { source: 'meta_webhook' });
  logger.info({ ...ctx, step: 'I.fanout_dispatched', leadId: inserted }, '[meta-ingest] Socket.IO + Sheet append fired (async)');

  return { status: 'ingested', leadId: inserted, assigned };
}

/**
 * Fetch a Lead Form's metadata (questions, status, page, etc.) from Graph API.
 * Requires a Page Access Token for the page that owns the form.
 *
 * Returns: { id, name, status, locale, questions: [...], leads_count, created_time,
 *           privacy_policy_url, follow_up_action_url, page, page_id }
 */
async function fetchFormFromGraph(formId, pageAccessToken) {
  const fields = [
    'id', 'name', 'status', 'locale', 'created_time', 'leads_count',
    'questions', 'privacy_policy_url', 'follow_up_action_url',
    'thank_you_page', 'context_card', 'expired_leads_count', 'organic_leads_count',
    'page{id,name,username,link,picture}',
  ].join(',');
  return graphGet(formId, { fields }, pageAccessToken, { tokenSource: 'db_page_token', formId });
}

module.exports = {
  verifySignature,
  fetchLeadFromGraph,
  fetchFormFromGraph,
  getPageAccessToken,
  parseFieldData,
  ingestLeadgenEvent,
};
