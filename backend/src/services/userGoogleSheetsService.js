const { google } = require('googleapis');
const crypto = require('crypto');
const { query } = require('../config/database');
const oauth = require('./googleUserOAuthService');
const {
  LEAD_SHEET_HEADERS,
  getLeadSelectSql,
  buildLeadSheetRow,
} = require('./googleSheetsService');
const {
  resolveConfiguredSheetNames,
  resolveLeadSheetTargets,
  sanitizeSheetName,
} = require('./googleSheets/googleSheetNameResolver');

const SHEET_LIST_TTL_MS = 7 * 60 * 1000;
const VALIDATION_TTL_MS = 3 * 60 * 1000;
const spreadsheetListCache = new Map();
const validationCache = new Map();
const runningSyncs = new Set();

function googleError(error, fallbackCode = 'GOOGLE_SHEETS_SYNC_FAILED') {
  const message = String(error?.message || 'Google Sheets request failed.');
  if (error?.response?.status === 429 || /quota|rate limit|RESOURCE_EXHAUSTED/i.test(message)) {
    const quota = new Error('Google Sheets quota limit reached. Please wait a few minutes and try again.');
    quota.code = 'GOOGLE_SHEETS_QUOTA_EXCEEDED';
    quota.retry_after_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    return quota;
  }
  if (error?.code) return error;
  const normalized = new Error(message);
  normalized.code = fallbackCode;
  return normalized;
}

async function retryTransient(operation, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(); } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      if (![500, 502, 503, 504].includes(status) || attempt === attempts - 1) break;
      await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
    }
  }
  throw googleError(lastError);
}

function connectionData(connection) {
  if (!connection) return { connected: false };
  const hasSpreadsheet = !!connection.spreadsheet_id;
  const missingTabs = Array.isArray(connection.missing_tabs) ? connection.missing_tabs : [];
  const invalidHeaders = Array.isArray(connection.invalid_headers) ? connection.invalid_headers : [];
  const tabsValid = connection.tabs_valid !== false && missingTabs.length === 0;
  const headersValid = connection.headers_valid !== false && invalidHeaders.length === 0;
  const hasSetupError = /tab|header|spreadsheet/i.test(connection.last_error || '');
  const inCooldown = connection.retry_after_at && new Date(connection.retry_after_at).getTime() > Date.now();
  const needsReconnect = /refresh|reconnect|expired/i.test(connection.last_error || '');
  return {
    connected: true,
    google_email: connection.google_email || null,
    spreadsheet_id: connection.spreadsheet_id || null,
    spreadsheet_name: connection.spreadsheet_name || null,
    default_sheet_name: connection.default_sheet_name || 'Leads',
    trader_sheet_name: connection.trader_sheet_name || 'Traders',
    partner_sheet_name: connection.partner_sheet_name || 'Partners',
    unknown_sheet_name: connection.unknown_sheet_name || 'Unknown Leads',
    sync_enabled: connection.sync_enabled !== false,
    last_sync_at: connection.last_sync_at || null,
    last_error: connection.last_error || null,
    retry_after_at: connection.retry_after_at || null,
    open_url: connection.spreadsheet_id ? `https://docs.google.com/spreadsheets/d/${connection.spreadsheet_id}` : null,
    setup: {
      sheet_created: hasSpreadsheet,
      tabs_valid: hasSpreadsheet && tabsValid && !hasSetupError,
      headers_valid: hasSpreadsheet && headersValid && !hasSetupError,
      setup_checked_at: connection.setup_checked_at || null,
      missing_tabs: missingTabs,
      invalid_headers: hasSetupError && invalidHeaders.length === 0 ? ['Run setup repair'] : invalidHeaders,
    },
    status: connection.disconnected_at
      ? 'disconnected'
      : needsReconnect
        ? 'needs_reconnect'
        : inCooldown
          ? 'quota_cooldown'
          : connection.last_error
            ? 'sync_failed'
            : 'connected',
  };
}

function safeConnectionData(connection) {
  return {
    id: connection.id,
    user_id: connection.user_id,
    ...connectionData(connection),
  };
}

async function getConnectionOrThrow(userId) {
  const connection = await oauth.getActiveConnection(userId);
  if (!connection) {
    const err = new Error('Google Sheets is not connected.');
    err.code = 'GOOGLE_SHEETS_NOT_CONNECTED';
    throw err;
  }
  return connection;
}

async function clientBundle(connection) {
  const auth = await oauth.authorizedClientForConnection(connection);
  return {
    auth,
    sheets: google.sheets({ version: 'v4', auth }),
    drive: google.drive({ version: 'v3', auth }),
  };
}

async function getConnectionOwner(connection) {
  const { rows: [owner] } = await query(
    `SELECT id, full_name, role, report_to_id, team_name
       FROM users WHERE id = $1 LIMIT 1`,
    [connection.user_id],
  );
  if (!owner) {
    const err = new Error('Google Sheet connection owner was not found.');
    err.code = 'GOOGLE_SHEETS_ACCESS_DENIED';
    throw err;
  }
  return owner;
}

async function getAdminConnectionOrThrow(connectionId) {
  const connection = await oauth.getConnectionById(connectionId);
  if (!connection) {
    const err = new Error('Google Sheet connection was not found.');
    err.code = 'GOOGLE_SHEETS_NOT_CONNECTED';
    throw err;
  }
  return connection;
}

function configFromConnection(connection, overrides = {}) {
  return {
    default_sheet_name: sanitizeSheetName(overrides.default_sheet_name || connection.default_sheet_name || 'Leads') || 'Leads',
    trader_sheet_name: sanitizeSheetName(overrides.trader_sheet_name || connection.trader_sheet_name || 'Traders') || 'Traders',
    partner_sheet_name: sanitizeSheetName(overrides.partner_sheet_name || connection.partner_sheet_name || 'Partners') || 'Partners',
    unknown_sheet_name: sanitizeSheetName(overrides.unknown_sheet_name || connection.unknown_sheet_name || 'Unknown Leads') || 'Unknown Leads',
    category_sheet_routing_enabled: true,
    auto_create_missing_sheets: true,
  };
}

function parseSpreadsheetId(input) {
  const value = String(input || '').trim();
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : value;
}

async function getStatus(user) {
  return connectionData(await oauth.getActiveConnection(user.id));
}

async function getOwnerById(userId) {
  const { rows: [owner] } = await query(
    `SELECT id, full_name, role, report_to_id, team_name
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [userId],
  );
  if (!owner) {
    const err = new Error('Google Sheet connection owner was not found.');
    err.code = 'GOOGLE_SHEETS_ACCESS_DENIED';
    throw err;
  }
  return owner;
}

async function ensureTabs({ sheets, spreadsheetId, config }) {
  const names = resolveConfiguredSheetNames(config);
  const tabs = [...new Set([
    names.defaultSheetName,
    names.traderSheetName,
    names.partnerSheetName,
    names.unknownSheetName,
  ].filter(Boolean))];
  const metadata = await retryTransient(() => sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' }));
  const existing = new Set((metadata.data.sheets || []).map(sheet => sheet.properties?.title).filter(Boolean));
  const missing = tabs.filter(tab => !existing.has(tab));
  if (missing.length) {
    await retryTransient(() => sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: missing.map(title => ({ addSheet: { properties: { title } } })) },
    }));
  }
  const headerResult = await retryTransient(() => sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: tabs.map(tab => `'${tab.replace(/'/g, "''")}'!A1:AB1`),
  }));
  const headerUpdates = [];
  const results = {};
  const invalidHeaders = [];
  tabs.forEach((tab, index) => {
    const current = headerResult.data.valueRanges?.[index]?.values?.[0] || [];
    const valid = LEAD_SHEET_HEADERS.every((header, position) => String(current[position] || '').trim() === header)
      && current.length === LEAD_SHEET_HEADERS.length;
    if (!valid) {
      invalidHeaders.push(tab);
      headerUpdates.push({ range: `'${tab.replace(/'/g, "''")}'!A1:AB1`, values: [LEAD_SHEET_HEADERS] });
    }
    results[tab] = { sheet_name: tab, ready: true, created: missing.includes(tab), header_fixed: !valid };
  });
  if (headerUpdates.length) {
    await retryTransient(() => sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data: headerUpdates },
    }));
  }
  validationCache.set(`${spreadsheetId}:${tabs.join('|')}`, { expiresAt: Date.now() + VALIDATION_TTL_MS, value: results });
  return {
    tabs: results,
    missing_tabs: missing,
    invalid_headers: invalidHeaders,
    tabs_valid: true,
    headers_valid: true,
  };
}

async function saveSetupState(connectionId, setup) {
  await query(
    `UPDATE user_google_sheet_connections
        SET tabs_valid = $2,
            headers_valid = $3,
            missing_tabs = $4::jsonb,
            invalid_headers = $5::jsonb,
            setup_checked_at = NOW(),
            last_error = NULL,
            retry_after_at = NULL,
            updated_at = NOW()
      WHERE id = $1`,
    [
      connectionId,
      setup.tabs_valid !== false,
      setup.headers_valid !== false,
      JSON.stringify(setup.missing_tabs || []),
      JSON.stringify(setup.invalid_headers || []),
    ],
  );
}

async function listSpreadsheets(user, { refresh = false } = {}) {
  const connection = await getConnectionOrThrow(user.id);
  const cached = spreadsheetListCache.get(connection.id);
  if (!refresh && cached?.expiresAt > Date.now()) return { data: cached.value, cached: true };
  const { drive } = await clientBundle(connection);
  try {
    const response = await retryTransient(() => drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: 'files(id,name,modifiedTime,webViewLink)',
      orderBy: 'modifiedTime desc',
      pageSize: 100,
    }));
    const data = (response.data.files || []).map(file => ({ id: file.id, name: file.name, modified_time: file.modifiedTime || null, web_view_link: file.webViewLink || null }));
    spreadsheetListCache.set(connection.id, { expiresAt: Date.now() + SHEET_LIST_TTL_MS, value: data });
    return { data, cached: false };
  } catch (error) { throw googleError(error, 'GOOGLE_SHEETS_ACCESS_DENIED'); }
}

async function saveSpreadsheet(connectionId, spreadsheet) {
  await query(
    `UPDATE user_google_sheet_connections
        SET spreadsheet_id = $2,
            spreadsheet_name = $3,
            last_error = NULL,
            updated_at = NOW()
      WHERE id = $1`,
    [connectionId, spreadsheet.spreadsheetId, spreadsheet.properties?.title || 'CRM Leads'],
  );
}

async function createSpreadsheet(user, input = {}) {
  const title = typeof input === 'string' ? input : input.spreadsheet_name;
  const connection = await getConnectionOrThrow(user.id);
  const { sheets } = await clientBundle(connection);
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: title || 'DigitalADbird CRM Leads' },
      sheets: [{ properties: { title: 'Leads' } }],
    },
  });
  const spreadsheet = created.data;
  await saveSpreadsheet(connection.id, spreadsheet);
  const nextConnection = { ...connection, spreadsheet_id: spreadsheet.spreadsheetId, spreadsheet_name: spreadsheet.properties?.title };
  const setup = await ensureTabs({ sheets, spreadsheetId: spreadsheet.spreadsheetId, config: configFromConnection(nextConnection, typeof input === 'object' ? input.sheet_names || {} : {}) });
  await saveSetupState(connection.id, setup);
  spreadsheetListCache.delete(connection.id);
  return { ...connectionData({ ...nextConnection, tabs_valid: true, headers_valid: true, missing_tabs: [], invalid_headers: [] }), setup: setup.tabs };
}

async function connectExisting(user, input) {
  const payload = typeof input === 'object' && input !== null ? input : { spreadsheet_url_or_id: input };
  const spreadsheetId = parseSpreadsheetId(payload.spreadsheet_id || payload.spreadsheet_url_or_id);
  if (!spreadsheetId) {
    const err = new Error('Spreadsheet URL or ID is required.');
    err.code = 'INVALID_SPREADSHEET_ID';
    throw err;
  }
  const connection = await getConnectionOrThrow(user.id);
  const { sheets } = await clientBundle(connection);
  let spreadsheet;
  try {
    spreadsheet = (await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'spreadsheetId,properties.title,sheets.properties.title',
    })).data;
  } catch (error) {
    const err = new Error('Google Sheet not found or access denied.');
    err.code = 'GOOGLE_SHEETS_SPREADSHEET_NOT_FOUND';
    throw err;
  }
  await saveSpreadsheet(connection.id, spreadsheet);
  const nextConnection = { ...connection, spreadsheet_id: spreadsheetId, spreadsheet_name: spreadsheet.properties?.title };
  const setup = await ensureTabs({ sheets, spreadsheetId, config: configFromConnection(nextConnection, payload.sheet_names || {}) });
  await saveSetupState(connection.id, setup);
  return { ...connectionData({ ...nextConnection, tabs_valid: true, headers_valid: true, missing_tabs: [], invalid_headers: [] }), setup: setup.tabs };
}

async function updateSettings(user, input = {}) {
  const connection = await getConnectionOrThrow(user.id);
  const defaultName = sanitizeSheetName(input.default_sheet_name || 'Leads');
  const traderName = sanitizeSheetName(input.trader_sheet_name || 'Traders');
  const partnerName = sanitizeSheetName(input.partner_sheet_name || 'Partners');
  const unknownName = sanitizeSheetName(input.unknown_sheet_name || 'Unknown Leads');
  if (!defaultName || !traderName || !partnerName) {
    const err = new Error('Default, Traders, and Partners sheet names are required.');
    err.code = 'GOOGLE_SHEETS_HEADER_INVALID';
    throw err;
  }
  const { rows: [updated] } = await query(
    `UPDATE user_google_sheet_connections
        SET default_sheet_name = $2,
            trader_sheet_name = $3,
            partner_sheet_name = $4,
            unknown_sheet_name = $5,
            sync_enabled = $6,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [
      connection.id,
      defaultName,
      traderName,
      partnerName,
      unknownName || defaultName,
      input.sync_enabled !== false,
    ],
  );
  return connectionData(updated);
}

async function testConnection(user) {
  const connection = await getConnectionOrThrow(user.id);
  if (!connection.spreadsheet_id) {
    const err = new Error('Create or connect a Google Sheet first.');
    err.code = 'GOOGLE_SHEETS_SPREADSHEET_NOT_FOUND';
    throw err;
  }
  const { sheets } = await clientBundle(connection);
  const config = configFromConnection(connection);
  const setup = await ensureTabs({ sheets, spreadsheetId: connection.spreadsheet_id, config });
  await saveSetupState(connection.id, setup);
  const routing = {
    trader: resolveLeadSheetTargets({ lead: { category: 'trader' }, config }).map(t => t.sheetName),
    partner: resolveLeadSheetTargets({ lead: { category: 'partner' }, config }).map(t => t.sheetName),
    unknown: resolveLeadSheetTargets({ lead: { category: 'unknown' }, config }).map(t => t.sheetName),
  };
  return { spreadsheet_id: connection.spreadsheet_id, tabs: setup.tabs, routing };
}

function scopedLeadWhere(user) {
  if (user.role === 'rm') return { sql: ' AND u.report_to_id = $1', params: [user.id] };
  if (user.role === 'member' || user.role === 'partner') return { sql: ' AND l.assigned_to_user_id = $1', params: [user.id] };
  return { sql: '', params: [] };
}

async function createLog({ connectionId, userId, syncType }) {
  const { rows: [log] } = await query(
    `INSERT INTO user_google_sheet_sync_logs (connection_id, user_id, sync_type, status)
     VALUES ($1, $2, $3, 'started')
     RETURNING *`,
    [connectionId, userId, syncType],
  );
  return log;
}

async function finishLog(id, patch) {
  await query(
    `UPDATE user_google_sheet_sync_logs
        SET status = $2,
            records_attempted = $3,
            records_synced = $4,
            records_failed = $5,
            details = $6,
            error_message = $7,
            finished_at = NOW()
      WHERE id = $1`,
    [id, patch.status, patch.records_attempted || 0, patch.records_synced || 0, patch.records_failed || 0, patch.details || {}, patch.error_message || null],
  ).catch(() => {});
}

function editableValuesFromRow(row) {
  return {
    status: String(row[10] || '').trim(),
    call_status: String(row[11] || '').trim(),
    stage: String(row[12] || '').trim(),
    last_contacted: String(row[22] || '').trim(),
    notes: String(row[27] || '').trim(),
  };
}

function valueHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function saveRowState({ connection, owner, lead, sheetName, rowNumber, values, status = 'synced' }) {
  const editable = editableValuesFromRow(values);
  const hash = valueHash(editable);
  await query(
    `INSERT INTO user_google_sheet_row_sync_state(
       connection_id, user_id, lead_id, sheet_name, row_number, last_pushed_hash,
       last_pulled_hash, last_crm_updated_at, last_sheet_values, sync_status, last_synced_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,NOW())
     ON CONFLICT(connection_id, lead_id, sheet_name) DO UPDATE SET
       row_number = EXCLUDED.row_number,
       last_pushed_hash = EXCLUDED.last_pushed_hash,
       last_pulled_hash = EXCLUDED.last_pulled_hash,
       last_crm_updated_at = EXCLUDED.last_crm_updated_at,
       last_sheet_values = EXCLUDED.last_sheet_values,
       sync_status = EXCLUDED.sync_status,
       last_synced_at = NOW(), updated_at = NOW()`,
    [connection.id, owner.id, lead.id, sheetName, rowNumber, hash, lead.updated_at, editable, status],
  );
}

async function batchUpsertTarget({ sheets, connection, owner, sheetName, leads, idRows = [] }) {
  const escaped = sheetName.replace(/'/g, "''");
  const rowById = new Map(idRows.map((row, index) => [String(row[0] || '').trim(), index + 2]).filter(([id]) => id));
  const updates = [];
  const appends = [];
  const states = [];
  for (const lead of leads) {
    const values = buildLeadSheetRow({ ...lead, sync_status: 'Synced' });
    const existingRow = rowById.get(String(lead.id));
    if (existingRow) updates.push({ range: `'${escaped}'!A${existingRow}:AB${existingRow}`, values: [values] });
    else appends.push({ lead, values });
    states.push({ lead, values, rowNumber: existingRow || null });
  }
  if (updates.length) {
    await retryTransient(() => sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: connection.spreadsheet_id,
      requestBody: { valueInputOption: 'RAW', data: updates },
    }));
  }
  if (appends.length) {
    await retryTransient(() => sheets.spreadsheets.values.append({
      spreadsheetId: connection.spreadsheet_id,
      range: `'${escaped}'!A:AB`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: appends.map(item => item.values) },
    }));
  }
  for (const state of states) await saveRowState({ connection, owner, sheetName, ...state });
  return { upserted: leads.length, updated: updates.length, appended: appends.length };
}

async function readTargetLeadIdColumns({ sheets, spreadsheetId, targets }) {
  const ranges = targets.map(target => `'${target.sheetName.replace(/'/g, "''")}'!A2:A`);
  if (!ranges.length) return new Map();
  const response = await retryTransient(() => sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges }));
  const result = new Map();
  targets.forEach((target, index) => {
    result.set(target.key, response.data.valueRanges?.[index]?.values || []);
  });
  return result;
}

async function withSyncLock(connectionId, operation) {
  if (runningSyncs.has(connectionId)) {
    const error = new Error('A Google Sheets sync is already running. Please wait.');
    error.code = 'GOOGLE_SHEETS_SYNC_ALREADY_RUNNING';
    throw error;
  }
  const { rows } = await query(
    `UPDATE user_google_sheet_connections
        SET sync_started_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
        AND (sync_started_at IS NULL OR sync_started_at < NOW() - INTERVAL '15 minutes')
      RETURNING id`,
    [connectionId],
  );
  if (!rows.length) {
    const error = new Error('A Google Sheets sync is already running. Please wait.');
    error.code = 'GOOGLE_SHEETS_SYNC_ALREADY_RUNNING';
    throw error;
  }
  runningSyncs.add(connectionId);
  try {
    return await operation();
  } finally {
    runningSyncs.delete(connectionId);
    await query(
      `UPDATE user_google_sheet_connections
          SET sync_started_at = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [connectionId],
    ).catch(() => {});
  }
}

async function getFreshConnection(connectionId) {
  const fresh = await oauth.getConnectionById(connectionId);
  if (!fresh || fresh.disconnected_at) {
    const error = new Error('Google Sheets is not connected.');
    error.code = 'GOOGLE_SHEETS_NOT_CONNECTED';
    throw error;
  }
  return fresh;
}

function assertNotInCooldown(connection) {
  if (connection.retry_after_at && new Date(connection.retry_after_at).getTime() > Date.now()) {
    const error = new Error('Google Sheets quota limit reached. Please wait a few minutes and try again.');
    error.code = 'GOOGLE_SHEETS_QUOTA_EXCEEDED';
    error.retry_after_at = connection.retry_after_at;
    throw error;
  }
}

async function saveSyncError(connectionId, error) {
  const retryAfter = error.code === 'GOOGLE_SHEETS_QUOTA_EXCEEDED'
    ? (error.retry_after_at || new Date(Date.now() + 5 * 60 * 1000).toISOString())
    : null;
  await query(
    `UPDATE user_google_sheet_connections
        SET last_error = $2,
            retry_after_at = $3,
            updated_at = NOW()
      WHERE id = $1`,
    [connectionId, error.message, retryAfter],
  ).catch(() => {});
}

async function syncConnection(connection, owner, syncType = 'manual') {
  const currentConnection = await getFreshConnection(connection.id);
  assertNotInCooldown(currentConnection);
  if (!currentConnection.spreadsheet_id) {
    const err = new Error('Create or connect a Google Sheet first.');
    err.code = 'GOOGLE_SHEETS_SPREADSHEET_NOT_FOUND';
    throw err;
  }
  if (currentConnection.sync_enabled === false) {
    const err = new Error('Google Sheet sync is disabled for this connection.');
    err.code = 'GOOGLE_SHEETS_SYNC_FAILED';
    throw err;
  }
  return withSyncLock(currentConnection.id, async () => {
    const log = await createLog({ connectionId: currentConnection.id, userId: owner.id, syncType });
    try {
    const { sheets } = await clientBundle(currentConnection);
    const config = configFromConnection(currentConnection);
    const scope = scopedLeadWhere(owner);
    const { rows } = await query(`${getLeadSelectSql()}${scope.sql} ORDER BY l.created_at DESC`, scope.params);
    const summary = { attempted: rows.length, synced: 0, appended: 0, updated: 0, skipped: 0, conflicts: 0, failed: 0, targets: {} };
    const grouped = new Map();
    for (const lead of rows) {
      const targets = resolveLeadSheetTargets({ lead, config });
      for (const target of targets) {
        if (!grouped.has(target.key)) grouped.set(target.key, { sheetName: target.sheetName, leads: [] });
        grouped.get(target.key).leads.push(lead);
      }
    }
    const targetList = [...grouped.entries()].map(([key, target]) => ({ key, sheetName: target.sheetName }));
    const idRowsByTarget = await readTargetLeadIdColumns({
      sheets,
      spreadsheetId: currentConnection.spreadsheet_id,
      targets: targetList,
    });
    for (const [key, target] of grouped) {
      const result = await batchUpsertTarget({
        sheets,
        connection: currentConnection,
        owner,
        sheetName: target.sheetName,
        leads: target.leads,
        idRows: idRowsByTarget.get(key) || [],
      });
      summary.targets[key] = { sheet_name: target.sheetName, ...result };
      summary.appended += result.appended;
      summary.updated += result.updated;
    }
    summary.synced = rows.length;
    await query(
      `UPDATE user_google_sheet_connections
          SET last_sync_at = NOW(),
              last_error = NULL,
              retry_after_at = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [currentConnection.id],
    );
    await finishLog(log.id, {
      status: 'success',
      records_attempted: rows.length,
      records_synced: rows.length,
      records_failed: 0,
      details: summary,
    });
      return summary;
  } catch (error) {
    const normalized = googleError(error);
    await saveSyncError(currentConnection.id, normalized);
    await finishLog(log.id, {
      status: 'failed',
      records_attempted: 0,
      records_synced: 0,
      records_failed: 1,
      error_message: normalized.message,
    });
      throw normalized;
  }
  });
}

async function pullConnection(connection, owner, syncType = 'pull') {
  if (!connection.spreadsheet_id) {
    const error = new Error('Create or connect a Google Sheet first.');
    error.code = 'GOOGLE_SHEETS_SPREADSHEET_NOT_FOUND';
    throw error;
  }
  return withSyncLock(connection.id, async () => {
    const log = await createLog({ connectionId: connection.id, userId: owner.id, syncType });
    const summary = { attempted: 0, updated: 0, skipped: 0, conflicts: 0, failed: 0, warnings: [] };
    try {
      const { sheets } = await clientBundle(connection);
      const sheetName = connection.default_sheet_name || 'Leads';
      const escaped = sheetName.replace(/'/g, "''");
      const response = await retryTransient(() => sheets.spreadsheets.values.get({ spreadsheetId: connection.spreadsheet_id, range: `'${escaped}'!A2:AB` }));
      const sheetRows = response.data.values || [];
      const scope = scopedLeadWhere(owner);
      const { rows: leads } = await query(`${getLeadSelectSql()}${scope.sql} ORDER BY l.created_at DESC`, scope.params);
      const leadById = new Map(leads.map(lead => [String(lead.id), lead]));
      const { rows: states } = await query(`SELECT * FROM user_google_sheet_row_sync_state WHERE connection_id = $1 AND sheet_name = $2`, [connection.id, sheetName]);
      const stateByLead = new Map(states.map(state => [String(state.lead_id), state]));
      for (let offset = 0; offset < sheetRows.length; offset += 250) {
        for (const row of sheetRows.slice(offset, offset + 250)) {
          const leadId = String(row[0] || '').trim();
          const lead = leadById.get(leadId);
          if (!lead) { summary.skipped += 1; continue; }
          summary.attempted += 1;
          const sheetEditable = editableValuesFromRow(row);
          const sheetHash = valueHash(sheetEditable);
          const state = stateByLead.get(leadId);
          if (!state || state.last_pushed_hash === sheetHash) { summary.skipped += 1; continue; }
          const crmEditable = editableValuesFromRow(buildLeadSheetRow(lead));
          const crmChanged = state.last_crm_updated_at && new Date(lead.updated_at) > new Date(state.last_crm_updated_at)
            && valueHash(crmEditable) !== state.last_pushed_hash;
          if (crmChanged) {
            summary.conflicts += 1;
            await query(`UPDATE user_google_sheet_row_sync_state SET sync_status = 'conflict', updated_at = NOW() WHERE id = $1`, [state.id]);
            continue;
          }
          if (String(row[14] || '').trim() && String(row[14] || '').trim() !== String(lead.assigned_to_name || '').trim()) {
            summary.warnings.push({ lead_id: leadId, message: 'Assigned To cannot be changed from personal Google Sheet. Please reassign lead inside CRM.' });
          }
          const contacted = sheetEditable.last_contacted ? new Date(sheetEditable.last_contacted) : null;
          const validContacted = contacted && !Number.isNaN(contacted.getTime()) ? contacted.toISOString() : null;
          try {
            await query(
              `UPDATE leads SET status = COALESCE(NULLIF($2,''), status), call_status = COALESCE(NULLIF($3,'')::call_status, call_status),
                       stage = COALESCE(NULLIF($4,'')::lead_stage, stage),
                       last_call_at = COALESCE($5::timestamptz, last_call_at), updated_at = NOW()
                 WHERE id = $1`,
              [lead.id, sheetEditable.status, sheetEditable.call_status, sheetEditable.stage, validContacted],
            );
            if (sheetEditable.notes && sheetEditable.notes !== String(state.last_sheet_values?.notes || '')) {
              await query(`INSERT INTO lead_remarks(lead_id, user_id, remark) VALUES ($1,$2,$3)`, [lead.id, owner.id, sheetEditable.notes]);
            }
            await query(
              `UPDATE user_google_sheet_row_sync_state SET last_pulled_hash = $2, last_pushed_hash = $2,
                       last_sheet_values = $3, sync_status = 'synced', last_synced_at = NOW(), updated_at = NOW()
                 WHERE id = $1`,
              [state.id, sheetHash, sheetEditable],
            );
            summary.updated += 1;
          } catch (error) {
            summary.failed += 1;
            summary.warnings.push({ lead_id: leadId, message: String(error.message || 'Invalid sheet value') });
          }
        }
      }
      const status = summary.conflicts ? 'conflict' : summary.failed ? 'partial' : 'success';
      await finishLog(log.id, { status, records_attempted: summary.attempted, records_synced: summary.updated, records_failed: summary.failed, details: summary });
      await query(`UPDATE user_google_sheet_connections SET last_sync_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $1`, [connection.id]);
      return summary;
    } catch (error) {
      const normalized = googleError(error);
      await finishLog(log.id, { status: 'failed', records_attempted: summary.attempted, records_synced: summary.updated, records_failed: summary.failed + 1, details: summary, error_message: normalized.message });
      await saveSyncError(connection.id, normalized);
      throw normalized;
    }
  });
}

async function syncNow(user) {
  const connection = await getConnectionOrThrow(user.id);
  return syncConnection(connection, user, 'manual');
}

async function setupAfterOAuth(userId) {
  const owner = await getOwnerById(userId);
  let connection = await getConnectionOrThrow(userId);
  const result = { status: 'connected', sheet_created: !!connection.spreadsheet_id, first_sync: null };

  try {
    if (!connection.spreadsheet_id) {
      await createSpreadsheet(owner, { spreadsheet_name: 'DigitalADbird CRM Leads' });
      connection = await getConnectionOrThrow(userId);
      result.sheet_created = true;
    } else {
      const { sheets } = await clientBundle(connection);
      const setup = await ensureTabs({ sheets, spreadsheetId: connection.spreadsheet_id, config: configFromConnection(connection) });
      await saveSetupState(connection.id, setup);
    }
  } catch (error) {
    const normalized = googleError(error);
    await saveSyncError(connection.id, normalized);
    return { ...result, status: 'partial_setup', error_code: normalized.code, message: normalized.message };
  }

  try {
    result.first_sync = await syncConnection(connection, owner, 'initial_oauth_sync');
  } catch (error) {
    const normalized = googleError(error);
    await saveSyncError(connection.id, normalized);
    return { ...result, status: 'partial_setup', error_code: 'FIRST_SYNC_FAILED', message: normalized.message };
  }

  return result;
}

async function pullSync(user) {
  const connection = await getConnectionOrThrow(user.id);
  return pullConnection(connection, user, 'pull');
}

async function twoWaySync(user) {
  const connection = await getConnectionOrThrow(user.id);
  const pull = await pullConnection(connection, user, 'two_way_pull');
  const push = await syncConnection(connection, user, 'two_way_push');
  return { pull, push };
}

async function adminSyncNow(connectionId) {
  const connection = await getAdminConnectionOrThrow(connectionId);
  if (connection.disconnected_at) {
    const err = new Error('This Google Sheet connection is disconnected.');
    err.code = 'GOOGLE_SHEETS_NOT_CONNECTED';
    throw err;
  }
  const owner = await getConnectionOwner(connection);
  return syncConnection(connection, owner, 'admin_manual');
}

async function adminPullSync(connectionId) {
  const connection = await getAdminConnectionOrThrow(connectionId);
  const owner = await getConnectionOwner(connection);
  return pullConnection(connection, owner, 'admin_pull');
}

async function adminTestConnection(connectionId) {
  const connection = await getAdminConnectionOrThrow(connectionId);
  const owner = await getConnectionOwner(connection);
  if (!connection.spreadsheet_id) {
    const err = new Error('No spreadsheet is connected for this user.');
    err.code = 'GOOGLE_SHEETS_SPREADSHEET_NOT_FOUND';
    throw err;
  }
  const { sheets } = await clientBundle(connection);
  const setup = await ensureTabs({ sheets, spreadsheetId: connection.spreadsheet_id, config: configFromConnection(connection) });
  await saveSetupState(connection.id, setup);
  return { connection: { ...safeConnectionData(connection), user_name: owner.full_name, role: owner.role }, tabs: setup.tabs };
}

function rowObject(headers, values) {
  return headers.reduce((row, header, index) => ({ ...row, [header]: values[index] ?? '' }), {});
}

async function adminPreview(connectionId, { sheetName, page = 1, pageSize = 20, search = '' } = {}) {
  const connection = await getAdminConnectionOrThrow(connectionId);
  const owner = await getConnectionOwner(connection);
  if (!connection.spreadsheet_id) {
    const err = new Error('No spreadsheet is connected for this user.');
    err.code = 'GOOGLE_SHEETS_SPREADSHEET_NOT_FOUND';
    throw err;
  }
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(50, Math.max(1, Number(pageSize) || 20));
  const selectedSheet = sanitizeSheetName(sheetName || connection.default_sheet_name || 'Leads') || 'Leads';
  const { sheets } = await clientBundle(connection);
  let values;
  const offset = (safePage - 1) * safeSize;
  const lastRow = offset + safeSize + 2;
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: connection.spreadsheet_id,
      range: `'${selectedSheet.replace(/'/g, "''")}'!A1:AB${lastRow}`,
    });
    values = result.data.values || [];
  } catch (_) {
    const err = new Error('The selected sheet tab could not be read.');
    err.code = 'GOOGLE_SHEETS_ACCESS_DENIED';
    throw err;
  }
  const headers = (values[0] || LEAD_SHEET_HEADERS).slice(0, LEAD_SHEET_HEADERS.length);
  const needle = String(search || '').trim().toLowerCase();
  const filtered = values.slice(1).filter(row => !needle || row.some(value => String(value || '').toLowerCase().includes(needle)));
  const pageRows = filtered.slice(offset, offset + safeSize).map(row => rowObject(headers, row));
  return {
    connection: {
      id: connection.id,
      user_id: owner.id,
      user_name: owner.full_name,
      role: owner.role,
      google_email: connection.google_email,
      spreadsheet_id: connection.spreadsheet_id,
      spreadsheet_name: connection.spreadsheet_name,
    },
    sheet_name: selectedSheet,
    headers,
    rows: pageRows,
    pagination: { page: safePage, page_size: safeSize, has_more: filtered.length > offset + pageRows.length },
  };
}

async function disconnect(user) {
  return oauth.disconnect(user.id);
}

async function getLogs(user, { page = 1, pageSize = 20 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(50, Math.max(1, Number(pageSize) || 20));
  const offset = (safePage - 1) * safeSize;
  const [{ rows }, { rows: countRows }] = await Promise.all([
    query(
      `SELECT * FROM user_google_sheet_sync_logs
        WHERE user_id = $1
        ORDER BY started_at DESC
        LIMIT $2 OFFSET $3`,
      [user.id, safeSize, offset],
    ),
    query(`SELECT COUNT(*)::int AS total FROM user_google_sheet_sync_logs WHERE user_id = $1`, [user.id]),
  ]);
  const total = countRows[0]?.total || 0;
  return { data: rows, pagination: { page: safePage, page_size: safeSize, total, total_pages: Math.ceil(total / safeSize), has_more: offset + rows.length < total } };
}

async function listConnections({ page = 1, pageSize = 20, search = '', role = '', status = '', userId = '' } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(50, Math.max(1, Number(pageSize) || 20));
  const offset = (safePage - 1) * safeSize;
  const filters = [];
  const params = [];
  const add = (sql, value) => { params.push(value); filters.push(sql.replace('?', `$${params.length}`)); };
  if (search) add(`(u.full_name ILIKE ? OR c.google_email ILIKE ? OR c.spreadsheet_name ILIKE ?)`, `%${search}%`);
  if (search) { params.push(`%${search}%`, `%${search}%`); filters[filters.length - 1] = `(u.full_name ILIKE $${params.length - 2} OR c.google_email ILIKE $${params.length - 1} OR c.spreadsheet_name ILIKE $${params.length})`; }
  if (role) add('u.role = ?', role);
  if (userId) add('u.id = ?', userId);
  if (status === 'connected') filters.push(`c.disconnected_at IS NULL AND (c.retry_after_at IS NULL OR c.retry_after_at <= NOW()) AND COALESCE(c.last_error, '') !~* 'refresh|reconnect|expired'`);
  if (status === 'disconnected') filters.push('c.disconnected_at IS NOT NULL');
  if (status === 'needs_reconnect') filters.push(`c.disconnected_at IS NULL AND COALESCE(c.last_error, '') ~* 'refresh|reconnect|expired'`);
  if (status === 'quota_cooldown') filters.push(`c.disconnected_at IS NULL AND c.retry_after_at > NOW()`);
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const listParams = [...params, safeSize, offset];
  const [{ rows }, { rows: countRows }] = await Promise.all([
    query(
      `SELECT c.id, c.user_id, c.google_email, c.spreadsheet_id, c.spreadsheet_name,
              c.default_sheet_name, c.trader_sheet_name, c.partner_sheet_name, c.unknown_sheet_name,
              c.sync_enabled, c.last_sync_at, c.last_error, c.retry_after_at, c.disconnected_at, c.created_at, c.updated_at,
              u.full_name AS user_name, u.role, u.team_name, rm.full_name AS rm_name,
              CASE WHEN c.disconnected_at IS NOT NULL THEN 'disconnected'
                   WHEN COALESCE(c.last_error, '') ~* 'refresh|reconnect|expired' THEN 'needs_reconnect'
                   WHEN c.retry_after_at > NOW() THEN 'quota_cooldown'
                   WHEN c.last_error IS NOT NULL THEN 'sync_failed'
                   ELSE 'connected' END AS status
         FROM user_google_sheet_connections c
         JOIN users u ON u.id = c.user_id
         LEFT JOIN users rm ON rm.id = u.report_to_id
        ${where}
        ORDER BY c.updated_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams,
    ),
    query(`SELECT COUNT(*)::int AS total FROM user_google_sheet_connections c JOIN users u ON u.id = c.user_id ${where}`, params),
  ]);
  const total = countRows[0]?.total || 0;
  return { data: rows, pagination: { page: safePage, page_size: safeSize, total, total_pages: Math.ceil(total / safeSize), has_more: offset + rows.length < total } };
}

async function listAllLogs({ page = 1, pageSize = 20, userId = '', status = '' } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(50, Math.max(1, Number(pageSize) || 20));
  const offset = (safePage - 1) * safeSize;
  const filters = [];
  const params = [];
  if (userId) { params.push(userId); filters.push(`l.user_id = $${params.length}`); }
  if (status) { params.push(status); filters.push(`l.status = $${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const [{ rows }, { rows: countRows }] = await Promise.all([
    query(
      `SELECT l.*, u.full_name AS user_name, u.role
         FROM user_google_sheet_sync_logs l
         LEFT JOIN users u ON u.id = l.user_id
        ${where}
        ORDER BY l.started_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, safeSize, offset],
    ),
    query(`SELECT COUNT(*)::int AS total FROM user_google_sheet_sync_logs l ${where}`, params),
  ]);
  const total = countRows[0]?.total || 0;
  return { data: rows, pagination: { page: safePage, page_size: safeSize, total, total_pages: Math.ceil(total / safeSize), has_more: offset + rows.length < total } };
}

module.exports = {
  getStatus,
  createSpreadsheet,
  connectExisting,
  updateSettings,
  testConnection,
  syncNow,
  disconnect,
  getLogs,
  listConnections,
  listAllLogs,
  listSpreadsheets,
  setupAfterOAuth,
  pullSync,
  twoWaySync,
  adminPreview,
  adminTestConnection,
  adminSyncNow,
  adminPullSync,
};
