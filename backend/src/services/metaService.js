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
const axios  = require('axios');
const config = require('../config/env');
const { query, withTransaction } = require('../config/database');
const logger = require('../utils/logger');
const { assignLead } = require('./leadDistributionService');
const { isDistributionActive } = require('./distributionScheduler');
const { appendLead: sheetAppend } = require('./googleSheetsService');
const { onLeadCreated, findExistingByContact } = require('./leadEventService');

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
  const url = `https://graph.facebook.com/${config.meta.graphVersion}/${leadgenId}`;
  const resp = await axios.get(url, {
    params: {
      access_token: pageAccessToken,
      fields: 'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data,platform',
    },
    timeout: 15000,
  });
  return resp.data;
}

/** Look up our stored page access token for a page_id (set via /api/meta/pages). */
async function getPageAccessToken(pageId) {
  const { rows } = await query(
    `SELECT page_access_token FROM meta_pages WHERE page_id = $1 AND is_active = TRUE`,
    [pageId]
  );
  return rows[0]?.page_access_token || null;
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
  // Fast path: same leadgen_id already in DB
  const dup = await query(`SELECT id FROM leads WHERE meta_lead_id = $1`, [leadgen_id]);
  if (dup.rowCount > 0) return { status: 'duplicate', leadId: dup.rows[0].id, reason: 'meta_lead_id' };

  const token = await getPageAccessToken(page_id);
  if (!token) {
    logger.error({ page_id }, 'No active page access token; cannot fetch lead');
    return { status: 'no_token' };
  }

  const detail   = await fetchLeadFromGraph(leadgen_id, token);
  const fields   = parseFieldData(detail.field_data);

  // Phone / email cross-dedup — same person submitting multiple Meta forms
  // creates separate meta_lead_id values but should not create separate leads.
  const dupContact = await findExistingByContact({ phone: fields.phone, email: fields.email });
  if (dupContact) {
    logger.info({ leadId: dupContact.id, reason: dupContact.reason, leadgen_id }, 'Meta lead skipped — phone/email already in DB');
    return { status: 'duplicate', leadId: dupContact.id, reason: dupContact.reason };
  }

  const { rows: [formRow] } = await query(
    `SELECT campaign_label, product_tag FROM meta_forms WHERE form_id = $1`,
    [form_id]
  );

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

  if (!inserted) return { status: 'duplicate' };

  // Only distribute immediately if within active distribution hours (08:00–22:00 IST).
  // Outside those hours the lead stays in the queue and will be distributed at 8 AM.
  let assigned = { reason: 'QUEUED_OUTSIDE_HOURS' };
  if (await isDistributionActive()) {
    assigned = await assignLead(inserted);
  } else {
    logger.info({ leadId: inserted }, 'Meta lead queued — distribution inactive (outside 08:00-22:00 IST)');
  }

  // Fan out: broadcast to Socket.IO + append to Google Sheet (both non-blocking)
  onLeadCreated(inserted, { source: 'meta_webhook' });

  logger.info({ leadId: inserted, leadgen_id, assigned }, 'Meta lead ingested');
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
  const url = `https://graph.facebook.com/${config.meta.graphVersion}/${formId}`;
  const fields = [
    'id', 'name', 'status', 'locale', 'created_time', 'leads_count',
    'questions', 'privacy_policy_url', 'follow_up_action_url',
    'thank_you_page', 'context_card', 'expired_leads_count', 'organic_leads_count',
    'page{id,name,username,link,picture}',
  ].join(',');
  const resp = await axios.get(url, {
    params: { access_token: pageAccessToken, fields },
    timeout: 15000,
  });
  return resp.data;
}

module.exports = {
  verifySignature,
  fetchLeadFromGraph,
  fetchFormFromGraph,
  getPageAccessToken,
  parseFieldData,
  ingestLeadgenEvent,
};
