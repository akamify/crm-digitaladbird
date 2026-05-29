/**
 * Meta Lead Sync Service
 *
 * Pulls leads from Meta Graph API (forms & ad accounts), maps campaigns,
 * and inserts into PostgreSQL with full attribution (campaign_id, adset_id, ad_id).
 *
 * Works alongside the existing webhook-based metaService.js for real-time ingestion.
 * This service handles:
 *   - Historical lead sync from forms
 *   - Campaign discovery & mapping
 *   - Ad account campaign listing
 *   - Manual sync triggers
 */
const axios = require('axios');
const config = require('../config/env');
const { query, withTransaction } = require('../config/database');
const logger = require('../utils/logger');
const { assignLead } = require('./leadDistributionService');
const { isDistributionActive } = require('./distributionScheduler');
const { onLeadCreated, findExistingByContact } = require('./leadEventService');

const GRAPH_BASE = `https://graph.facebook.com/${config.meta.graphVersion}`;

// ─── Helper: get access token (prefer page token for lead reads) ──────
function getAccessToken() {
  return config.meta.pageAccessToken || config.meta.userAccessToken || null;
}

function getUserAccessToken() {
  return config.meta.userAccessToken || config.meta.pageAccessToken || null;
}

// ─── Graph API caller with error handling ─────────────────────────────
async function graphGet(path, params = {}) {
  const token = params._useUserToken ? getUserAccessToken() : getAccessToken();
  delete params._useUserToken;

  if (!token) throw new Error('No Meta access token configured');

  const url = path.startsWith('http') ? path : `${GRAPH_BASE}/${path}`;
  try {
    const resp = await axios.get(url, {
      params: { access_token: token, ...params },
      timeout: 30000,
    });
    return resp.data;
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    logger.error({ url, params: { ...params, access_token: '***' }, error: msg }, 'Graph API error');
    throw new Error(`Graph API: ${msg}`);
  }
}

// ─── Paginated Graph API fetch ────────────────────────────────────────
async function graphGetAll(path, params = {}, maxPages = 50) {
  const results = [];
  let url = path;
  let page = 0;

  while (url && page < maxPages) {
    const data = await graphGet(url, page === 0 ? params : {});
    if (data.data) results.push(...data.data);
    url = data.paging?.next || null;
    page++;
  }

  return results;
}

// ─── Campaign Discovery ───────────────────────────────────────────────

/**
 * Fetch all campaigns from an ad account and upsert into meta_campaigns.
 */
async function syncCampaigns(adAccountId) {
  logger.info({ adAccountId }, 'Syncing campaigns from Meta');

  const campaigns = await graphGetAll(
    `${adAccountId}/campaigns`,
    {
      fields: 'id,name,status,objective,created_time,updated_time',
      limit: 100,
      _useUserToken: true,
    }
  );

  let created = 0;
  let updated = 0;

  for (const c of campaigns) {
    const label = deriveCampaignLabel(c.name);

    const result = await query(
      `INSERT INTO meta_campaigns(campaign_id, campaign_name, internal_label, ad_account_id, is_active)
       VALUES($1, $2, $3, $4, $5)
       ON CONFLICT(campaign_id) DO UPDATE
         SET campaign_name = EXCLUDED.campaign_name,
             is_active = CASE WHEN EXCLUDED.is_active THEN TRUE ELSE meta_campaigns.is_active END,
             updated_at = NOW()
       RETURNING (xmax = 0) AS is_new`,
      [c.id, c.name, label, adAccountId, c.status === 'ACTIVE']
    );

    if (result.rows[0]?.is_new) created++;
    else updated++;
  }

  logger.info({ adAccountId, total: campaigns.length, created, updated }, 'Campaign sync complete');
  return { total: campaigns.length, created, updated };
}

/**
 * Derive internal label (C1, C2, C3, etc.) from campaign name.
 * Looks for patterns like "C1", "C2", "Campaign 1", etc.
 * Falls back to first word of campaign name.
 */
function deriveCampaignLabel(name) {
  if (!name) return 'unknown';

  // Check for explicit C1/C2/C3 patterns
  const cMatch = name.match(/\b(C\d+)\b/i);
  if (cMatch) return cMatch[1].toUpperCase();

  // Check for "Campaign X" pattern
  const campMatch = name.match(/campaign\s*(\d+)/i);
  if (campMatch) return `C${campMatch[1]}`;

  // Use sanitized campaign name as label
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
}

/**
 * Sync campaigns from all configured ad accounts.
 */
async function syncAllCampaigns() {
  const results = {};
  const adAccounts = config.meta.adAccountIds;

  if (!adAccounts.length) {
    // Fallback: read from DB
    const { rows } = await query(`SELECT account_id FROM meta_ad_accounts WHERE is_active = TRUE`);
    adAccounts.push(...rows.map(r => r.account_id));
  }

  for (const accId of adAccounts) {
    try {
      results[accId] = await syncCampaigns(accId);
    } catch (err) {
      logger.error({ accId, err: err.message }, 'Failed to sync campaigns for account');
      results[accId] = { error: err.message };
    }
  }

  return results;
}

// ─── Lead Sync from Forms ─────────────────────────────────────────────

/**
 * Fetch leads from a specific form via Graph API and insert into DB.
 * Uses cursor-based pagination. Deduplicates on meta_lead_id.
 */
async function syncFormLeads(formId, options = {}) {
  const { since, limit = 500 } = options;
  const pageAccessToken = getAccessToken();

  if (!pageAccessToken) throw new Error('No page access token configured');

  logger.info({ formId, since }, 'Starting form lead sync');

  const syncLog = await query(
    `INSERT INTO meta_sync_log(sync_type, source_id) VALUES('form_leads', $1) RETURNING id`,
    [formId]
  );
  const syncId = syncLog.rows[0].id;

  let fetched = 0;
  let created = 0;
  let duplicate = 0;
  let errors = [];

  try {
    const params = {
      fields: 'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data,platform',
      limit: Math.min(limit, 500),
    };
    if (since) params.filtering = JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(new Date(since).getTime() / 1000) }]);

    const leads = await graphGetAll(`${formId}/leads`, params, 100);
    fetched = leads.length;

    for (const lead of leads) {
      try {
        const result = await ingestGraphLead(lead, formId);
        if (result.status === 'created') created++;
        else if (result.status === 'duplicate') duplicate++;
      } catch (err) {
        errors.push({ leadgen_id: lead.id, error: err.message });
        logger.error({ leadId: lead.id, err: err.message }, 'Failed to ingest lead during sync');
      }
    }

    await query(
      `UPDATE meta_sync_log SET leads_fetched = $1, leads_created = $2, leads_duplicate = $3, finished_at = NOW() WHERE id = $4`,
      [fetched, created, duplicate, syncId]
    );
  } catch (err) {
    await query(
      `UPDATE meta_sync_log SET leads_fetched = $1, leads_created = $2, leads_duplicate = $3, error_message = $4, finished_at = NOW() WHERE id = $5`,
      [fetched, created, duplicate, err.message, syncId]
    );
    throw err;
  }

  logger.info({ formId, fetched, created, duplicate, errors: errors.length }, 'Form lead sync complete');
  return { formId, fetched, created, duplicate, errors: errors.length };
}

/**
 * Ingest a single lead from Graph API response into the leads table.
 * Includes full campaign/adset/ad attribution.
 */
async function ingestGraphLead(lead, formId) {
  const leadgenId = lead.id;

  // Check duplicate by meta_lead_id first (fast path)
  const dup = await query(`SELECT id FROM leads WHERE meta_lead_id = $1`, [leadgenId]);
  if (dup.rowCount > 0) return { status: 'duplicate', leadId: dup.rows[0].id, reason: 'meta_lead_id' };

  // Parse field data
  const fields = parseFieldData(lead.field_data || []);

  // Cross-dedup by phone/email so the same person submitting multiple Meta
  // forms doesn't generate a duplicate CRM lead.
  const dupContact = await findExistingByContact({ phone: fields.phone, email: fields.email });
  if (dupContact) return { status: 'duplicate', leadId: dupContact.id, reason: dupContact.reason };

  // Get form metadata for campaign_label and product_tag
  const { rows: [formRow] } = await query(
    `SELECT campaign_label, product_tag, page_id FROM meta_forms WHERE form_id = $1`,
    [formId]
  );

  // Resolve campaign label from meta_campaigns table if available
  let campaignLabel = formRow?.campaign_label || null;
  if (lead.campaign_id) {
    const { rows: [campRow] } = await query(
      `SELECT internal_label, category FROM meta_campaigns WHERE campaign_id = $1`,
      [lead.campaign_id]
    );
    if (campRow) {
      campaignLabel = campRow.internal_label;
    } else {
      // Auto-register campaign
      const label = deriveCampaignLabel(lead.campaign_name);
      await query(
        `INSERT INTO meta_campaigns(campaign_id, campaign_name, internal_label)
         VALUES($1, $2, $3) ON CONFLICT(campaign_id) DO NOTHING`,
        [lead.campaign_id, lead.campaign_name || null, label]
      );
      campaignLabel = label;
    }
  }

  const pageId = formRow?.page_id || config.meta.pageId || null;
  const metaCreatedTime = lead.created_time ? new Date(lead.created_time) : null;

  const inserted = await withTransaction(async (client) => {
    const ins = await client.query(
      `INSERT INTO leads (
         full_name, phone, email, city, state,
         source, meta_lead_id, meta_form_id, meta_page_id,
         meta_campaign_id, meta_adset_id, meta_ad_id, meta_created_time,
         campaign_label, product_tag, raw_payload
       ) VALUES ($1, $2, $3, $4, $5, 'meta', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (meta_lead_id) DO NOTHING
       RETURNING id`,
      [
        fields.full_name || null,
        fields.phone || null,
        fields.email || null,
        fields.city || null,
        fields.state || null,
        leadgenId,
        formId,
        pageId,
        lead.campaign_id || null,
        lead.adset_id || null,
        lead.ad_id || null,
        metaCreatedTime,
        campaignLabel,
        formRow?.product_tag || null,
        lead,
      ]
    );
    return ins.rows[0]?.id || null;
  });

  if (!inserted) return { status: 'duplicate' };

  // Distribute if within active hours
  let assigned = { reason: 'QUEUED_OUTSIDE_HOURS' };
  if (await isDistributionActive()) {
    try {
      assigned = await assignLead(inserted);
    } catch (err) {
      logger.error({ leadId: inserted, err: err.message }, 'Distribution failed for synced lead');
      assigned = { reason: 'DISTRIBUTION_ERROR', error: err.message };
    }
  }

  // Real-time broadcast + Google Sheet append (non-blocking).
  onLeadCreated(inserted, { source: 'meta_periodic_sync' });

  logger.info({ leadId: inserted, leadgen_id: leadgenId, campaign: campaignLabel, assigned }, 'Synced lead ingested');
  return { status: 'created', leadId: inserted, assigned };
}

/** Convert Meta field_data array to structured object. */
function parseFieldData(fieldData = []) {
  const out = {};
  for (const { name, values } of fieldData) {
    const v = Array.isArray(values) ? values[0] : values;
    const key = (name || '').toLowerCase();
    if (['full_name', 'name', 'first_name'].includes(key)) out.full_name = (out.full_name || '') + ' ' + v;
    else if (['last_name'].includes(key)) out.full_name = (out.full_name || '') + ' ' + v;
    else if (['email'].includes(key)) out.email = v;
    else if (['phone_number', 'phone'].includes(key)) out.phone = v;
    else if (['city'].includes(key)) out.city = v;
    else if (['state'].includes(key)) out.state = v;
    else { out.custom = out.custom || {}; out.custom[name] = v; }
  }
  if (out.full_name) out.full_name = out.full_name.trim();
  return out;
}

// ─── Sync All Forms ───────────────────────────────────────────────────

/**
 * Sync leads from all active forms.
 */
async function syncAllFormLeads(options = {}) {
  const { rows: forms } = await query(`SELECT form_id FROM meta_forms WHERE is_active = TRUE`);
  const results = {};

  for (const form of forms) {
    try {
      results[form.form_id] = await syncFormLeads(form.form_id, options);
    } catch (err) {
      logger.error({ formId: form.form_id, err: err.message }, 'Failed to sync form leads');
      results[form.form_id] = { error: err.message };
    }
  }

  return results;
}

// ─── Campaign Stats ───────────────────────────────────────────────────

/**
 * Get lead counts grouped by campaign label.
 */
async function getCampaignStats() {
  const { rows } = await query(`
    SELECT
      COALESCE(mc.internal_label, l.campaign_label, 'untagged') AS campaign,
      mc.campaign_name,
      COUNT(*) AS total_leads,
      COUNT(*) FILTER (WHERE l.call_status = 'converted') AS converted,
      COUNT(*) FILTER (WHERE l.is_pending) AS pending,
      COUNT(*) FILTER (WHERE l.stage = 'new') AS new_leads,
      COUNT(*) FILTER (WHERE l.assigned_to_user_id IS NOT NULL) AS assigned,
      COUNT(*) FILTER (WHERE l.assigned_to_user_id IS NULL AND l.deleted_at IS NULL) AS unassigned,
      MIN(l.created_at) AS first_lead_at,
      MAX(l.created_at) AS last_lead_at
    FROM leads l
    LEFT JOIN meta_campaigns mc ON mc.campaign_id = l.meta_campaign_id
    WHERE l.source = 'meta' AND l.deleted_at IS NULL
    GROUP BY mc.internal_label, l.campaign_label, mc.campaign_name
    ORDER BY total_leads DESC
  `);
  return rows;
}

// ─── Ad Account Info ──────────────────────────────────────────────────

/**
 * Fetch ad account details from Graph API.
 */
async function getAdAccountInfo(adAccountId) {
  return graphGet(adAccountId, {
    fields: 'id,name,account_id,account_status,currency,timezone_name,amount_spent,balance',
    _useUserToken: true,
  });
}

/**
 * Fetch all ad accounts for the user.
 */
async function listAdAccounts() {
  const data = await graphGet('me/adaccounts', {
    fields: 'id,name,account_id,account_status,currency',
    limit: 100,
    _useUserToken: true,
  });
  return data.data || [];
}

// ─── Forms Discovery ──────────────────────────────────────────────────

/**
 * Fetch all lead gen forms for a page.
 */
async function listPageForms(pageId) {
  pageId = pageId || config.meta.pageId;
  if (!pageId) throw new Error('No page_id configured');

  const data = await graphGet(`${pageId}/leadgen_forms`, {
    fields: 'id,name,status,leads_count,created_time',
    limit: 100,
  });
  return data.data || [];
}

// ─── Page Subscriptions (webhook prep) ────────────────────────────────

/**
 * Subscribe page to leadgen webhook events.
 * Required for live webhook delivery.
 */
async function subscribePageToLeadgen(pageId) {
  pageId = pageId || config.meta.pageId;
  const token = getAccessToken();
  if (!token || !pageId) throw new Error('Missing page_id or access_token');

  const resp = await axios.post(
    `${GRAPH_BASE}/${pageId}/subscribed_apps`,
    null,
    {
      params: {
        subscribed_fields: 'leadgen',
        access_token: token,
      },
      timeout: 15000,
    }
  );
  return resp.data;
}

/**
 * Check if page is subscribed to leadgen.
 */
async function getPageSubscriptions(pageId) {
  pageId = pageId || config.meta.pageId;
  return graphGet(`${pageId}/subscribed_apps`);
}

// ─── Token Validation ─────────────────────────────────────────────────

/**
 * Debug/validate access token via Graph API.
 */
async function debugToken(tokenToCheck) {
  const token = tokenToCheck || getAccessToken();
  if (!token) return { error: 'No token available' };

  try {
    const data = await graphGet('debug_token', {
      input_token: token,
      _useUserToken: true,
    });
    return data.data || data;
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Quick connectivity check — fetches page info.
 */
async function checkConnectivity() {
  const token = getAccessToken();
  if (!token) return { connected: false, error: 'No access token configured' };

  try {
    const pageId = config.meta.pageId;
    if (!pageId) return { connected: false, error: 'No page_id configured' };

    const pageInfo = await graphGet(pageId, { fields: 'id,name,category,fan_count' });

    // Also check form count
    let formCount = 0;
    try {
      const forms = await listPageForms(pageId);
      formCount = forms.length;
    } catch { /* ignore */ }

    // Check ad accounts
    let adAccountCount = 0;
    try {
      const accounts = await listAdAccounts();
      adAccountCount = accounts.length;
    } catch { /* ignore */ }

    return {
      connected: true,
      page: pageInfo,
      forms: formCount,
      ad_accounts: adAccountCount,
      graph_version: config.meta.graphVersion,
    };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

module.exports = {
  syncFormLeads,
  syncAllFormLeads,
  syncCampaigns,
  syncAllCampaigns,
  getCampaignStats,
  getAdAccountInfo,
  listAdAccounts,
  listPageForms,
  subscribePageToLeadgen,
  getPageSubscriptions,
  debugToken,
  checkConnectivity,
  deriveCampaignLabel,
};
