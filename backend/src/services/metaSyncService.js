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
const { randomUUID } = require('crypto');
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
let campaignSyncRunning = false;



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
async function graphGetAll(path, params = {}, maxPages = 100, label = path) {
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
  const logParams = { ...requestParams };

  while (url && page < maxPages) {
    const data = await graphClient.graphGet(url, page === 0 ? requestParams : {}, token, { tokenSource, pageId });
    const items = Array.isArray(data.data) ? data.data : [];
    if (items.length) results.push(...items);
    url = data.paging?.next || null;
    logger.info({
      endpoint: label,
      requested_fields: page === 0 ? logParams.fields || null : null,
      params: page === 0 ? logParams : {},
      page: page + 1,
      page_item_count: items.length,
      total_item_count: results.length,
      has_next: Boolean(url),
      token_source: tokenSource || 'unknown',
    }, 'Meta Graph paginated page fetched');
    page++;
  }

  if (url) {
    logger.warn({ path: label, pages: page, total: results.length, maxPages }, 'Meta pagination stopped at max page guard');
  } else {
    logger.info({ path: label, pages: page, total: results.length }, 'Meta pagination complete');
  }

  return results;
}

// ─── Campaign Discovery ───────────────────────────────────────────────

/**
 * Fetch all campaigns from an ad account and upsert into meta_campaigns.
 */
async function syncCampaigns(adAccountId) {
  logger.info({ adAccountId }, 'Syncing campaigns from Meta');
  const normalizedAccountId = normalizeAdAccountId(adAccountId);
  const syncRunId = randomUUID();
  await query(
    `UPDATE meta_ad_accounts
        SET last_sync_attempted_at = NOW(),
            sync_status = CASE WHEN sync_status = 'failed' THEN 'stale' ELSE sync_status END,
            updated_at = NOW()
      WHERE account_id = $1`,
    [normalizedAccountId]
  );

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
        'budget_remaining',
        'spend_cap',
        'special_ad_categories',
      ].join(','),
      limit: 100,
      _useUserToken: true,
    },
    100,
    `${adAccountId}/campaigns`
  );

  let created = 0;
  let updated = 0;
  const seenCampaignIds = [];

  for (const c of campaigns) {
    const label = deriveCampaignLabel(c.name);
    const uiStatus = deriveCampaignUiStatus(c);
    seenCampaignIds.push(String(c.id));

    const result = await query(
      `INSERT INTO meta_campaigns(
         campaign_id, campaign_name, internal_label, ad_account_id, is_active,
         status, meta_status, effective_status, configured_status, ui_status, objective, buying_type,
         start_time, stop_time, meta_created_time, meta_updated_time,
         daily_budget, lifetime_budget, budget_remaining, spend_cap, special_ad_categories,
         raw_meta, source, last_meta_status_checked_at, last_synced_at, sync_status, last_sync_error,
         last_seen_sync_run_id, missing_from_latest_sync, last_seen_at
       )
       VALUES($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, $21::jsonb, 'meta_api', NOW(), NOW(), 'synced', NULL, $22, FALSE, NOW())
       ON CONFLICT(campaign_id) DO UPDATE
         SET campaign_name = EXCLUDED.campaign_name,
             ad_account_id = EXCLUDED.ad_account_id,
             is_active = EXCLUDED.is_active,
             status = EXCLUDED.status,
             meta_status = EXCLUDED.meta_status,
             effective_status = EXCLUDED.effective_status,
             configured_status = EXCLUDED.configured_status,
             ui_status = EXCLUDED.ui_status,
             objective = EXCLUDED.objective,
             buying_type = EXCLUDED.buying_type,
             start_time = EXCLUDED.start_time,
             stop_time = EXCLUDED.stop_time,
             meta_created_time = EXCLUDED.meta_created_time,
             meta_updated_time = EXCLUDED.meta_updated_time,
             daily_budget = EXCLUDED.daily_budget,
             lifetime_budget = EXCLUDED.lifetime_budget,
             budget_remaining = EXCLUDED.budget_remaining,
             spend_cap = EXCLUDED.spend_cap,
             special_ad_categories = EXCLUDED.special_ad_categories,
             raw_meta = EXCLUDED.raw_meta,
             source = 'meta_api',
             last_meta_status_checked_at = NOW(),
             last_synced_at = NOW(),
             sync_status = 'synced',
             last_sync_error = NULL,
             last_seen_sync_run_id = EXCLUDED.last_seen_sync_run_id,
             missing_from_latest_sync = FALSE,
             last_seen_at = NOW(),
             updated_at = NOW()
       RETURNING (xmax = 0) AS is_new`,
      [
        c.id,
        c.name,
        label,
        normalizedAccountId,
        c.effective_status === 'ACTIVE',
        c.status || null,
        c.effective_status || null,
        c.configured_status || null,
        uiStatus,
        c.objective || null,
        c.buying_type || null,
        parseMetaDate(c.start_time),
        parseMetaDate(c.stop_time),
        parseMetaDate(c.created_time),
        parseMetaDate(c.updated_time),
        toBigIntOrNull(c.daily_budget),
        toBigIntOrNull(c.lifetime_budget),
        toBigIntOrNull(c.budget_remaining),
        toBigIntOrNull(c.spend_cap),
        JSON.stringify(Array.isArray(c.special_ad_categories) ? c.special_ad_categories : []),
        JSON.stringify(c),
        syncRunId,
      ]
    );

    if (result.rows[0]?.is_new) created++;
    else updated++;

    await syncCampaignMetrics(c.id).catch(async (err) => {
      logger.warn({ campaign_id: c.id, err: err.message }, 'Meta campaign metrics sync skipped');
      await query(
        `UPDATE meta_campaigns
            SET metrics_error = $2,
                last_metrics_synced_at = NOW()
          WHERE campaign_id = $1`,
        [String(c.id), String(err.message || 'Metrics sync failed').slice(0, 1000)]
      ).catch(updateErr => logger.warn({ campaign_id: c.id, err: updateErr.message }, 'Failed to store Meta metrics error'));
    });
  }

  await query(
    `UPDATE meta_campaigns
        SET missing_from_latest_sync = TRUE,
            sync_status = CASE WHEN sync_status = 'synced' THEN 'missing_from_latest_sync' ELSE sync_status END
      WHERE ad_account_id = $1
        AND (last_seen_sync_run_id IS DISTINCT FROM $2 OR last_seen_sync_run_id IS NULL)`,
    [normalizedAccountId, syncRunId]
  );

  logger.info({
    adAccountId,
    total: campaigns.length,
    created,
    updated,
    campaigns: campaigns.map(c => ({
      id: c.id,
      name: c.name,
      status: c.status,
      configured_status: c.configured_status,
      effective_status: c.effective_status,
    })),
  }, 'Campaign sync complete');
  await updateAdAccountCampaignCounts(normalizedAccountId, 'synced', null, { returnedByApi: campaigns.length, syncRunId });
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
  if (campaignSyncRunning) {
    logger.warn('Meta campaign sync already running; skipping duplicate run');
    return { already_running: true };
  }
  campaignSyncRunning = true;
  const results = {};
  try {
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

    if (!adAccounts.length) {
      throw new Error('No accessible ad accounts found for this token. Reconnect Meta with ads_read/ads_management and correct business access.');
    }

    for (const accId of adAccounts) {
      try {
        results[accId] = await syncCampaigns(accId);
      } catch (err) {
        logger.error({ accId, err: err.message, meta_code: err.metaCode || err.code || null }, 'Failed to sync campaigns for account');
        await updateAdAccountCampaignCounts(normalizeAdAccountId(accId), 'stale_failed', err.message);
        results[accId] = { error: err.message };
      }
    }

    return results;
  } finally {
    campaignSyncRunning = false;
  }
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

function toBigIntOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveCampaignUiStatus(campaign = {}) {
  const raw = String(campaign.effective_status || campaign.configured_status || campaign.status || '').toUpperCase();
  if (raw === 'ACTIVE') return 'Active / On';
  if (raw === 'PAUSED') return 'Off / Paused';
  if (raw === 'ARCHIVED') return 'Archived';
  if (raw === 'DELETED') return 'Deleted';
  if (['IN_PROCESS', 'PENDING_REVIEW', 'DRAFT', 'IN_DRAFT', 'WITH_ISSUES'].includes(raw)) return 'In draft';
  return raw || 'Unknown';
}

function campaignCountBucket(row) {
  const value = String(row.effective_status || row.configured_status || row.status || row.meta_status || '').toUpperCase();
  if (value === 'ACTIVE') return 'active';
  if (value === 'PAUSED') return 'paused';
  if (value === 'ARCHIVED') return 'archived';
  if (value === 'DELETED') return 'deleted';
  if (['IN_PROCESS', 'PENDING_REVIEW', 'DRAFT', 'IN_DRAFT', 'WITH_ISSUES'].includes(value)) return 'draft';
  return null;
}

async function updateAdAccountCampaignCounts(accountId, syncStatus = 'synced', errorMessage = null, options = {}) {
  const normalized = normalizeAdAccountId(accountId);
  const { rows } = await query(
    `SELECT status, meta_status, effective_status, configured_status
       FROM meta_campaigns
      WHERE ad_account_id = $1
        AND missing_from_latest_sync IS NOT TRUE`,
    [normalized]
  );
  const counts = rows.reduce((acc, row) => {
    acc.total += 1;
    const bucket = campaignCountBucket(row);
    if (bucket) acc[bucket] += 1;
    return acc;
  }, { total: 0, active: 0, paused: 0, draft: 0, archived: 0, deleted: 0 });
  const missing = await query(
    `SELECT COUNT(*)::int AS count
       FROM meta_campaigns
      WHERE ad_account_id = $1
        AND missing_from_latest_sync IS TRUE`,
    [normalized]
  );

  await query(
    `UPDATE meta_ad_accounts
        SET campaign_count = $2,
            active_campaign_count = $3,
            paused_campaign_count = $4,
            draft_campaign_count = $5,
            archived_campaign_count = $6,
            deleted_campaign_count = $7,
            sync_status = $8,
            last_sync_error = $9,
            last_synced_at = CASE WHEN $8 = 'synced' THEN NOW() ELSE last_synced_at END,
            last_successful_sync_at = CASE WHEN $8 = 'synced' THEN NOW() ELSE last_successful_sync_at END,
            last_sync_attempted_at = NOW(),
            draft_count_api_available = $10,
            total_returned_by_api = $11,
            missing_from_latest_sync_count = $12,
            last_campaign_sync_run_id = $13,
            updated_at = NOW()
      WHERE account_id = $1`,
    [
      normalized,
      counts.total,
      counts.active,
      counts.paused,
      counts.draft,
      counts.archived,
      counts.deleted,
      syncStatus,
      errorMessage ? String(errorMessage).slice(0, 1000) : null,
      counts.draft > 0,
      options.returnedByApi ?? counts.total,
      missing.rows[0]?.count || 0,
      options.syncRunId || null,
    ]
  );
}

async function syncCampaignMetrics(campaignId) {
  const data = await graphGet(`${campaignId}/insights`, {
    fields: 'impressions,reach,spend,actions,cost_per_action_type',
    date_preset: 'maximum',
    limit: 1,
    _useUserToken: true,
  });
  const row = Array.isArray(data.data) ? data.data[0] : null;
  if (!row) {
    await query(
      `UPDATE meta_campaigns
          SET last_metrics_synced_at = NOW(),
              metrics_error = NULL
        WHERE campaign_id = $1`,
      [String(campaignId)]
    );
    return;
  }
  const actions = Array.isArray(row.actions) ? row.actions : [];
  const costs = Array.isArray(row.cost_per_action_type) ? row.cost_per_action_type : [];
  const leadAction = actions.find(action => /lead/i.test(String(action.action_type || '')));
  const leadCost = costs.find(action => /lead/i.test(String(action.action_type || '')));

  await query(
    `UPDATE meta_campaigns
        SET impressions = $2,
            reach = $3,
            spend = $4,
            leads = $5,
            cost_per_result = $6,
            last_metrics_synced_at = NOW(),
            metrics_error = NULL
      WHERE campaign_id = $1`,
    [
      String(campaignId),
      toBigIntOrNull(row.impressions),
      toBigIntOrNull(row.reach),
      toNumberOrNull(row.spend),
      toBigIntOrNull(leadAction?.value),
      toNumberOrNull(leadCost?.value),
    ]
  );
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
    fields: 'id,name,account_id,account_status,currency,timezone_name,amount_spent,balance,created_time,disable_reason,business',
    _useUserToken: true,
  });
}

/**
 * Fetch all ad accounts for the user.
 */
async function listAdAccounts() {
  const detailed = await discoverAdAccountsDetailed();
  return detailed.accounts;
}

function addDiscoveredAccount(accountsById, account, source) {
  const id = normalizeAdAccountId(account?.account_id || account?.id);
  if (!id) return;
  const existing = accountsById.get(id) || {};
  const sources = Array.isArray(existing.discovery_sources) ? existing.discovery_sources : [];
  const nextSources = [...sources, source].filter(Boolean);
  accountsById.set(id, {
    ...existing,
    ...account,
    account_id: id,
    graph_id: normalizeGraphAdAccountId(id),
    discovery_sources: nextSources.filter((item, index, arr) => arr.findIndex(other => JSON.stringify(other) === JSON.stringify(item)) === index),
  });
}

async function discoverAdAccountsDetailed() {
  const accountFields = [
    'id',
    'name',
    'account_id',
    'account_status',
    'currency',
    'timezone_name',
    'amount_spent',
    'balance',
    'created_time',
    'disable_reason',
    'business',
  ].join(',');
  const accountsById = new Map();
  const discovery = {
    token_source: null,
    sources: [],
    errors: [],
  };

  const directAccounts = await graphGetAll('me/adaccounts', {
    fields: accountFields,
    limit: 100,
    _useUserToken: true,
  }, 100, 'me/adaccounts');
  discovery.sources.push({ source: 'user_adaccounts', endpoint: 'me/adaccounts', count: directAccounts.length });
  directAccounts.forEach(account => {
    addDiscoveredAccount(accountsById, account, { source: 'user_adaccounts', endpoint: 'me/adaccounts' });
  });

  try {
    const businesses = await graphGetAll('me/businesses', {
      fields: 'id,name',
      limit: 100,
      _useUserToken: true,
    }, 50, 'me/businesses');
    discovery.sources.push({ source: 'businesses', endpoint: 'me/businesses', count: businesses.length, businesses: businesses.map(b => ({ id: b.id, name: b.name })) });
    for (const business of businesses) {
      for (const edge of ['owned_ad_accounts', 'client_ad_accounts']) {
        try {
          const businessAccounts = await graphGetAll(`${business.id}/${edge}`, {
            fields: accountFields,
            limit: 100,
            _useUserToken: true,
          }, 100, `${business.id}/${edge}`);
          discovery.sources.push({ source: edge, endpoint: `${business.id}/${edge}`, business_id: business.id, business_name: business.name, count: businessAccounts.length });
          businessAccounts.forEach(account => {
            addDiscoveredAccount(accountsById, {
              ...account,
              business: account.business || { id: business.id, name: business.name },
            }, { source: edge, endpoint: `${business.id}/${edge}`, business_id: business.id, business_name: business.name });
          });
        } catch (err) {
          discovery.errors.push({
            source: edge,
            endpoint: `${business.id}/${edge}`,
            business_id: business.id,
            business_name: business.name,
            error: err.message,
            meta_code: err.metaCode || err.code || null,
          });
          logger.warn({
            business_id: business.id,
            edge,
            err: err.message,
            meta_code: err.metaCode || err.code || null,
          }, 'Meta business ad account discovery failed');
        }
      }
    }
  } catch (err) {
    discovery.errors.push({ source: 'businesses', endpoint: 'me/businesses', error: err.message, meta_code: err.metaCode || err.code || null });
    logger.warn({ err: err.message, meta_code: err.metaCode || err.code || null }, 'Meta business discovery skipped');
  }

  const accounts = Array.from(accountsById.values());
  logger.info({
    total: accounts.length,
    accounts: accounts.map(account => ({
      account_id: account.account_id,
      name: account.name,
      sources: account.discovery_sources,
    })),
  }, 'Meta ad account discovery complete');
  return { accounts, discovery };
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
         business_id, business_name, timezone_name, amount_spent, balance,
         created_time, disable_reason, is_active, last_synced_at, sync_status,
         last_sync_error, raw_meta, discovery_sources, graph_id,
         last_sync_attempted_at, last_successful_sync_at
       )
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, NOW(), 'synced', NULL, $12::jsonb, $13::jsonb, $14, NOW(), NOW())
       ON CONFLICT(account_id) DO UPDATE
         SET account_name = EXCLUDED.account_name,
             account_status = EXCLUDED.account_status,
             currency = EXCLUDED.currency,
             business_id = EXCLUDED.business_id,
             business_name = EXCLUDED.business_name,
             timezone_name = EXCLUDED.timezone_name,
             amount_spent = EXCLUDED.amount_spent,
             balance = EXCLUDED.balance,
             created_time = EXCLUDED.created_time,
             disable_reason = EXCLUDED.disable_reason,
             is_active = TRUE,
             last_synced_at = NOW(),
             sync_status = 'synced',
             last_sync_error = NULL,
             raw_meta = EXCLUDED.raw_meta,
             discovery_sources = EXCLUDED.discovery_sources,
             graph_id = EXCLUDED.graph_id,
             last_sync_attempted_at = NOW(),
             last_successful_sync_at = NOW(),
             updated_at = NOW()
       RETURNING (xmax = 0) AS is_new`,
      [
        accountId,
        account.name || null,
        account.account_status ?? null,
        account.currency || null,
        account.business?.id || null,
        account.business?.name || null,
        account.timezone_name || null,
        toBigIntOrNull(account.amount_spent),
        toBigIntOrNull(account.balance),
        parseMetaDate(account.created_time),
        account.disable_reason ?? null,
        JSON.stringify(account),
        JSON.stringify(account.discovery_sources || []),
        normalizeGraphAdAccountId(accountId),
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

async function debugAccountsCampaigns() {
  const token = await metaTokens.getUserToken().catch(() => null);
  const discovered = await discoverAdAccountsDetailed();
  const accounts = [];

  for (const account of discovered.accounts) {
    const accountId = normalizeAdAccountId(account.account_id || account.id);
    try {
      const campaigns = await graphGetAll(
        `${normalizeGraphAdAccountId(accountId)}/campaigns`,
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
            'budget_remaining',
            'special_ad_categories',
          ].join(','),
          limit: 100,
          _useUserToken: true,
        },
        100,
        `${normalizeGraphAdAccountId(accountId)}/campaigns:debug`
      );
      accounts.push({
        account_id: accountId,
        graph_id: normalizeGraphAdAccountId(accountId),
        name: account.name || null,
        discovery_sources: account.discovery_sources || [],
        status: 'ok',
        campaign_count: campaigns.length,
        draft_unpublished_note: 'Draft/unpublished campaigns may not be returned by the standard campaigns edge for this token/API access. Published, paused, active, archived, and deleted objects returned by Meta API are listed here.',
        campaigns: campaigns.map(campaign => ({
          id: campaign.id,
          name: campaign.name,
          status: campaign.status || null,
          configured_status: campaign.configured_status || null,
          effective_status: campaign.effective_status || null,
          ui_status: deriveCampaignUiStatus(campaign),
        })),
      });
    } catch (err) {
      accounts.push({
        account_id: accountId,
        graph_id: normalizeGraphAdAccountId(accountId),
        name: account.name || null,
        discovery_sources: account.discovery_sources || [],
        status: 'error',
        error: err.message,
        meta_code: err.metaCode || err.code || null,
        action: /ads_management|ads_read|permission/i.test(String(err.message))
          ? 'Reconnect Meta with ads_read/ads_management and ensure the token user/system user has access to this ad account in Business Manager.'
          : 'Check Meta token and Business Manager access for this ad account.',
      });
    }
  }

  return {
    token: {
      configured: Boolean(token?.token),
      source: token?.source || null,
      expires_at: token?.expires_at || null,
    },
    discovery: discovered.discovery,
    accounts,
  };
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
  debugAccountsCampaigns,
  checkConnectivity,
  deriveCampaignLabel,
  ingestGraphLead, // exposed for recovery scripts that need per-page tokens
};
