const { google } = require('googleapis');
const { query } = require('../config/database');
const oauth = require('./googleUserOAuthService');
const {
  LEAD_SHEET_HEADERS,
  ensureLeadSheetExists,
  upsertLeadToSheet,
  getLeadSelectSql,
} = require('./googleSheetsService');
const {
  resolveConfiguredSheetNames,
  resolveLeadSheetTargets,
  sanitizeSheetName,
} = require('./googleSheets/googleSheetNameResolver');

function connectionData(connection) {
  if (!connection) return { connected: false };
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
    open_url: connection.spreadsheet_id ? `https://docs.google.com/spreadsheets/d/${connection.spreadsheet_id}` : null,
    status: connection.disconnected_at
      ? 'disconnected'
      : (/refresh|reconnect|expired/i.test(connection.last_error || '') ? 'needs_reconnect' : 'connected'),
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

async function ensureTabs({ sheets, spreadsheetId, config }) {
  const names = resolveConfiguredSheetNames(config);
  const tabs = [...new Set([
    names.defaultSheetName,
    names.traderSheetName,
    names.partnerSheetName,
    names.unknownSheetName,
  ].filter(Boolean))];
  const results = {};
  for (const tab of tabs) {
    const sheetName = await ensureLeadSheetExists({
      sheets,
      spreadsheetId,
      sheetName: tab,
      headers: LEAD_SHEET_HEADERS,
      autoCreate: true,
    });
    results[tab] = { sheet_name: sheetName, ready: true };
  }
  return results;
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

async function createSpreadsheet(user, title = 'DigitalADbird CRM Leads') {
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
  await ensureTabs({ sheets, spreadsheetId: spreadsheet.spreadsheetId, config: configFromConnection(nextConnection) });
  return connectionData(nextConnection);
}

async function connectExisting(user, input) {
  const spreadsheetId = parseSpreadsheetId(input);
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
  await ensureTabs({ sheets, spreadsheetId, config: configFromConnection(nextConnection) });
  return connectionData(nextConnection);
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
  const tabs = await ensureTabs({ sheets, spreadsheetId: connection.spreadsheet_id, config });
  const routing = {
    trader: resolveLeadSheetTargets({ lead: { category: 'trader' }, config }).map(t => t.sheetName),
    partner: resolveLeadSheetTargets({ lead: { category: 'partner' }, config }).map(t => t.sheetName),
    unknown: resolveLeadSheetTargets({ lead: { category: 'unknown' }, config }).map(t => t.sheetName),
  };
  return { spreadsheet_id: connection.spreadsheet_id, tabs, routing };
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

async function syncConnection(connection, owner, syncType = 'manual') {
  if (!connection.spreadsheet_id) {
    const err = new Error('Create or connect a Google Sheet first.');
    err.code = 'GOOGLE_SHEETS_SPREADSHEET_NOT_FOUND';
    throw err;
  }
  if (connection.sync_enabled === false) {
    const err = new Error('Google Sheet sync is disabled for this connection.');
    err.code = 'GOOGLE_SHEETS_SYNC_FAILED';
    throw err;
  }
  const log = await createLog({ connectionId: connection.id, userId: owner.id, syncType });
  try {
    const { sheets } = await clientBundle(connection);
    const config = configFromConnection(connection);
    await ensureTabs({ sheets, spreadsheetId: connection.spreadsheet_id, config });
    const scope = scopedLeadWhere(owner);
    const { rows } = await query(`${getLeadSelectSql()}${scope.sql} ORDER BY l.created_at DESC`, scope.params);
    const summary = { attempted: rows.length, synced: 0, failed: 0, targets: {} };
    for (const lead of rows) {
      const targets = resolveLeadSheetTargets({ lead, config });
      for (const target of targets) {
        const result = await upsertLeadToSheet({
          sheets,
          spreadsheetId: connection.spreadsheet_id,
          sheetName: target.sheetName,
          lead,
          autoCreate: true,
        });
        summary.synced += 1;
        summary.targets[target.key] = summary.targets[target.key] || { sheet_name: target.sheetName, upserted: 0, updated: 0, appended: 0 };
        summary.targets[target.key].upserted += 1;
        if (result.action === 'updated') summary.targets[target.key].updated += 1;
        if (result.action === 'appended') summary.targets[target.key].appended += 1;
      }
    }
    await query(
      `UPDATE user_google_sheet_connections SET last_sync_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $1`,
      [connection.id],
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
    await query(
      `UPDATE user_google_sheet_connections SET last_error = $2, updated_at = NOW() WHERE id = $1`,
      [connection.id, error.message],
    ).catch(() => {});
    await finishLog(log.id, {
      status: 'failed',
      records_attempted: 0,
      records_synced: 0,
      records_failed: 1,
      error_message: error.message,
    });
    throw error;
  }
}

async function syncNow(user) {
  const connection = await getConnectionOrThrow(user.id);
  return syncConnection(connection, user, 'manual');
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

async function adminTestConnection(connectionId) {
  const connection = await getAdminConnectionOrThrow(connectionId);
  const owner = await getConnectionOwner(connection);
  if (!connection.spreadsheet_id) {
    const err = new Error('No spreadsheet is connected for this user.');
    err.code = 'GOOGLE_SHEETS_SPREADSHEET_NOT_FOUND';
    throw err;
  }
  const { sheets } = await clientBundle(connection);
  const tabs = await ensureTabs({ sheets, spreadsheetId: connection.spreadsheet_id, config: configFromConnection(connection) });
  return { connection: { ...safeConnectionData(connection), user_name: owner.full_name, role: owner.role }, tabs };
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
      range: `'${selectedSheet.replace(/'/g, "''")}'!A1:R${lastRow}`,
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
  if (status === 'connected') filters.push(`c.disconnected_at IS NULL AND COALESCE(c.last_error, '') !~* 'refresh|reconnect|expired'`);
  if (status === 'disconnected') filters.push('c.disconnected_at IS NOT NULL');
  if (status === 'needs_reconnect') filters.push(`c.disconnected_at IS NULL AND COALESCE(c.last_error, '') ~* 'refresh|reconnect|expired'`);
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const listParams = [...params, safeSize, offset];
  const [{ rows }, { rows: countRows }] = await Promise.all([
    query(
      `SELECT c.id, c.user_id, c.google_email, c.spreadsheet_id, c.spreadsheet_name,
              c.default_sheet_name, c.trader_sheet_name, c.partner_sheet_name, c.unknown_sheet_name,
              c.sync_enabled, c.last_sync_at, c.last_error, c.disconnected_at, c.created_at, c.updated_at,
              u.full_name AS user_name, u.role, u.team_name, rm.full_name AS rm_name,
              CASE WHEN c.disconnected_at IS NOT NULL THEN 'disconnected'
                   WHEN COALESCE(c.last_error, '') ~* 'refresh|reconnect|expired' THEN 'needs_reconnect'
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
  adminPreview,
  adminTestConnection,
  adminSyncNow,
};
