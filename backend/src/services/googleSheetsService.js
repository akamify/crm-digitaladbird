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
const { resolveLeadSheetName, sanitizeSheetName, normalizeCategory } = require('./googleSheets/googleSheetNameResolver');
const notificationService = require('./notifications/notificationService');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

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
    trader_sheet_name: sanitizeSheetName(config.trader_sheet_name || ''),
    partner_sheet_name: sanitizeSheetName(config.partner_sheet_name || ''),
    unknown_sheet_name: sanitizeSheetName(config.unknown_sheet_name || ''),
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
    range: `${targetName}!A1:R1`,
  }).catch(() => ({ data: { values: [] } }));

  if (!current.data.values || current.data.values.length === 0) {
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

async function notifySheetSyncFailure({ lead, sheetName, spreadsheetId, error }) {
  try {
    await notificationService.notifyAdmins(
      'google_sheet_sync_failed',
      'Google Sheet Sync Failed',
      `Lead ${lead.full_name || lead.id} could not be saved to sheet tab ${sheetName}.`,
      {
        event_type: 'google_sheet_sync_failed',
        lead_id: lead.id,
        lead_category: normalizeCategory(lead.category),
        spreadsheet_id: spreadsheetId || null,
        sheet_name: sheetName || null,
        error_message: error,
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
];

function leadToRow(l) {
  return [
    l.id || '',
    l.full_name || '',
    l.phone || '',
    l.email || '',
    l.campaign_label || l.meta_campaign_label || '',
    l.campaign_name || '',
    l.adset_name || '',
    l.ad_name || '',
    l.rm_name || '',
    l.category || '',
    l.call_status || 'pending',
    l.call_status || 'pending',
    l.stage || 'new',
    l.source || 'manual',
    l.assigned_to_name || '',
    l.team_name || '',
    l.created_at ? formatIST(l.created_at) : '',
    l.updated_at ? formatIST(l.updated_at) : '',
  ];
}

function formatIST(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
  } catch { return String(dateStr); }
}

// ─── Lead query (shared) ────────────────────────────────────────────

const LEAD_SELECT_SQL = `
  SELECT l.*,
         u.full_name AS assigned_to_name,
         u.team_name,
         rm.full_name AS rm_name,
         mc.internal_label AS meta_campaign_label
    FROM leads l
    LEFT JOIN users u  ON u.id = l.assigned_to_user_id
    LEFT JOIN users rm ON rm.id = u.report_to_id
    LEFT JOIN meta_campaigns mc ON mc.campaign_id = l.meta_campaign_id
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
    const resolved = resolveLeadSheetName({ lead, config: routingConfig });
    if (!grouped.has(resolved.sheetName)) grouped.set(resolved.sheetName, []);
    grouped.get(resolved.sheetName).push(lead);
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
        range: `${targetSheet}!A:R`,
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

  const resolved = resolveLeadSheetName({ lead: l, config: routingConfig });
  const SHEET_NAME = await ensureSheetExists({
    sheets,
    spreadsheetId: SHEET_ID,
    sheetName: resolved.sheetName,
    headers: HEADERS,
    autoCreate: routingConfig.auto_create_missing_sheets,
  });

  const existingData = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:A`,
  }).catch(() => ({ data: { values: [] } }));
  const rowIndex = (existingData.data.values || []).findIndex(row => row[0] === leadId);
  if (rowIndex >= 0) {
    return updateLeadRow(leadId);
  }

  try {
    await withRetry(async () => {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A:R`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [leadToRow(l)] },
      });
    }, 'appendLead');
    await updateLeadSheetSyncMeta(leadId, {
      ok: true,
      spreadsheetId: SHEET_ID,
      sheetName: SHEET_NAME,
      error: null,
    });
  } catch (err) {
    await updateLeadSheetSyncMeta(leadId, {
      ok: false,
      spreadsheetId: SHEET_ID,
      sheetName: SHEET_NAME,
      error: err.message,
    });
    await notifySheetSyncFailure({ lead: l, sheetName: SHEET_NAME, spreadsheetId: SHEET_ID, error: err.message });
    throw err;
  }

  logger.info({ leadId, name: l.full_name }, '[Sheets] Lead appended');
  return { appended: true };
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

  const resolved = resolveLeadSheetName({ lead: l, config: routingConfig });
  const SHEET_NAME = await ensureSheetExists({
    sheets,
    spreadsheetId: SHEET_ID,
    sheetName: resolved.sheetName,
    headers: HEADERS,
    autoCreate: routingConfig.auto_create_missing_sheets,
  });

  // Find the row with this lead ID
  let existingData;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:A`,
    });
    existingData = res.data.values || [];
  } catch {
    return { updated: false, reason: 'read_failed' };
  }

  const rowIndex = existingData.findIndex(row => row[0] === leadId);
  if (rowIndex < 0) {
    // Not in sheet yet — append instead
    return appendLead(leadId);
  }

  const rowNum = rowIndex + 1; // 1-based
  try {
    await withRetry(async () => {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A${rowNum}:R${rowNum}`,
        valueInputOption: 'RAW',
        requestBody: { values: [leadToRow(l)] },
      });
    }, 'updateRow');
    await updateLeadSheetSyncMeta(leadId, {
      ok: true,
      spreadsheetId: SHEET_ID,
      sheetName: SHEET_NAME,
      error: null,
    });
  } catch (err) {
    await updateLeadSheetSyncMeta(leadId, {
      ok: false,
      spreadsheetId: SHEET_ID,
      sheetName: SHEET_NAME,
      error: err.message,
    });
    await notifySheetSyncFailure({ lead: l, sheetName: SHEET_NAME, spreadsheetId: SHEET_ID, error: err.message });
    throw err;
  }

  logger.info({ leadId, row: rowNum }, '[Sheets] Lead row updated');
  return { updated: true, row: rowNum };
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
    range: `${c.sheetName}!A1:R${Math.max(2, limit + 1)}`,
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
  if (!base?.id && !fallback.config_id) {
    throw new Error('No active Google Sheets configuration found.');
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

  await query(`UPDATE integration_configs SET config = $1, updated_at = NOW() WHERE id = $2`, [JSON.stringify(merged), base?.id || fallback.config_id]);
  resetClients();
  return getSheetRoutingSettings();
}

async function testSheetRouting(input = 'unknown') {
  const c = await initClients();
  const meta = await c.sheets.spreadsheets.get({
    spreadsheetId: c.sheetId,
    fields: 'sheets.properties.title',
  });
  const existingTitles = new Set((meta.data.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean));

  if (typeof input === 'string') {
    const settings = await getSheetRoutingSettings();
    const resolved = resolveLeadSheetName({
      lead: { category: input },
      config: {
        sheet_name: settings.default_sheet_name,
        default_sheet_name: settings.default_sheet_name,
        trader_sheet_name: settings.trader_sheet_name,
        partner_sheet_name: settings.partner_sheet_name,
        unknown_sheet_name: settings.unknown_sheet_name,
        auto_create_missing_sheets: settings.auto_create_missing_sheets,
        category_sheet_routing_enabled: settings.category_sheet_routing_enabled,
      },
    });
    const exists = existingTitles.has(resolved.sheetName);
    return {
      category: normalizeCategory(input),
      sheet_name: resolved.sheetName,
      sheet_exists: exists,
      spreadsheet_id: c.sheetId,
    };
  }

  const defaultSheet = sanitizeSheetName(input.default_sheet_name || '') || 'Leads';
  const traderSheet = sanitizeSheetName(input.trader_sheet_name || '') || defaultSheet;
  const partnerSheet = sanitizeSheetName(input.partner_sheet_name || '') || defaultSheet;
  const unknownSheet = sanitizeSheetName(input.unknown_sheet_name || '') || defaultSheet;

  return {
    spreadsheet_id: c.sheetId,
    results: {
      default: { sheet_name: defaultSheet, exists: existingTitles.has(defaultSheet) },
      trader: { sheet_name: traderSheet, exists: existingTitles.has(traderSheet) },
      partner: { sheet_name: partnerSheet, exists: existingTitles.has(partnerSheet) },
      unknown: { sheet_name: unknownSheet, exists: existingTitles.has(unknownSheet) },
    },
    message: 'Sheet name test completed.',
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
  const tabs = [
    resolveLeadSheetName({ lead: { category: 'trader' }, config }).sheetName,
    resolveLeadSheetName({ lead: { category: 'partner' }, config }).sheetName,
    resolveLeadSheetName({ lead: { category: 'unknown' }, config }).sheetName,
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
  const summary = {};
  const groups = new Map();
  for (const lead of rows) {
    const resolved = resolveLeadSheetName({ lead, config });
    if (!groups.has(resolved.sheetName)) groups.set(resolved.sheetName, []);
    groups.get(resolved.sheetName).push(lead);
  }

  for (const [sheetName, leads] of groups.entries()) {
    const key = normalizeCategory(leads[0]?.category);
    summary[key] = { sheet_name: sheetName, count: leads.length };
    if (mode === 'dry_run') continue;
    const targetSheet = await ensureSheetExists({
      sheets: c.sheets,
      spreadsheetId: c.sheetId,
      sheetName,
      headers: HEADERS,
      autoCreate: settings.auto_create_missing_sheets,
    });
    const columnA = await c.sheets.spreadsheets.values.get({
      spreadsheetId: c.sheetId,
      range: `${targetSheet}!A:A`,
    }).catch(() => ({ data: { values: [] } }));
    const existingIds = new Set((columnA.data.values || []).map((row) => row[0]).filter(Boolean));
    const exportRows = skipDuplicates
      ? leads.filter((lead) => !existingIds.has(lead.id))
      : leads;
    if (exportRows.length) {
      await c.sheets.spreadsheets.values.append({
        spreadsheetId: c.sheetId,
        range: `${targetSheet}!A:R`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: exportRows.map(leadToRow) },
      });
      for (const lead of exportRows) {
        await updateLeadSheetSyncMeta(lead.id, { ok: true, spreadsheetId: c.sheetId, sheetName: targetSheet, error: null });
      }
    }
  }

  return { mode, summary };
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
};
