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
const config = require('../config/env');
const { query, withTransaction } = require('../config/database');
const logger = require('../utils/logger');
const { isDistributionActive } = require('./distributionScheduler');
const assignmentEngine = require('./leadAssignmentEngine');
const { onLeadCreated, findExistingByContact } = require('./leadEventService');
const { resolveLeadCategory, resolveAndPersistLeadCategory } = require('./leadCategory/leadCategoryResolver');
const { validateLead } = require('./leadValidator');
const graphClient = require('./metaGraphClient');
const metaTokens = require('./metaTokenResolver');
const { resolveCampaignName } = require('./leadCampaignResolver');



// ─── Helper: get access token (prefer page token for lead reads) ──────

async function getActiveMetaPage() {
  const pages = await metaTokens.findActivePages();
  const page = pages[0];
  if (!page) return null;
  return { pageId: page.page_id, pageName: page.page_name, source: 'database' };
}

// ─── Graph API caller with error handling ─────────────────────────────
async function graphGet(path, params = {}) {
  const explicitToken = params._accessToken || null;
  const pageId = params._pageId || null;
  delete params._accessToken;
  delete params._pageId;
  const userToken = params._useUserToken ? await metaTokens.getUserToken() : null;
  const token = explicitToken || userToken?.token || null;
  const tokenSource = explicitToken ? 'db_page_token' : userToken?.source;
  delete params._useUserToken;

  if (!token) throw new Error('No required Meta token configured');
  return graphClient.graphGet(path, params, token, { tokenSource, pageId });
}

// ─── Paginated Graph API fetch ────────────────────────────────────────
async function graphGetAll(path, params = {}, maxPages = 50) {
  const results = [];
  let url = path;
  let page = 0;
  const requestParams = { ...params };
  const explicitToken = requestParams._accessToken || null;
  const pageId = requestParams._pageId || null;
  const userToken = requestParams._useUserToken ? await metaTokens.getUserToken() : null;
  const token = explicitToken || userToken?.token || null;
  const tokenSource = explicitToken ? 'db_page_token' : userToken?.source;
  delete requestParams._accessToken;
  delete requestParams._pageId;
  delete requestParams._useUserToken;
  if (!token) throw new Error('No required Meta token configured');

  while (url && page < maxPages) {
    const data = await graphClient.graphGet(url, page === 0 ? requestParams : {}, token, { tokenSource, pageId });
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
      fields: [
        'id',
        'name',
        'status',
        'effective_status',
        'configured_status',
        'objective',
        'created_time',
        'updated_time',
        'start_time',
        'stop_time',
        'buying_type',
        'daily_budget',
        'lifetime_budget',
      ].join(','),
      limit: 100,
      _useUserToken: true,
    }
  );

  let created = 0;
  let updated = 0;

  for (const c of campaigns) {
    const label = deriveCampaignLabel(c.name);

    const result = await query(
      `INSERT INTO meta_campaigns(
         campaign_id, campaign_name, internal_label, ad_account_id, is_active,
         meta_status, effective_status, configured_status, objective, buying_type,
         start_time, stop_time, meta_created_time, meta_updated_time,
         daily_budget, lifetime_budget, source, last_meta_status_checked_at, last_sync_error
       )
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'meta_api', NOW(), NULL)
       ON CONFLICT(campaign_id) DO UPDATE
         SET campaign_name = EXCLUDED.campaign_name,
             ad_account_id = EXCLUDED.ad_account_id,
             is_active = EXCLUDED.is_active,
             meta_status = EXCLUDED.meta_status,
             effective_status = EXCLUDED.effective_status,
             configured_status = EXCLUDED.configured_status,
             objective = EXCLUDED.objective,
             buying_type = EXCLUDED.buying_type,
             start_time = EXCLUDED.start_time,
             stop_time = EXCLUDED.stop_time,
             meta_created_time = EXCLUDED.meta_created_time,
             meta_updated_time = EXCLUDED.meta_updated_time,
             daily_budget = EXCLUDED.daily_budget,
             lifetime_budget = EXCLUDED.lifetime_budget,
             source = 'meta_api',
             last_meta_status_checked_at = NOW(),
             last_sync_error = NULL,
             updated_at = NOW()
       RETURNING (xmax = 0) AS is_new`,
      [
        c.id,
        c.name,
        label,
        normalizeAdAccountId(adAccountId),
        c.effective_status === 'ACTIVE',
        c.status || null,
        c.effective_status || null,
        c.configured_status || null,
        c.objective || null,
        c.buying_type || null,
        parseMetaDate(c.start_time),
        parseMetaDate(c.stop_time),
        parseMetaDate(c.created_time),
        parseMetaDate(c.updated_time),
        c.daily_budget ? Number(c.daily_budget) : null,
        c.lifetime_budget ? Number(c.lifetime_budget) : null,
      ]
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
  try {
    await syncAdAccounts();
  } catch (err) {
    logger.warn({ err: err.message }, 'Ad account refresh skipped before campaign sync');
  }

  const { rows } = await query(`SELECT account_id FROM meta_ad_accounts WHERE is_active = TRUE ORDER BY account_id`);
  const adAccounts = rows.map(r => normalizeGraphAdAccountId(r.account_id));

  if (!adAccounts.length && config.meta.adAccountIds.length) {
    adAccounts.push(...config.meta.adAccountIds.map(normalizeGraphAdAccountId));
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

function parseMetaDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isStaleMetaFormError(err) {
  const message = String(err?.message || '');
  return err?.metaCode === 2500 || err?.code === 2500 || /Unknown path components/i.test(message);
}

async function markFormStale(formId, errorMessage) {
  await query(
    `UPDATE meta_forms
        SET is_active = FALSE,
            stale_at = NOW(),
            last_checked_at = NOW(),
            last_error = $2,
            last_sync_error = $2
      WHERE form_id = $1`,
    [String(formId), String(errorMessage || 'Meta form is stale or invalid').slice(0, 1000)],
  ).catch(err => logger.warn({ formId, err: err.message }, 'Failed to mark Meta form stale'));
}

function normalizeAdAccountId(value) {
  return String(value || '').replace(/^act_/, '');
}

function normalizeGraphAdAccountId(value) {
  const id = String(value || '').trim();
  return id.startsWith('act_') ? id : `act_${id}`;
}

// ─── Lead Sync from Forms ─────────────────────────────────────────────

/**
 * Fetch leads from a specific form via Graph API and insert into DB.
 * Uses cursor-based pagination. Deduplicates on meta_lead_id.
 */
async function syncFormLeads(formId, options = {}) {
  const { since, limit = 500 } = options;
  const pageToken = await metaTokens.getPageTokenForForm(formId);

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
      _accessToken: pageToken.token,
      _pageId: pageToken.page.page_id,
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
    if (isStaleMetaFormError(err)) {
      await markFormStale(formId, err.message);
      logger.warn({ formId, err: err.message, meta_code: err.metaCode || err.code }, 'Meta form marked stale after invalid form path');
    }
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
  if (dup.rowCount > 0) {
    await resolveAndPersistLeadCategory(dup.rows[0].id, {
      leadPayload: { ...lead, meta_campaign_id: lead.campaign_id, meta_form_id: formId },
    }).catch(() => {});
    return { status: 'duplicate', leadId: dup.rows[0].id, reason: 'meta_lead_id' };
  }

  // Parse field data
  const fields = parseFieldData(lead.field_data || []);

  // Same fake/test/invalid filter the webhook path uses — see leadValidator.js.
  const v = validateLead(fields);
  if (!v.valid) {
    logger.warn({ leadgen_id: leadgenId, formId, reason: v.reason, phone: fields.phone, email: fields.email }, '[sync] lead rejected — invalid/test pattern');
    try {
      await query(
        `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata)
           VALUES(NULL, 'lead_ingestion', NULL, 'rejected', $1)`,
        [JSON.stringify({ reason: v.reason, source: 'meta_sync', leadgen_id: leadgenId, form_id: formId, phone: fields.phone, email: fields.email })],
      );
    } catch { /* non-fatal */ }
    return { status: 'rejected', reason: v.reason };
  }

  // Cross-dedup by phone/email so the same person submitting multiple Meta
  // forms doesn't generate a duplicate CRM lead.
  const dupContact = await findExistingByContact({ phone: fields.phone, email: fields.email });
  if (dupContact) {
    await resolveAndPersistLeadCategory(dupContact.id, {
      leadPayload: { ...fields, ...lead, meta_campaign_id: lead.campaign_id, meta_form_id: formId },
    }).catch(() => {});
    return { status: 'duplicate', leadId: dupContact.id, reason: dupContact.reason };
  }

  // Get form metadata for campaign_label and product_tag.
  // Auto-register an unknown form so the leads.meta_form_id FK is satisfied —
  // see metaService.ingestLeadgenEvent for the same pattern + rationale.
  let { rows: [formRow] } = await query(
    `SELECT campaign_label, campaign_name, product_tag, page_id, form_name FROM meta_forms WHERE form_id = $1`,
    [formId]
  );
  if (!formRow) {
    await query(
      `INSERT INTO meta_forms(form_id, page_id, form_name, is_active)
         VALUES($1, NULL, NULL, TRUE) ON CONFLICT (form_id) DO NOTHING`,
      [formId]
    );
    formRow = { campaign_label: null, campaign_name: null, product_tag: null, page_id: null, form_name: null };
  }

  // Resolve campaign label from meta_campaigns table if available
  let campaignLabel = formRow?.campaign_label || null;
  let campaignRow = null;
  if (lead.campaign_id) {
    const { rows: [campRow] } = await query(
      `SELECT internal_label, category, campaign_name FROM meta_campaigns WHERE campaign_id = $1`,
      [lead.campaign_id]
    );
    if (campRow) {
      campaignLabel = campRow.internal_label;
      campaignRow = campRow;
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
  const campaignName = resolveCampaignName({ payload: lead, fields, form: formRow, campaign: campaignRow });
  const categoryResolution = await resolveLeadCategory({
    leadPayload: { ...fields, ...lead, campaign_name: campaignName, meta_campaign_id: lead.campaign_id, meta_form_id: formId, meta_page_id: pageId, form_name: formRow?.form_name },
    campaign: campaignRow,
    form: formRow,
  });
  const metaCreatedTime = lead.created_time ? new Date(lead.created_time) : null;

  const inserted = await withTransaction(async (client) => {
    const ins = await client.query(
      `INSERT INTO leads (
         full_name, phone, email, city, state,
         source, meta_lead_id, meta_form_id, meta_page_id,
         meta_campaign_id, meta_adset_id, meta_ad_id, meta_created_time,
         campaign_id, adset_id, ad_id, form_name, page_id,
         campaign_label, product_tag, raw_payload,
         campaign_name, adset_name, ad_name,
         category, category_source, category_rule_id, category_resolved_at
       ) VALUES ($1, $2, $3, $4, $5, 'meta', $6, $7, $8, $9, $10, $11, $12, $9, $10, $11, $16, $8, $13, $14, $15, $17, $18, $19, $20, $21, $22, NOW())
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
        formRow?.form_name || null,
        campaignName,
        lead.adset_name || null,
        lead.ad_name || null,
        categoryResolution.category,
        categoryResolution.source,
        categoryResolution.rule_id,
      ]
    );
    return ins.rows[0]?.id || null;
  });

  if (!inserted) return { status: 'duplicate' };

  // Approved request fulfillment is controlled by its own setting. Normal
  // saved-lead distribution remains behind the scheduled distribution gate.
  let assigned = { request: null, auto: { reason: 'QUEUED_OUTSIDE_HOURS' } };
  try {
    const request = await assignmentEngine.runApprovedRequestFulfillment({ limit: 100 });
    let auto = { reason: 'QUEUED_OUTSIDE_HOURS' };
    if (await isDistributionActive()) {
      auto = await assignmentEngine.runAutoAssignment({ limit: 100, reason: 'meta_periodic_sync' });
    }
    assigned = { request, auto };
  } catch (err) {
    logger.error({ leadId: inserted, err: err.message }, 'Distribution failed for synced lead');
    assigned = { reason: 'DISTRIBUTION_ERROR', error: err.message };
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
    else { out.custom = out.custom || {}; out.custom[name] = v; out[key] = v; }
  }
  if (out.full_name) out.full_name = out.full_name.trim();
  return out;
}

// ─── Sync All Forms ───────────────────────────────────────────────────

/**
 * Sync leads from all active forms.
 */
async function syncAllFormLeads(options = {}) {
  const { rows: forms } = await query(`
    SELECT f.form_id
      FROM meta_forms f
      JOIN meta_pages p ON p.page_id = f.page_id
     WHERE f.is_active = TRUE
       AND f.stale_at IS NULL
       AND p.is_active = TRUE
       AND p.connection_status = 'active'
  `);
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
    fields: 'id,name,account_id,account_status,currency,business',
    limit: 100,
    _useUserToken: true,
  });
  return data.data || [];
}

async function syncAdAccounts() {
  const accounts = await listAdAccounts();
  let created = 0;
  let updated = 0;

  for (const account of accounts) {
    const accountId = normalizeAdAccountId(account.account_id || account.id);
    const result = await query(
      `INSERT INTO meta_ad_accounts(
         account_id, account_name, account_status, currency,
         business_id, business_name, is_active, last_synced_at, last_sync_error
       )
       VALUES($1, $2, $3, $4, $5, $6, TRUE, NOW(), NULL)
       ON CONFLICT(account_id) DO UPDATE
         SET account_name = EXCLUDED.account_name,
             account_status = EXCLUDED.account_status,
             currency = EXCLUDED.currency,
             business_id = EXCLUDED.business_id,
             business_name = EXCLUDED.business_name,
             is_active = TRUE,
             last_synced_at = NOW(),
             last_sync_error = NULL,
             updated_at = NOW()
       RETURNING (xmax = 0) AS is_new`,
      [
        accountId,
        account.name || null,
        account.account_status ?? null,
        account.currency || null,
        account.business?.id || null,
        account.business?.name || null,
      ]
    );
    if (result.rows[0]?.is_new) created++;
    else updated++;
  }

  return { total: accounts.length, created, updated, accounts: accounts.map(account => normalizeAdAccountId(account.account_id || account.id)) };
}

// ─── Forms Discovery ──────────────────────────────────────────────────

/**
 * Fetch all lead gen forms for a page.
 */
async function listPageForms(pageId) {
  const activePage = pageId ? { pageId } : await getActiveMetaPage();
  const resolvedPageId = activePage?.pageId;
  if (!resolvedPageId) throw new Error('No active Meta page connected');
  const pageToken = await metaTokens.getRequiredPageToken(resolvedPageId);

  const data = await graphGet(`${resolvedPageId}/leadgen_forms`, {
    fields: 'id,name,status,leads_count,created_time',
    limit: 100,
    _accessToken: pageToken.token,
    _pageId: resolvedPageId,
  });
  return data.data || [];
}

async function syncPageForms(pageId) {
  const forms = await listPageForms(pageId);
  let created = 0;
  let updated = 0;

  for (const form of forms) {
    const result = await query(
      `INSERT INTO meta_forms(
         form_id, form_name, page_id, status, leads_count, created_time,
         is_active, last_synced_at, last_sync_error
       )
       VALUES($1, $2, $3, $4, $5, $6, TRUE, NOW(), NULL)
       ON CONFLICT(form_id) DO UPDATE
         SET form_name = EXCLUDED.form_name,
             page_id = EXCLUDED.page_id,
             status = EXCLUDED.status,
             leads_count = EXCLUDED.leads_count,
             created_time = EXCLUDED.created_time,
             is_active = EXCLUDED.status IS DISTINCT FROM 'ARCHIVED',
             last_synced_at = NOW(),
             last_sync_error = NULL
       RETURNING (xmax = 0) AS is_new`,
      [
        String(form.id),
        form.name || null,
        String(pageId),
        form.status || null,
        form.leads_count ?? null,
        parseMetaDate(form.created_time),
      ]
    );
    if (result.rows[0]?.is_new) created++;
    else updated++;
  }

  await metaTokens.updatePageFormsStatus(pageId, {
    status: forms.length ? 'accessible' : 'accessible_empty',
    synced: true,
  });

  return { page_id: String(pageId), total: forms.length, created, updated, forms };
}

// ─── Page Subscriptions (webhook prep) ────────────────────────────────

/**
 * Subscribe page to leadgen webhook events.
 * Required for live webhook delivery.
 */
async function subscribePageToLeadgen(pageId) {
  const activePage = pageId ? { pageId } : await getActiveMetaPage();
  const resolvedPageId = activePage?.pageId;
  if (!resolvedPageId) throw new Error('No active Meta page connected');
  const pageToken = await metaTokens.getRequiredPageToken(resolvedPageId);
  return graphClient.graphPost(`${resolvedPageId}/subscribed_apps`, {
    subscribed_fields: 'leadgen',
  }, pageToken.token, { pageId: resolvedPageId, tokenSource: 'db_page_token' });
}

async function unsubscribePageFromLeadgen(pageId, pageToken) {
  if (!pageToken) throw new Error('Page access token is required to disconnect the webhook');
  return graphClient.graphDelete(`${pageId}/subscribed_apps`, {}, pageToken, {
    pageId: String(pageId),
    tokenSource: 'db_page_token',
  });
}

/**
 * Check if page is subscribed to leadgen.
 */
async function getPageSubscriptions(pageId) {
  const activePage = pageId ? { pageId } : await getActiveMetaPage();
  const resolvedPageId = activePage?.pageId;
  if (!resolvedPageId) throw new Error('No active Meta page connected');
  const pageToken = await metaTokens.getRequiredPageToken(resolvedPageId);

  return graphGet(`${resolvedPageId}/subscribed_apps`, {
    fields: 'id,name,subscribed_fields',
    _accessToken: pageToken.token,
    _pageId: resolvedPageId,
  });
}

// ─── Token Validation ─────────────────────────────────────────────────

/**
 * Debug/validate access token via Graph API.
 */
async function debugToken(tokenToCheck) {
  const resolved = tokenToCheck ? { token: tokenToCheck } : await metaTokens.getUserToken();
  if (!resolved?.token) return { error: 'No user token available' };
  const appToken = config.meta.appId && config.meta.appSecret
    ? `${config.meta.appId}|${config.meta.appSecret}`
    : resolved.token;

  try {
    const data = await graphClient.graphDebugToken(resolved.token, appToken);
    return data.data || data;
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Quick connectivity check — fetches page info.
 */
async function checkConnectivity() {
  const activePage = await getActiveMetaPage();
  if (!activePage) return { connected: false, error: 'No active Meta page connected', graph_version: config.meta.graphVersion };
  const pageId = activePage.pageId;
  try {
    const pageToken = await metaTokens.getRequiredPageToken(pageId);
    const pageInfo = await graphClient.graphGet(pageId, {
      fields: 'id,name,category,fan_count',
    }, pageToken.token, { pageId, tokenSource: 'db_page_token' });
    await metaTokens.updatePageHealth(pageId, { valid: true });

    let formCount = 0;
    try {
      const forms = await listPageForms(pageId);
      formCount = forms.length;
    } catch { /* ignore */ }

    let adAccountCount = 0;
    try {
      const accounts = await listAdAccounts();
      adAccountCount = accounts.length;
    } catch { /* ignore */ }

    return {
      connected: true,
      source: 'database',
      token_source: 'db_page_token',
      page_id: pageId,
      page_name: activePage.pageName || pageInfo.name,
      page: pageInfo,
      forms: formCount,
      ad_accounts: adAccountCount,
      graph_version: config.meta.graphVersion,
    };
  } catch (err) {
    return { connected: false, page_id: pageId, token_source: 'db_page_token', error: err.message };
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
  syncAdAccounts,
  listPageForms,
  syncPageForms,
  subscribePageToLeadgen,
  unsubscribePageFromLeadgen,
  getPageSubscriptions,
  debugToken,
  checkConnectivity,
  deriveCampaignLabel,
  ingestGraphLead, // exposed for recovery scripts that need per-page tokens
};
