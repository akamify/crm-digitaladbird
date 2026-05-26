/**
 * Google Sheets Sync Service
 *
 * Syncs leads from PostgreSQL → Google Sheet with retry logic.
 *
 * Auth: GOOGLE_SERVICE_ACCOUNT_KEY_PATH (path to .json key file)
 *    or GOOGLE_SERVICE_ACCOUNT_KEY      (raw JSON / base64 string)
 *
 * The Google Sheet MUST be shared (Editor) with the service account email.
 *
 * Modes:
 *   - syncAllLeads()       : full sync — clears sheet and re-writes all leads
 *   - appendLead(leadId)   : append a single new lead row
 *   - updateLeadRow(leadId): update an existing row in-place
 *   - checkConnectivity()  : test API access and permissions
 */
const path = require('path');
const { google } = require('googleapis');
const { query }  = require('../config/database');
const logger     = require('../utils/logger');

const SHEET_ID   = process.env.GOOGLE_SHEET_ID || '';
const KEY_PATH   = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || '';
const KEY_JSON   = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '';
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Leads';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

let _sheets = null;
let _drive = null;
let _initError = null;

// ─── Auth & initialization ──────────────────────────────────────────

async function initClients() {
  if (_sheets && _drive) return { sheets: _sheets, drive: _drive };
  if (_initError) throw _initError;

  if (!SHEET_ID) {
    _initError = new Error('GOOGLE_SHEET_ID not set — sync disabled');
    logger.warn('[Sheets] ' + _initError.message);
    throw _initError;
  }
  if (!KEY_PATH && !KEY_JSON) {
    _initError = new Error('No Google credentials configured');
    logger.warn('[Sheets] ' + _initError.message);
    throw _initError;
  }

  try {
    let auth;
    if (KEY_PATH) {
      const resolved = path.isAbsolute(KEY_PATH)
        ? KEY_PATH
        : path.resolve(process.cwd(), KEY_PATH);
      auth = new google.auth.GoogleAuth({ keyFile: resolved, scopes: SCOPES });
    } else {
      let creds;
      try { creds = JSON.parse(KEY_JSON); }
      catch { creds = JSON.parse(Buffer.from(KEY_JSON, 'base64').toString('utf8')); }
      auth = new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
    }

    const client = await auth.getClient();
    _sheets = google.sheets({ version: 'v4', auth: client });
    _drive  = google.drive({ version: 'v3', auth: client });

    logger.info('[Sheets] Google Sheets + Drive API initialized');
    return { sheets: _sheets, drive: _drive };
  } catch (err) {
    _initError = err;
    logger.error({ err: err.message }, '[Sheets] Failed to initialize Google APIs');
    throw err;
  }
}

/** Get sheets client (lazy init). Returns null if disabled. */
async function getSheets() {
  try {
    const { sheets } = await initClients();
    return sheets;
  } catch {
    return null;
  }
}

/** Reset cached clients (useful after credential rotation). */
function resetClients() {
  _sheets = null;
  _drive = null;
  _initError = null;
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
  const { sheets } = await initClients();

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

  logger.info({ count: rows.length }, '[Sheets] Full sync complete');
  return { synced: rows.length };
}

// ─── Append single lead ─────────────────────────────────────────────

async function appendLead(leadId) {
  const sheets = await getSheets();
  if (!sheets) return { appended: false, reason: 'disabled' };

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
  const sheets = await getSheets();
  if (!sheets) return { updated: false, reason: 'disabled' };

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
    configured: !!(SHEET_ID && (KEY_PATH || KEY_JSON)),
    sheet_id: SHEET_ID,
    sheet_name: SHEET_NAME,
    service_account_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    api_connected: false,
    sheet_accessible: false,
    sheet_title: null,
    row_count: 0,
    error: null,
  };

  if (!result.configured) {
    result.error = 'Missing GOOGLE_SHEET_ID or credentials';
    return result;
  }

  try {
    const { sheets } = await initClients();
    result.api_connected = true;

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

module.exports = {
  syncAllLeads,
  appendLead,
  updateLeadRow,
  checkConnectivity,
  listSharedSheets,
  getSheets,
  resetClients,
};
