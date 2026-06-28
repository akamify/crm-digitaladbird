/**
 * Google Sheets Sync Service — dynamic, admin-controlled.
 *
 * Auth precedence (per request):
 *   1. Active row in `integration_configs` (kind='google_sheets', is_active=true)
 *      — admin uploaded the service-account JSON via the Settings UI.
 *   2. Env vars (back-compat): GOOGLE_SERVICE_ACCOUNT_JSON,
 *      GOOGLE_CREDENTIALS_PATH, GOOGLE_SERVICE_ACCOUNT_KEY{,_PATH}
 *
 * The DB-backed row holds the sheet_id, sheet_name AND the encrypted service-
 * account JSON. Admins can swap the active row at any time and the next sync
 * call picks up the new config without restarting PM2. If the DB row only has
 * sheet metadata, credentials fall back to env configuration.
 *
 * The Google Sheet MUST be shared (Editor) with the service account email.
 *
 * Public API (callers don't pass a config — they just call):
 *   - syncAllLeads()       : full sync — clears sheet and re-writes all leads
 *   - appendLead(leadId)   : append a single new lead row
 *   - updateLeadRow(leadId): update an existing row in-place
 *   - checkConnectivity()  : test API access and permissions
 *   - reloadActiveConfig() : drop cached clients so the next call uses new creds
 */
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const { query }  = require('../config/database');
const logger     = require('../utils/logger');
const { decrypt } = require('../utils/secretsCrypto');
const {
  resolveLeadSheetTargets,
  resolveConfiguredSheetNames,
  sanitizeSheetName,
  normalizeCategory,
} = require('./googleSheets/googleSheetNameResolver');
const notificationService = require('./notifications/notificationService');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const SHEET_SYNC_FAILURE_NOTIFY_TTL_MS = 10 * 60 * 1000;
const sheetSyncFailureNotifyCache = new Map();

function parseServiceAccountJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim();
  try { return JSON.parse(text); } catch (_) {}
  try { return JSON.parse(Buffer.from(text, 'base64').toString('utf8')); } catch (_) {}
  return null;
}

function readServiceAccountFile(filePath) {
  if (!filePath) return null;
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) return null;
  const parsed = parseServiceAccountJson(fs.readFileSync(resolved, 'utf8'));
  if (!parsed) throw new Error('GOOGLE_CREDENTIALS_PATH does not contain valid JSON');
  return { creds: parsed, path: resolved };
}

function resolveEnvCredentials() {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    || process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    || '';
  if (rawJson) {
    const creds = parseServiceAccountJson(rawJson);
    if (!creds) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid service-account JSON');
    return { creds, source: 'env_json', keyPath: null };
  }

  const filePath = process.env.GOOGLE_CREDENTIALS_PATH
    || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
    || '';
  const file = readServiceAccountFile(filePath);
  if (file) return { creds: file.creds, source: 'env_path', keyPath: file.path };
  return null;
}

function validateServiceAccount(creds, sourceLabel) {
  if (!creds || !creds.client_email || !creds.private_key) {
    throw new Error(`${sourceLabel} Google credentials are missing client_email/private_key`);
  }
}

function getRoutingConfig(config = {}) {
  return {
    ...config,
    default_sheet_name: sanitizeSheetName(config.default_sheet_name || config.sheet_name || 'Leads') || 'Leads',
    trader_sheet_name: sanitizeSheetName(config.trader_sheet_name || 'Traders') || 'Traders',
    partner_sheet_name: sanitizeSheetName(config.partner_sheet_name || 'Partners') || 'Partners',
    unknown_sheet_name: sanitizeSheetName(config.unknown_sheet_name || 'Unknown Leads') || 'Unknown Leads',
    auto_create_missing_sheets: config.auto_create_missing_sheets !== false,
    category_sheet_routing_enabled: config.category_sheet_routing_enabled !== false,
  };
}

// Cached per-purpose. Multiple sheets can coexist (Traders + Partners), each
// with its own Google client. `null` purpose = legacy/un-tagged sheet.
const _clientCache = new Map(); // purpose → { configId, sheetId, sheetName, purpose, ... }
const _initErrors  = new Map(); // purpose → Error

// ─── Load active config (DB → env fallback) ─────────────────────────

/**
 * @param {'traders'|'partners'|null} purpose
 *   - 'traders'  → loads the active Traders sheet
 *   - 'partners' → loads the active Partners sheet
 *   - null       → backward-compat: any active row, then any active without purpose, then env
 */
async function loadActiveConfig(purpose = null) {
  let dbConfigFallback = null;
  // 1. Active DB row scoped to the requested purpose
  try {
    let sql, params;
    if (purpose) {
      sql = `SELECT id, config, secrets_encrypted, purpose
               FROM integration_configs
              WHERE kind = 'google_sheets' AND is_active = TRUE AND purpose = $1
              LIMIT 1`;
      params = [purpose];
    } else {
      // Backward-compat for legacy callers: prefer un-tagged sheet, else any.
      sql = `SELECT id, config, secrets_encrypted, purpose
               FROM integration_configs
              WHERE kind = 'google_sheets' AND is_active = TRUE
              ORDER BY (purpose IS NULL) DESC, updated_at DESC
              LIMIT 1`;
      params = [];
    }
    const { rows: [row] } = await query(sql, params);
    if (row) {
      dbConfigFallback = { configId: row.id, config: row.config || {}, purpose: row.purpose || null };
    }
    if (row && row.secrets_encrypted) {
      const secrets = decrypt(row.secrets_encrypted);
      validateServiceAccount(secrets, 'Stored');
      const cfg = row.config || {};
      return {
        configId:   row.id,
        sheetId:    cfg.sheet_id || '',
        sheetName:  cfg.sheet_name || 'Leads',
        purpose:    row.purpose || null,
        creds:      secrets,
        source:     'db',
        keyPath:    null,
      };
    }
  } catch (err) {
    if (err.message && /malformed|bad iv|tag|auth/i.test(err.message)) {
      throw new Error('Active Google Sheets credentials in DB cannot be decrypted — re-upload the service-account JSON.');
    }
    // Otherwise (table doesn't exist yet, etc.) fall through to env.
  }

  // 2. Env fallback. If the DB row has sheet metadata but no secrets, keep
  // the DB sheet details and resolve credentials from the environment.
  const sheetId = dbConfigFallback?.config?.sheet_id || process.env.GOOGLE_SHEET_ID || '';
  const envCreds = resolveEnvCredentials();
  if (!sheetId) throw new Error('No active Google Sheets config — upload credentials in Settings → Google Sheets.');
  if (!envCreds) throw new Error('No Google credentials configured — upload service-account JSON in Settings or set GOOGLE_CREDENTIALS_PATH.');

  validateServiceAccount(envCreds.creds, 'Environment');
  return {
    configId:  dbConfigFallback?.configId || null,
    sheetId,
    sheetName: dbConfigFallback?.config?.sheet_name || process.env.GOOGLE_SHEET_NAME || 'Leads',
    purpose:   dbConfigFallback?.purpose || null,
    creds:     envCreds.creds,
    source:    envCreds.source,
    keyPath:   envCreds.keyPath,
  };
}

async function initClients(purpose = null) {
  const cached = _clientCache.get(purpose);
  if (cached) return cached;
  if (_initErrors.has(purpose)) throw _initErrors.get(purpose);

  try {
    const cfg = await loadActiveConfig(purpose);
    const auth = new google.auth.GoogleAuth({ credentials: cfg.creds, scopes: SCOPES });
    const client = await auth.getClient();
    const entry = {
      configId:    cfg.configId,
      sheetId:     cfg.sheetId,
      sheetName:   cfg.sheetName,
      purpose:     cfg.purpose,
      clientEmail: cfg.creds.client_email,
      source:      cfg.source,
      keyPath:     cfg.keyPath || null,
      sheets:      google.sheets({ version: 'v4', auth: client }),
      drive:       google.drive({ version: 'v3', auth: client }),
    };
    _clientCache.set(purpose, entry);
    logger.info({ purpose, source: cfg.source, sheetId: cfg.sheetId.slice(0, 8) + '…' }, '[Sheets] Google APIs initialized');
    return entry;
  } catch (err) {
    _initErrors.set(purpose, err);
    logger.error({ purpose, err: err.message }, '[Sheets] Failed to initialize Google APIs');
    throw err;
  }
}

/** Lazy init for legacy callers — uses the un-purposed/env fallback. */
async function getSheets(purpose = null) {
  try { return (await initClients(purpose)).sheets; }
  catch { return null; }
}

/** Wipe cached clients across ALL purposes. Called after admin updates a config. */
function resetClients() {
  _clientCache.clear();
  _initErrors.clear();
}

/** Public alias used by the admin route after a config change. */
function reloadActiveConfig() { resetClients(); }

/** Currently-active sheet ID (env or DB), exposed for the legacy callers. */
async function getActiveSheetId() {
  try { return (await initClients()).sheetId; }
  catch { return ''; }
}
async function getActiveSheetName() {
  try { return (await initClients()).sheetName; }
  catch { return 'Leads'; }
}
async function getActiveClientEmail() {
  try { return (await initClients()).clientEmail; }
  catch { return null; }
}

async function getRoutingBaseConfig() {
  const { rows: [row] } = await query(
    `SELECT id, config
       FROM integration_configs
      WHERE kind = 'google_sheets' AND is_active = TRUE
      ORDER BY (purpose IS NULL) DESC, updated_at DESC
      LIMIT 1`,
  );
  return row ? { id: row.id, config: getRoutingConfig(row.config || {}) } : null;
}

async function ensureEnvBackedRoutingConfig({ fallback, config }) {
  if (!fallback?.configured || !fallback?.sheet_id) {
    const error = new Error('Google Sheets is not configured on the server.');
    error.code = 'GOOGLE_SHEETS_NOT_CONFIGURED';
    throw error;
  }

  const merged = {
    ...(config || {}),
    source: fallback.source || 'env_path',
    credentials_managed_by: 'server',
    sheet_id: fallback.sheet_id,
    sheet_name: config?.sheet_name || config?.default_sheet_name || fallback.sheet_name || 'Leads',
    default_sheet_name: config?.default_sheet_name || fallback.sheet_name || 'Leads',
    trader_sheet_name: config?.trader_sheet_name || null,
    partner_sheet_name: config?.partner_sheet_name || null,
    unknown_sheet_name: config?.unknown_sheet_name || null,
    auto_create_missing_sheets: config?.auto_create_missing_sheets !== false,
    category_sheet_routing_enabled: config?.category_sheet_routing_enabled !== false,
    service_account_email: fallback.service_account_email || null,
    key_path: fallback.key_path || null,
  };

  const { rows: [existing] } = await query(
    `SELECT id
       FROM integration_configs
      WHERE kind = 'google_sheets' AND COALESCE(purpose, '') = ''
      ORDER BY is_active DESC, updated_at DESC
      LIMIT 1`,
  );

  if (existing?.id) {
    await query(
      `UPDATE integration_configs
          SET label = $1,
              config = $2,
              is_active = TRUE,
              updated_at = NOW()
        WHERE id = $3`,
      ['Server Google Sheets', JSON.stringify(merged), existing.id],
    );
    return existing.id;
  }

  const { rows: [created] } = await query(
    `INSERT INTO integration_configs(kind, label, purpose, config, is_active)
     VALUES ('google_sheets', $1, NULL, $2, TRUE)
     RETURNING id`,
    ['Server Google Sheets', JSON.stringify(merged)],
  );
  return created.id;
}

async function resolveConfigStatus(purpose = null) {
  try {
    const cfg = await loadActiveConfig(purpose);
    const routing = getRoutingConfig(await getRoutingBaseConfig().then(r => r?.config || cfg));
    return {
      configured: !!(cfg.sheetId && cfg.creds?.client_email && cfg.creds?.private_key),
      source: cfg.source,
      sheet_id: cfg.sheetId || null,
      sheet_name: cfg.sheetName || 'Leads',
      default_sheet_name: routing.default_sheet_name,
      trader_sheet_name: routing.trader_sheet_name || null,
      partner_sheet_name: routing.partner_sheet_name || null,
      unknown_sheet_name: routing.unknown_sheet_name || null,
      auto_create_missing_sheets: routing.auto_create_missing_sheets,
      category_sheet_routing_enabled: routing.category_sheet_routing_enabled,
      service_account_email: cfg.creds?.client_email || null,
      key_path: cfg.keyPath || null,
      config_id: cfg.configId || null,
      purpose: cfg.purpose || null,
      has_credentials: !!(cfg.creds?.client_email && cfg.creds?.private_key),
    };
  } catch (err) {
    return {
      configured: false,
      source: null,
      sheet_id: process.env.GOOGLE_SHEET_ID || null,
      sheet_name: process.env.GOOGLE_SHEET_NAME || 'Leads',
      service_account_email: null,
      key_path: process.env.GOOGLE_CREDENTIALS_PATH || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || null,
      config_id: null,
      purpose: purpose || null,
      has_credentials: false,
      error: err.message,
    };
  }
}

// ─── Retry wrapper ──────────────────────────────────────────────────

async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status || err?.code;
      // Don't retry on auth errors or bad requests
      if (status === 401 || status === 403 || status === 400) throw err;
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt;
        logger.warn({ attempt, err: err.message, delay }, `[Sheets] ${label} — retrying`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

async function ensureSheetExists({ sheets, spreadsheetId, sheetName, headers = HEADERS, autoCreate = true }) {
  const targetName = sanitizeSheetName(sheetName);
  if (!targetName) throw new Error('Sheet tab name is missing.');

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });
  const sheetList = meta.data.sheets || [];
  const existing = sheetList.find((sheet) => sheet.properties?.title === targetName);

  if (!existing) {
    if (!autoCreate) {
      throw new Error(`Google Sheet tab "${targetName}" does not exist. Please create it or enable auto-create.`);
    }
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: targetName } } }],
      },
    });
  }

  const current = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${targetName}!A1:AB1`,
  }).catch(() => ({ data: { values: [] } }));

  const headerRow = current.data.values?.[0] || [];
  const missingColumns = getMissingHeaderColumns(headerRow, headers);
  if (!current.data.values || current.data.values.length === 0 || missingColumns.length > 0 || !headersMatchExactly(headerRow, headers)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${targetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }

  return targetName;
}

async function updateLeadSheetSyncMeta(leadId, sync) {
  if (!leadId) return;
  await query(
    `UPDATE leads
        SET google_sheet_last_synced_at = CASE WHEN $2::boolean THEN NOW() ELSE google_sheet_last_synced_at END,
            google_sheet_last_spreadsheet_id = COALESCE($3, google_sheet_last_spreadsheet_id),
            google_sheet_last_sheet_name = COALESCE($4, google_sheet_last_sheet_name),
            google_sheet_last_sync_error = $5
      WHERE id = $1`,
    [leadId, !!sync.ok, sync.spreadsheetId || null, sync.sheetName || null, sync.error || null],
  ).catch(() => {});
}

function normalizeSyncError(error) {
  return String(error || 'unknown_error').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function sheetSyncFailureDedupeKey({ sheetName, spreadsheetId, error }) {
  return [
    'google_sheet_sync_failed',
    spreadsheetId || 'no_spreadsheet',
    sheetName || 'unknown_sheet',
    normalizeSyncError(error),
  ].join(':');
}

function shouldNotifySheetSyncFailure(input) {
  const dedupeKey = sheetSyncFailureDedupeKey(input);
  const now = Date.now();
  const existingUntil = sheetSyncFailureNotifyCache.get(dedupeKey) || 0;
  if (existingUntil > now) return { notify: false, dedupeKey };

  sheetSyncFailureNotifyCache.set(dedupeKey, now + SHEET_SYNC_FAILURE_NOTIFY_TTL_MS);

  if (sheetSyncFailureNotifyCache.size > 200) {
    for (const [key, until] of sheetSyncFailureNotifyCache.entries()) {
      if (until <= now) sheetSyncFailureNotifyCache.delete(key);
    }
  }

  return { notify: true, dedupeKey };
}

async function notifySheetSyncFailure({ lead, sheetName, spreadsheetId, error }) {
  try {
    const { notify, dedupeKey } = shouldNotifySheetSyncFailure({ sheetName, spreadsheetId, error });
    if (!notify) {
      logger.warn(
        { leadId: lead?.id, sheetName, spreadsheetId, error },
        '[Sheets] Repeated sync failure notification suppressed',
      );
      return;
    }

    await notificationService.notifyAdmins(
      'google_sheet_sync_failed',
      'Google Sheet Sync Failed',
      `Google Sheet sync failed for one or more leads on sheet tab ${sheetName}.`,
      {
        event_type: 'google_sheet_sync_failed',
        dedupe_key: dedupeKey,
        lead_id: lead?.id || null,
        lead_category: normalizeCategory(lead?.category),
        spreadsheet_id: spreadsheetId || null,
        sheet_name: sheetName || null,
        error_message: normalizeSyncError(error),
      },
    );
  } catch (_) {
    // Best effort only.
  }
}

// ─── Headers & row formatting ───────────────────────────────────────

const HEADERS = [
  'Lead ID', 'Name', 'Phone', 'Email', 'Campaign', 'Campaign Name', 'Ad Set', 'Ad Name', 'RM',
  'Lead Type', 'Status', 'Call Status', 'Stage', 'Source',
  'Assigned To', 'Team', 'Created Time', 'Last Updated',
  'Assignment Status', 'Reassigned From', 'Reassigned To', 'Reassigned At',
  'Last Contacted', 'Last Contacted By', 'Sync Status', 'CRM Updated At',
  'Sheet Updated At', 'Notes',
];

function leadToRow(l) {
  const category = normalizeCategory(l.lead_type || l.category || l.type || l.lead_category);
  const campaignName = firstValue(
    l.campaign_name,
    l.meta_campaign_name,
    l.meta_campaign_table_name,
    l.meta_campaign_label,
    l.campaign_label,
    l.campaign,
    l.campaign_code,
  );
  const campaign = firstValue(l.campaign, l.campaign_code, l.campaign_label, l.meta_campaign_label, campaignName);
  const rmName = firstValue(l.rm_name, l.report_to_name, l.team_rm_name);
  const assignedName = firstValue(l.assigned_to_name, l.assigned_user_name);
  const teamName = firstValue(l.team_name, l.rm_team_name, rmName ? `Team ${rmName}` : '');
  const status = firstValue(l.status, '');
  const callStatus = firstValue(l.call_status, 'not_called');
  const stage = firstValue(l.stage, status, 'new');

  return [
    firstValue(l.id, l.lead_id),
    firstValue(l.full_name, l.name, l.customer_name),
    firstValue(l.normalized_phone, l.phone),
    firstValue(l.email, l.meta_email),
    campaign,
    campaignName,
    firstValue(l.adset_name, l.ad_set_name, l.meta_adset_name),
    firstValue(l.ad_name, l.meta_ad_name),
    rmName,
    category,
    status,
    callStatus,
    stage,
    firstValue(l.source, 'manual'),
    assignedName,
    teamName,
    l.created_at ? formatIST(l.created_at) : '',
    l.updated_at ? formatIST(l.updated_at) : '',
    firstValue(l.assignment_status, l.assigned_to_user_id ? 'Assigned' : 'Unassigned'),
    firstValue(l.reassigned_from_name),
    firstValue(l.reassigned_to_name),
    l.reassigned_at ? formatIST(l.reassigned_at) : '',
    l.last_contacted_at ? formatIST(l.last_contacted_at) : (l.last_call_at ? formatIST(l.last_call_at) : ''),
    firstValue(l.last_contacted_by_name),
    firstValue(l.sync_status, 'Synced'),
    l.updated_at ? formatIST(l.updated_at) : '',
    firstValue(l.sheet_updated_at),
    firstValue(l.latest_note, l.last_call_note),
  ];
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function getMissingHeaderColumns(currentHeader = [], requiredHeader = HEADERS) {
  const current = new Set((currentHeader || []).map((value) => String(value || '').trim()));
  return requiredHeader.filter((header) => !current.has(header));
}

function headersMatchExactly(currentHeader = [], requiredHeader = HEADERS) {
  return requiredHeader.every((header, index) => String(currentHeader[index] || '').trim() === header)
    && currentHeader.length === requiredHeader.length;
}

async function getSheetHeaderStatus({ sheets, spreadsheetId, sheetName }) {
  const targetName = sanitizeSheetName(sheetName);
  if (!targetName) {
    return { sheet_name: '', exists: false, missing: true, header_valid: false, header_missing_columns: HEADERS };
  }
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });
  const exists = (meta.data.sheets || []).some((sheet) => sheet.properties?.title === targetName);
  if (!exists) {
    return {
      sheet_name: targetName,
      exists: false,
      missing: true,
      header_valid: false,
      header_missing_columns: HEADERS,
      message: 'Sheet tab not found.',
    };
  }
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${targetName}!A1:AB1`,
  }).catch(() => ({ data: { values: [] } }));
  const header = current.data.values?.[0] || [];
  const missingColumns = getMissingHeaderColumns(header);
  return {
    sheet_name: targetName,
    exists: true,
    missing: false,
    header_valid: missingColumns.length === 0 && headersMatchExactly(header),
    header_missing_columns: missingColumns,
  };
}

async function upsertLeadToSheet({ sheets, spreadsheetId, sheetName, lead, autoCreate }) {
  const targetSheet = await ensureSheetExists({
    sheets,
    spreadsheetId,
    sheetName,
    headers: HEADERS,
    autoCreate,
  });
  const leadId = String(lead.id || lead.lead_id || '').trim();
  if (!leadId) throw new Error('Lead ID is required for Google Sheet upsert.');

  const existingData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${targetSheet}!A:A`,
  }).catch(() => ({ data: { values: [] } }));
  const rows = existingData.data.values || [];
  const rowIndex = rows.findIndex((row) => String(row[0] || '').trim() === leadId);
  const values = [leadToRow(lead)];

  if (rowIndex >= 0) {
    const rowNum = rowIndex + 1;
    await withRetry(async () => {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${targetSheet}!A${rowNum}:AB${rowNum}`,
        valueInputOption: 'RAW',
        requestBody: { values },
      });
    }, `upsertUpdate:${targetSheet}`);
    return { sheetName: targetSheet, action: 'updated', row: rowNum };
  }

  await withRetry(async () => {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${targetSheet}!A:AB`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
  }, `upsertAppend:${targetSheet}`);
  return { sheetName: targetSheet, action: 'appended', row: null };
}

function buildRoutingDemoLead(category) {
  const normalized = normalizeCategory(category);
  const now = new Date();
  const label = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return {
    id: `DEMO-${normalized.toUpperCase()}-ROUTING`,
    full_name: `${label} Demo Lead`,
    phone: '+910000000000',
    email: `${normalized}.demo@digitaladbird.test`,
    campaign: 'DEMO',
    campaign_name: `${label} Google Sheet Routing Test`,
    adset_name: 'Demo Ad Set',
    ad_name: 'Demo Ad',
    rm_name: 'Demo RM',
    category: normalized,
    status: 'test',
    call_status: 'not_called',
    stage: 'new',
    source: 'google_sheet_test',
    assigned_to_name: 'Demo Member',
    team_name: 'Demo Team',
    created_at: now,
    updated_at: now,
  };
}

async function writeRoutingDemoRows({ sheets, spreadsheetId, config }) {
  const writes = {};
  for (const category of ['trader', 'partner', 'unknown']) {
    const lead = buildRoutingDemoLead(category);
    const targets = resolveLeadSheetTargets({ lead, config });
    writes[category] = [];
    for (const target of targets) {
      const result = await upsertLeadToSheet({
        sheets,
        spreadsheetId,
        sheetName: target.sheetName,
        lead,
        autoCreate: false,
      });
      writes[category].push({ ...target, ...result });
    }
  }
  return writes;
}

function formatIST(dateStr) {
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
  } catch { return String(dateStr); }
}

// ─── Lead query (shared) ────────────────────────────────────────────

const LEAD_SELECT_SQL = `
  SELECT l.*,
         u.full_name AS assigned_to_name,
         u.team_name,
         rm.full_name AS rm_name,
         rm.team_name AS rm_team_name,
         mc.internal_label AS meta_campaign_label,
         mc.campaign_name AS meta_campaign_name
         ,CASE WHEN assignment.previous_user_id IS NOT NULL THEN 'Reassigned'
               WHEN l.assigned_to_user_id IS NOT NULL THEN 'Assigned' ELSE 'Unassigned' END AS assignment_status
         ,previous_user.full_name AS reassigned_from_name
         ,assignment_user.full_name AS reassigned_to_name
         ,assignment.created_at AS reassigned_at
         ,COALESCE(l.last_call_at, latest_remark.created_at) AS last_contacted_at
         ,remark_user.full_name AS last_contacted_by_name
         ,latest_remark.remark AS latest_note
    FROM leads l
    LEFT JOIN users u  ON u.id = l.assigned_to_user_id
    LEFT JOIN users rm ON rm.id = u.report_to_id
    LEFT JOIN meta_campaigns mc ON mc.campaign_id = l.meta_campaign_id
    LEFT JOIN LATERAL (
      SELECT la.previous_user_id, la.assigned_to_user_id, COALESCE(la.created_at, la.assigned_at) AS created_at
        FROM lead_assignments la
       WHERE la.lead_id = l.id
       ORDER BY COALESCE(la.created_at, la.assigned_at) DESC
       LIMIT 1
    ) assignment ON TRUE
    LEFT JOIN users previous_user ON previous_user.id = assignment.previous_user_id
    LEFT JOIN users assignment_user ON assignment_user.id = assignment.assigned_to_user_id
    LEFT JOIN LATERAL (
      SELECT lr.remark, lr.created_at, lr.user_id
        FROM lead_remarks lr WHERE lr.lead_id = l.id
       ORDER BY lr.created_at DESC LIMIT 1
    ) latest_remark ON TRUE
    LEFT JOIN users remark_user ON remark_user.id = latest_remark.user_id
   WHERE l.deleted_at IS NULL
`;

// ─── Full sync ──────────────────────────────────────────────────────

async function syncAllLeads() {
  const c = await initClients();
  const SHEET_ID = c.sheetId, sheets = c.sheets;
  const routingBase = await getRoutingBaseConfig();
  const routingConfig = getRoutingConfig(routingBase?.config || { sheet_name: c.sheetName });

  const { rows } = await query(LEAD_SELECT_SQL + ' ORDER BY l.created_at DESC');
  if (rows.length === 0) {
    logger.info('[Sheets] No leads to sync');
    return { synced: 0 };
  }

  const grouped = new Map();
  for (const lead of rows) {
    for (const target of resolveLeadSheetTargets({ lead, config: routingConfig })) {
      if (!grouped.has(target.sheetName)) grouped.set(target.sheetName, []);
      grouped.get(target.sheetName).push(lead);
    }
  }

  for (const [sheetName, leads] of grouped.entries()) {
    const targetSheet = await ensureSheetExists({
      sheets,
      spreadsheetId: SHEET_ID,
      sheetName,
      headers: HEADERS,
      autoCreate: routingConfig.auto_create_missing_sheets,
    });
    await withRetry(async () => {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `${targetSheet}!A:AB`,
      });
    }, `clear:${targetSheet}`);

    await withRetry(async () => {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${targetSheet}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [HEADERS, ...leads.map(leadToRow)] },
      });
    }, `fullSync:${targetSheet}`);

    for (const lead of leads) {
      await updateLeadSheetSyncMeta(lead.id, {
        ok: true,
        spreadsheetId: SHEET_ID,
        sheetName: targetSheet,
        error: null,
      });
    }
  }

  if (c.configId) {
    await query(
      `UPDATE integration_configs SET last_synced_at = NOW(), last_sync_count = $1 WHERE id = $2`,
      [rows.length, c.configId],
    ).catch(() => {});
  }

  logger.info({ count: rows.length }, '[Sheets] Full sync complete');
  return { synced: rows.length };
}

// ─── Append single lead ─────────────────────────────────────────────

async function appendLead(leadId) {
  let c;
  try { c = await initClients(); } catch { return { appended: false, reason: 'disabled' }; }
  const SHEET_ID = c.sheetId, sheets = c.sheets;
  const routingBase = await getRoutingBaseConfig();
  const routingConfig = getRoutingConfig(routingBase?.config || { sheet_name: c.sheetName });

  const { rows: [l] } = await query(
    LEAD_SELECT_SQL + ' AND l.id = $1',
    [leadId]
  );
  if (!l) {
    logger.warn({ leadId }, '[Sheets] Lead not found for append');
    return { appended: false, reason: 'not_found' };
  }

  const targets = resolveLeadSheetTargets({ lead: l, config: routingConfig });
  const results = [];
  try {
    for (const target of targets) {
      const result = await upsertLeadToSheet({
        sheets,
        spreadsheetId: SHEET_ID,
        sheetName: target.sheetName,
        lead: l,
        autoCreate: routingConfig.auto_create_missing_sheets,
      });
      results.push({ ...target, ...result });
    }
    await updateLeadSheetSyncMeta(leadId, {
      ok: true,
      spreadsheetId: SHEET_ID,
      sheetName: results.map((result) => result.sheetName).join(', '),
      error: null,
    });
  } catch (err) {
    await updateLeadSheetSyncMeta(leadId, {
      ok: false,
      spreadsheetId: SHEET_ID,
      sheetName: results.map((result) => result.sheetName).join(', ') || null,
      error: err.message,
    });
    await notifySheetSyncFailure({
      lead: l,
      sheetName: results.map((result) => result.sheetName).join(', ') || 'Google Sheets',
      spreadsheetId: SHEET_ID,
      error: err.message,
    });
    throw err;
  }

  logger.info({ leadId, name: l.full_name, sheets: results.map((result) => result.sheetName) }, '[Sheets] Lead upserted');
  return {
    appended: results.some((result) => result.action === 'appended'),
    updated: results.some((result) => result.action === 'updated'),
    targets: results,
  };
}

// ─── Update existing lead row ───────────────────────────────────────

async function updateLeadRow(leadId) {
  let c;
  try { c = await initClients(); } catch { return { updated: false, reason: 'disabled' }; }
  const SHEET_ID = c.sheetId, sheets = c.sheets;
  const routingBase = await getRoutingBaseConfig();
  const routingConfig = getRoutingConfig(routingBase?.config || { sheet_name: c.sheetName });

  const { rows: [l] } = await query(LEAD_SELECT_SQL + ' AND l.id = $1', [leadId]);
  if (!l) return { updated: false, reason: 'not_found' };

  const targets = resolveLeadSheetTargets({ lead: l, config: routingConfig });
  const results = [];
  try {
    for (const target of targets) {
      const result = await upsertLeadToSheet({
        sheets,
        spreadsheetId: SHEET_ID,
        sheetName: target.sheetName,
        lead: l,
        autoCreate: routingConfig.auto_create_missing_sheets,
      });
      results.push({ ...target, ...result });
    }
    await updateLeadSheetSyncMeta(leadId, {
      ok: true,
      spreadsheetId: SHEET_ID,
      sheetName: results.map((result) => result.sheetName).join(', '),
      error: null,
    });
  } catch (err) {
    await updateLeadSheetSyncMeta(leadId, {
      ok: false,
      spreadsheetId: SHEET_ID,
      sheetName: results.map((result) => result.sheetName).join(', ') || null,
      error: err.message,
    });
    await notifySheetSyncFailure({
      lead: l,
      sheetName: results.map((result) => result.sheetName).join(', ') || 'Google Sheets',
      spreadsheetId: SHEET_ID,
      error: err.message,
    });
    throw err;
  }

  logger.info({ leadId, sheets: results.map((result) => result.sheetName) }, '[Sheets] Lead rows upserted');
  return { updated: true, targets: results };
}

// ─── Connectivity check ─────────────────────────────────────────────

async function checkConnectivity() {
  const result = {
    configured: false,
    source: null,
    sheet_id: '',
    sheet_name: 'Leads',
    service_account_email: '',
    api_connected: false,
    sheet_accessible: false,
    sheet_title: null,
    row_count: 0,
    error: null,
  };

  let c;
  try {
    c = await initClients();
  } catch (err) {
    result.error = err.message;
    return result;
  }
  result.configured = true;
  result.sheet_id = c.sheetId;
  result.sheet_name = c.sheetName;
  result.service_account_email = c.clientEmail;
  result.source = c.source || (c.configId ? 'db' : 'env');

  try {
    result.api_connected = true;
    const sheets = c.sheets;
    const SHEET_ID = c.sheetId, SHEET_NAME = c.sheetName;

    // Test sheet access
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
      fields: 'properties.title,sheets.properties',
    });
    result.sheet_accessible = true;
    result.sheet_title = meta.data.properties?.title || '';

    // Count rows
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:A`,
    });
    result.row_count = Math.max(0, (res.data.values?.length || 0) - 1); // minus header
  } catch (err) {
    result.error = err.message;
    if (err?.response?.status === 403) {
      result.error = 'Permission denied — share the sheet with: ' + (c.clientEmail || 'the service account email');
    } else if (err?.response?.status === 404) {
      result.error = 'Sheet not found — check GOOGLE_SHEET_ID';
    }
  }

  return result;
}

// ─── Drive: list shared sheets ──────────────────────────────────────

async function listSharedSheets() {
  try {
    const { drive } = await initClients();
    const res = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet'",
      fields: 'files(id,name,webViewLink,modifiedTime)',
      pageSize: 20,
    });
    return res.data.files || [];
  } catch (err) {
    logger.error({ err: err.message }, '[Sheets] Failed to list shared sheets');
    return [];
  }
}

// ─── Ad-hoc credential test (no caching, used by the admin "Test" button) ──

async function testCredentials({ creds, sheetId, sheetName = 'Leads' }) {
  if (!sheetId) return { ok: false, error: 'sheet_id is required' };
  if (!creds || !creds.client_email || !creds.private_key) return { ok: false, error: 'Invalid service-account JSON' };
  try {
    const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'properties.title,sheets.properties' });
    const tabs = (meta.data.sheets || []).map(s => s.properties?.title).filter(Boolean);
    let rowCount = 0;
    try {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${sheetName}!A:A` });
      rowCount = Math.max(0, (res.data.values?.length || 0) - 1);
    } catch (_) { /* sheet tab may not exist yet */ }
    return {
      ok: true,
      sheet_title: meta.data.properties?.title || '',
      service_account_email: creds.client_email,
      tabs,
      row_count: rowCount,
    };
  } catch (err) {
    const status = err?.response?.status;
    let msg = err.message;
    if (status === 403) msg = `Permission denied — share the sheet with ${creds.client_email} (Editor access).`;
    else if (status === 404) msg = 'Sheet not found — check the Sheet ID.';
    return { ok: false, error: msg };
  }
}

// ─── Preview last N rows of the active sheet (admin Preview button) ────

async function previewRows(limit = 10, purpose = null) {
  const c = await initClients(purpose);
  const res = await c.sheets.spreadsheets.values.get({
    spreadsheetId: c.sheetId,
    range: `${c.sheetName}!A1:AB${Math.max(2, limit + 1)}`,
  });
  const values = res.data.values || [];
  const header = values[0] || [];
  return {
    sheet_id:   c.sheetId,
    sheet_name: c.sheetName,
    purpose:    c.purpose,
    header,
    rows: values.slice(1),
  };
}

async function getSheetRoutingSettings() {
  const base = await getRoutingBaseConfig();
  const fallback = await resolveConfigStatus();
  const config = getRoutingConfig(base?.config || {
    sheet_id: fallback.sheet_id,
    sheet_name: fallback.sheet_name,
  });
  return {
    connected: !!fallback.configured,
    source: fallback.source || null,
    config_id: base?.id || fallback.config_id || null,
    spreadsheet_id: fallback.sheet_id || null,
    default_sheet_name: config.default_sheet_name,
    trader_sheet_name: config.trader_sheet_name || '',
    partner_sheet_name: config.partner_sheet_name || '',
    unknown_sheet_name: config.unknown_sheet_name || '',
    auto_create_missing_sheets: config.auto_create_missing_sheets,
    category_sheet_routing_enabled: config.category_sheet_routing_enabled,
    service_account_email: fallback.service_account_email || null,
    key_path: fallback.key_path || null,
    credentials_managed_by: 'server',
    editable_fields: [
      'spreadsheet_id',
      'default_sheet_name',
      'trader_sheet_name',
      'partner_sheet_name',
      'unknown_sheet_name',
      'category_sheet_routing_enabled',
      'auto_create_missing_sheets',
    ],
  };
}

async function updateSheetRoutingSettings(patch = {}) {
  const base = await getRoutingBaseConfig();
  const fallback = await resolveConfigStatus();
  const canUseEnvFallback = !base?.id && fallback?.configured && fallback?.source;
  if (!base?.id && !fallback.config_id && !canUseEnvFallback) {
    const error = new Error('Google Sheets is not configured on the server.');
    error.code = 'GOOGLE_SHEETS_NOT_CONFIGURED';
    throw error;
  }

  const baseConfig = getRoutingConfig(base?.config || {
    sheet_id: fallback.sheet_id,
    sheet_name: fallback.sheet_name,
  });
  const next = { ...baseConfig };

  if (patch.default_sheet_name !== undefined) next.default_sheet_name = sanitizeSheetName(patch.default_sheet_name) || 'Leads';
  if (patch.trader_sheet_name !== undefined) next.trader_sheet_name = sanitizeSheetName(patch.trader_sheet_name || '');
  if (patch.partner_sheet_name !== undefined) next.partner_sheet_name = sanitizeSheetName(patch.partner_sheet_name || '');
  if (patch.unknown_sheet_name !== undefined) next.unknown_sheet_name = sanitizeSheetName(patch.unknown_sheet_name || '');
  if (patch.auto_create_missing_sheets !== undefined) next.auto_create_missing_sheets = !!patch.auto_create_missing_sheets;
  if (patch.category_sheet_routing_enabled !== undefined) next.category_sheet_routing_enabled = !!patch.category_sheet_routing_enabled;

  if (!next.default_sheet_name) {
    throw new Error('Default Sheet Name is required.');
  }
  if (next.category_sheet_routing_enabled) {
    if (!next.trader_sheet_name) throw new Error('Trader Lead Sheet Name is required when category routing is enabled.');
    if (!next.partner_sheet_name) throw new Error('Partner Lead Sheet Name is required when category routing is enabled.');
  }
  if (!next.unknown_sheet_name) {
    next.unknown_sheet_name = next.default_sheet_name;
  }

  const merged = {
    ...(base?.config || {}),
    ...next,
    sheet_id: (base?.config?.sheet_id || fallback.sheet_id || null),
    default_sheet_name: next.default_sheet_name,
    trader_sheet_name: next.trader_sheet_name || null,
    partner_sheet_name: next.partner_sheet_name || null,
    unknown_sheet_name: next.unknown_sheet_name || null,
    auto_create_missing_sheets: next.auto_create_missing_sheets,
    category_sheet_routing_enabled: next.category_sheet_routing_enabled,
  };
  if (!merged.sheet_name) merged.sheet_name = next.default_sheet_name;

  const targetConfigId = base?.id || fallback.config_id || await ensureEnvBackedRoutingConfig({ fallback, config: merged });
  await query(`UPDATE integration_configs SET config = $1, updated_at = NOW() WHERE id = $2`, [JSON.stringify(merged), targetConfigId]);
  resetClients();
  return getSheetRoutingSettings();
}

async function testSheetRouting(input = 'unknown') {
  const c = await initClients();
  const settings = typeof input === 'string'
    ? await getSheetRoutingSettings()
    : { ...(await getSheetRoutingSettings()), ...(input || {}) };
  const config = getRoutingConfig({
    sheet_name: settings.default_sheet_name,
    default_sheet_name: settings.default_sheet_name,
    trader_sheet_name: settings.trader_sheet_name,
    partner_sheet_name: settings.partner_sheet_name,
    unknown_sheet_name: settings.unknown_sheet_name,
    auto_create_missing_sheets: settings.auto_create_missing_sheets,
    category_sheet_routing_enabled: settings.category_sheet_routing_enabled,
  });
  const names = resolveConfiguredSheetNames(config);
  let [master, trader, partner, unknown] = await Promise.all([
    getSheetHeaderStatus({ sheets: c.sheets, spreadsheetId: c.sheetId, sheetName: names.defaultSheetName }),
    getSheetHeaderStatus({ sheets: c.sheets, spreadsheetId: c.sheetId, sheetName: names.traderSheetName }),
    getSheetHeaderStatus({ sheets: c.sheets, spreadsheetId: c.sheetId, sheetName: names.partnerSheetName }),
    getSheetHeaderStatus({ sheets: c.sheets, spreadsheetId: c.sheetId, sheetName: names.unknownSheetName }),
  ]);
  if ([master, trader, partner, unknown].every((status) => status.exists)) {
    await Promise.all([
      ensureSheetExists({ sheets: c.sheets, spreadsheetId: c.sheetId, sheetName: names.defaultSheetName, headers: HEADERS, autoCreate: false }),
      ensureSheetExists({ sheets: c.sheets, spreadsheetId: c.sheetId, sheetName: names.traderSheetName, headers: HEADERS, autoCreate: false }),
      ensureSheetExists({ sheets: c.sheets, spreadsheetId: c.sheetId, sheetName: names.partnerSheetName, headers: HEADERS, autoCreate: false }),
      ensureSheetExists({ sheets: c.sheets, spreadsheetId: c.sheetId, sheetName: names.unknownSheetName, headers: HEADERS, autoCreate: false }),
    ]);
    [master, trader, partner, unknown] = await Promise.all([
      getSheetHeaderStatus({ sheets: c.sheets, spreadsheetId: c.sheetId, sheetName: names.defaultSheetName }),
      getSheetHeaderStatus({ sheets: c.sheets, spreadsheetId: c.sheetId, sheetName: names.traderSheetName }),
      getSheetHeaderStatus({ sheets: c.sheets, spreadsheetId: c.sheetId, sheetName: names.partnerSheetName }),
      getSheetHeaderStatus({ sheets: c.sheets, spreadsheetId: c.sheetId, sheetName: names.unknownSheetName }),
    ]);
  }
  const sheets = { master, trader, partner, unknown };
  const results = { default: master, trader, partner, unknown };
  const routing = {
    trader: resolveLeadSheetTargets({ lead: { category: 'trader' }, config }).map((target) => target.sheetName),
    partner: resolveLeadSheetTargets({ lead: { category: 'partner' }, config }).map((target) => target.sheetName),
    unknown: resolveLeadSheetTargets({ lead: { category: 'unknown' }, config }).map((target) => target.sheetName),
  };
  const allReady = Object.values(results).every((result) => result.exists && result.header_valid);
  const demoWrites = input?.write_demo === false
    ? null
    : allReady
      ? await writeRoutingDemoRows({ sheets: c.sheets, spreadsheetId: c.sheetId, config })
      : null;

  return {
    spreadsheet_id: c.sheetId,
    sheets,
    results,
    routing,
    demo_writes: demoWrites,
    demo_written: !!demoWrites,
    message: demoWrites
      ? 'Sheet name test completed and demo rows were saved.'
      : 'Sheet name test completed.',
  };
}

async function createMissingTabs() {
  const c = await initClients();
  const settings = await getSheetRoutingSettings();
  const config = {
    sheet_name: settings.default_sheet_name,
    default_sheet_name: settings.default_sheet_name,
    trader_sheet_name: settings.trader_sheet_name,
    partner_sheet_name: settings.partner_sheet_name,
    unknown_sheet_name: settings.unknown_sheet_name,
    auto_create_missing_sheets: true,
    category_sheet_routing_enabled: settings.category_sheet_routing_enabled,
  };
  const names = resolveConfiguredSheetNames(config);
  const tabs = [
    names.defaultSheetName,
    names.traderSheetName,
    names.partnerSheetName,
    names.unknownSheetName,
  ];
  const uniqueTabs = [...new Set(tabs.filter(Boolean))];
  const existing = [];
  const created = [];
  const failed = [];
  const meta = await c.sheets.spreadsheets.get({
    spreadsheetId: c.sheetId,
    fields: 'sheets.properties.title',
  });
  const currentTabs = new Set((meta.data.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean));

  for (const tab of uniqueTabs) {
    const alreadyExists = currentTabs.has(tab);
    await ensureSheetExists({
      sheets: c.sheets,
      spreadsheetId: c.sheetId,
      sheetName: tab,
      headers: HEADERS,
      autoCreate: true,
    });
    if (alreadyExists) existing.push(tab);
    else created.push(tab);
  }
  return { created, existing, failed };
}

async function exportLeadsByCategory({ mode = 'dry_run', category = 'all', dateFrom = null, dateTo = null, skipDuplicates = true } = {}) {
  const c = await initClients();
  const settings = await getSheetRoutingSettings();
  const config = {
    sheet_name: settings.default_sheet_name,
    default_sheet_name: settings.default_sheet_name,
    trader_sheet_name: settings.trader_sheet_name,
    partner_sheet_name: settings.partner_sheet_name,
    unknown_sheet_name: settings.unknown_sheet_name,
    auto_create_missing_sheets: settings.auto_create_missing_sheets,
    category_sheet_routing_enabled: settings.category_sheet_routing_enabled,
  };

  const params = [];
  const where = ['l.deleted_at IS NULL'];
  if (['trader', 'partner', 'unknown'].includes(category)) {
    params.push(category);
    where.push(`COALESCE(l.category, 'unknown') = $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    where.push(`l.created_at >= $${params.length}::timestamptz`);
  }
  if (dateTo) {
    params.push(dateTo);
    where.push(`l.created_at <= $${params.length}::timestamptz`);
  }
  if (mode === 'not_synced') {
    where.push(`l.google_sheet_last_synced_at IS NULL`);
  }

  const { rows } = await query(`${LEAD_SELECT_SQL} AND ${where.join(' AND ')} ORDER BY l.created_at DESC`, params);
  const summary = {
    master: { sheet_name: resolveConfiguredSheetNames(config).defaultSheetName, count: 0, upserted: 0, updated: 0, appended: 0 },
    trader: { sheet_name: resolveConfiguredSheetNames(config).traderSheetName, count: 0, upserted: 0, updated: 0, appended: 0 },
    partner: { sheet_name: resolveConfiguredSheetNames(config).partnerSheetName, count: 0, upserted: 0, updated: 0, appended: 0 },
    unknown: { sheet_name: resolveConfiguredSheetNames(config).unknownSheetName, count: 0, upserted: 0, updated: 0, appended: 0 },
  };
  for (const lead of rows) {
    const targets = resolveLeadSheetTargets({ lead, config });
    for (const target of targets) {
      if (!summary[target.key]) {
        summary[target.key] = { sheet_name: target.sheetName, count: 0, upserted: 0, updated: 0, appended: 0 };
      }
      summary[target.key].count += 1;
    }
  }

  if (mode !== 'dry_run') {
    for (const lead of rows) {
      const targets = resolveLeadSheetTargets({ lead, config });
      for (const target of targets) {
        const result = await upsertLeadToSheet({
          sheets: c.sheets,
          spreadsheetId: c.sheetId,
          sheetName: target.sheetName,
          lead,
          autoCreate: settings.auto_create_missing_sheets,
        });
        summary[target.key].upserted += 1;
        if (result.action === 'updated') summary[target.key].updated += 1;
        if (result.action === 'appended') summary[target.key].appended += 1;
      }
      await updateLeadSheetSyncMeta(lead.id, {
        ok: true,
        spreadsheetId: c.sheetId,
        sheetName: targets.map((target) => target.sheetName).join(', '),
        error: null,
      });
    }
  }

  return { mode, summary, data: summary };
}

module.exports = {
  syncAllLeads,
  appendLead,
  updateLeadRow,
  checkConnectivity,
  listSharedSheets,
  getSheets,
  resetClients,
  reloadActiveConfig,
  getActiveSheetId,
  getActiveSheetName,
  getActiveClientEmail,
  resolveConfigStatus,
  testCredentials,
  previewRows,
  getSheetRoutingSettings,
  updateSheetRoutingSettings,
  testSheetRouting,
  createMissingTabs,
  exportLeadsByCategory,
  LEAD_SHEET_HEADERS: HEADERS,
  buildLeadSheetRow: leadToRow,
  ensureLeadSheetExists: ensureSheetExists,
  upsertLeadToSheet,
  getLeadSelectSql: () => LEAD_SELECT_SQL,
};
