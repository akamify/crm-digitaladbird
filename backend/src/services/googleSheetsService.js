/**
 * Google Sheets Sync Service — dynamic, admin-controlled.
 *
 * Auth precedence (per request):
 *   1. Active row in `integration_configs` (kind='google_sheets', is_active=true)
 *      — admin uploaded the service-account JSON via the Settings UI.
 *   2. Env vars (back-compat): GOOGLE_SERVICE_ACCOUNT_KEY{,_PATH}
 *
 * The DB-backed row holds the sheet_id, sheet_name AND the encrypted service-
 * account JSON. Admins can swap the active row at any time and the next sync
 * call picks up the new config without restarting PM2.
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
const { google } = require('googleapis');
const { query }  = require('../config/database');
const logger     = require('../utils/logger');
const { decrypt } = require('../utils/secretsCrypto');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

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
    if (row && row.secrets_encrypted) {
      const secrets = decrypt(row.secrets_encrypted);
      if (!secrets || !secrets.client_email) throw new Error('Stored credentials missing client_email');
      const cfg = row.config || {};
      return {
        configId:   row.id,
        sheetId:    cfg.sheet_id || '',
        sheetName:  cfg.sheet_name || 'Leads',
        purpose:    row.purpose || null,
        creds:      secrets,
        source:     'db',
      };
    }
  } catch (err) {
    if (err.message && /malformed|bad iv|tag|auth/i.test(err.message)) {
      throw new Error('Active Google Sheets credentials in DB cannot be decrypted — re-upload the service-account JSON.');
    }
    // Otherwise (table doesn't exist yet, etc.) fall through to env.
  }

  // 2. Env fallback (legacy) — only when no purpose was asked for
  if (purpose) {
    throw new Error(`No active "${purpose}" sheet configured. Upload one in Settings → Google Sheets → ${purpose === 'traders' ? 'Traders' : 'Partners'} tab.`);
  }
  const sheetId = process.env.GOOGLE_SHEET_ID || '';
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || '';
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '';
  if (!sheetId) throw new Error('No active Google Sheets config — upload credentials in Settings → Google Sheets.');
  if (!keyPath && !keyJson) throw new Error('No Google credentials configured — upload service-account JSON in Settings.');

  let creds;
  if (keyJson) {
    try { creds = JSON.parse(keyJson); }
    catch { creds = JSON.parse(Buffer.from(keyJson, 'base64').toString('utf8')); }
  } else {
    const resolved = path.isAbsolute(keyPath) ? keyPath : path.resolve(process.cwd(), keyPath);
    creds = require(resolved);
  }
  return {
    configId:  null,
    sheetId,
    sheetName: process.env.GOOGLE_SHEET_NAME || 'Leads',
    purpose:   null,
    creds,
    source:    'env',
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
  const SHEET_ID = c.sheetId, SHEET_NAME = c.sheetName, sheets = c.sheets;

  const { rows } = await query(LEAD_SELECT_SQL + ' ORDER BY l.created_at DESC');
  if (rows.length === 0) {
    logger.info('[Sheets] No leads to sync');
    return { synced: 0 };
  }

  const data = [HEADERS, ...rows.map(leadToRow)];
  const range = `${SHEET_NAME}!A:R`;

  await withRetry(async () => {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range,
    });
  }, 'clear');

  await withRetry(async () => {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: data },
    });
  }, 'fullSync');

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
  const SHEET_ID = c.sheetId, SHEET_NAME = c.sheetName, sheets = c.sheets;

  const { rows: [l] } = await query(
    LEAD_SELECT_SQL + ' AND l.id = $1',
    [leadId]
  );
  if (!l) {
    logger.warn({ leadId }, '[Sheets] Lead not found for append');
    return { appended: false, reason: 'not_found' };
  }

  await withRetry(async () => {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:R`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [leadToRow(l)] },
    });
  }, 'appendLead');

  logger.info({ leadId, name: l.full_name }, '[Sheets] Lead appended');
  return { appended: true };
}

// ─── Update existing lead row ───────────────────────────────────────

async function updateLeadRow(leadId) {
  let c;
  try { c = await initClients(); } catch { return { updated: false, reason: 'disabled' }; }
  const SHEET_ID = c.sheetId, SHEET_NAME = c.sheetName, sheets = c.sheets;

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

  const { rows: [l] } = await query(LEAD_SELECT_SQL + ' AND l.id = $1', [leadId]);
  if (!l) return { updated: false, reason: 'not_found' };

  const rowNum = rowIndex + 1; // 1-based
  await withRetry(async () => {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A${rowNum}:O${rowNum}`,
      valueInputOption: 'RAW',
      requestBody: { values: [leadToRow(l)] },
    });
  }, 'updateRow');

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
  result.source = c.configId ? 'db' : 'env';

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
      result.error = 'Permission denied — share the sheet with: ' + (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'the service account email');
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
  testCredentials,
  previewRows,
};
