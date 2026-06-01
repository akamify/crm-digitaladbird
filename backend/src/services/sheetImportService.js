/**
 * Google Sheet → CRM import service.
 *
 * Reads the full active sheet, parses each row, and upserts into `leads`.
 *
 * Duplicate detection (in this order):
 *   1. meta_lead_id   (if the sheet has a `l:xxxx` column — Meta lead IDs are unique)
 *   2. phone          (normalised — strip `p:` prefix, non-digits except leading +)
 *   3. email          (lowercased, exact match)
 *
 * Header detection is dynamic. We find the first row that contains any of:
 *   ['phone','phone_number','mobile','full_name','name','email','platform']
 * Anything above that row is treated as garbage (a typical export ships one
 * extra "preview" / banner row above the real header).
 *
 * After insert, every new lead goes through the existing distribution engine
 * so it shows up in /leads filtered + assigned exactly like a Meta webhook
 * lead would.
 */
const { google }     = require('googleapis');
const { decrypt }    = require('../utils/secretsCrypto');
const { query, withTransaction } = require('../config/database');
const logger         = require('../utils/logger');
const { assignLead } = require('./leadDistributionService');
const { onLeadCreated } = require('./leadEventService');
const { isDistributionActive } = require('./distributionScheduler');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

// Canonical field name → list of header aliases (case + space insensitive)
const FIELD_ALIASES = {
  meta_lead_id:   ['lead_id', 'leadgen_id', 'l_id'],
  created_time:   ['created_time', 'created_at', 'createdtime', 'lead_created', 'time'],
  ad_id:          ['ad_id', 'adid', 'ag_id'],
  ad_name:        ['ad_name', 'adname'],
  adset_id:       ['adset_id', 'as_id'],
  adset_name:     ['adset_name', 'adsetname'],
  campaign_id:    ['campaign_id', 'c_id', 'cid'],
  campaign_name:  ['campaign_name', 'campaignname', 'campaign'],
  form_id:        ['form_id', 'f_id', 'fid'],
  form_name:      ['form_name', 'formname'],
  is_organic:     ['is_organic', 'organic'],
  platform:       ['platform', 'channel', 'source_platform'],
  full_name:      ['full_name', 'fullname', 'name', 'lead_name'],
  phone:          ['phone', 'phone_number', 'mobile', 'mobile_number', 'whatsapp', 'contact'],
  email:          ['email', 'email_address', 'e_mail', 'mail'],
  city:           ['city', 'town', 'shahr'],
  state:          ['state', 'rajya'],
  category:       ['category', 'business_category', 'product_tag', 'product', 'service'],
};

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function looksLikeLeadId(s)  { return /^l:[a-z0-9]+/i.test(String(s || '')); }
function looksLikePhone(s)   { return /^p?:?\+?\d[\d\s\-()]{6,}$/i.test(String(s || '')); }

/**
 * Build a candidate column map for `row`. Returns {map, score} where score is
 * the number of canonical fields matched. A row that looks like data (only a
 * few stray label cells) will score low; the actual header row scores high.
 */
function scoreCandidate(row) {
  if (!Array.isArray(row)) return { map: {}, score: 0 };
  const headerRow = row.map(norm);
  const map = {};
  let score = 0;
  for (const [canon, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const a of aliases) {
      const j = headerRow.indexOf(norm(a));
      if (j >= 0) { map[canon] = j; score++; break; }
    }
  }
  return { map, score };
}

/**
 * Returns { headerIdx, columnMap }. Scans the first ~5 rows and picks the row
 * with the highest score that ALSO contains either `phone` or `email` (we
 * can't import a lead without one of them, so any candidate without those is
 * useless even if it has high score).
 */
function detectHeaderAndMap(values) {
  let best = { headerIdx: -1, columnMap: {}, score: 0 };
  for (let i = 0; i < Math.min(values.length, 6); i++) {
    const { map, score } = scoreCandidate(values[i]);
    const hasContact = map.phone !== undefined || map.email !== undefined;
    if (!hasContact) continue;
    if (score > best.score) {
      best = { headerIdx: i, columnMap: map, score };
    }
  }
  return best;
}

function stripPrefix(s, prefix) {
  s = String(s || '').trim();
  return s.startsWith(prefix) ? s.slice(prefix.length).trim() : s;
}
function normPhone(raw) {
  let s = stripPrefix(raw, 'p:');
  s = s.replace(/[\s\-()]/g, '');
  if (!s) return null;
  if (!s.startsWith('+') && /^\d{10,12}$/.test(s)) s = '+91' + s.replace(/^91/, '');
  return s;
}
function normEmail(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}
function normSource(platform) {
  const p = String(platform || '').toLowerCase();
  if (p === 'fb' || p === 'facebook' || p === 'ig' || p === 'instagram') return 'meta';
  if (p === 'google' || p === 'gads')                                     return 'google';
  if (p === 'whatsapp' || p === 'wa')                                     return 'whatsapp';
  return 'import';
}
function parseTimestamp(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Truncate to fit the leads table's VARCHAR widths so a single oversize cell
// doesn't fail the whole row. Width chosen from migration 001 schema.
function trunc(s, max) {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function rowToLead(row, columnMap) {
  function pick(field) { const i = columnMap[field]; return i !== undefined ? row[i] : null; }
  const phone = normPhone(pick('phone'));
  const email = normEmail(pick('email'));
  if (!phone && !email) return null; // can't dedupe / contact

  const meta_lead_id = stripPrefix(pick('meta_lead_id'), 'l:') || null;
  return {
    meta_lead_id: trunc(meta_lead_id, 64),
    full_name:    trunc(pick('full_name'), 190),
    phone,
    email:        trunc(email, 190),
    city:         trunc(pick('city'),  120),
    state:        trunc(pick('state'), 120),
    source:       normSource(pick('platform')),
    meta_form_id:    trunc(stripPrefix(pick('form_id'),     'f:'),  64),
    meta_page_id:    trunc(stripPrefix(pick('ad_id'),       'ag:'), 64),
    meta_campaign_id: trunc(stripPrefix(pick('campaign_id'), 'c:'), 64),
    meta_adset_id:   trunc(stripPrefix(pick('adset_id'),    'as:'), 64),
    meta_ad_id:      trunc(stripPrefix(pick('ad_id'),       'ag:'), 64),
    campaign_name:   trunc(pick('campaign_name'), 190),
    adset_name:      trunc(pick('adset_name'),    190),
    ad_name:         trunc(pick('ad_name'),       190),
    product_tag:     trunc(pick('category'),      120),
    meta_created_time: parseTimestamp(pick('created_time')),
  };
}

async function buildSheetsClient(creds) {
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function fetchAllRows({ sheets, sheetId, sheetName }) {
  const range = `${sheetName}!A1:Z`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  return res.data.values || [];
}

/**
 * Find an existing lead by (meta_lead_id, phone, email). Returns id or null.
 * The check fires inside a transaction so concurrent imports don't race.
 */
async function findExistingId(client, lead) {
  if (lead.meta_lead_id) {
    const { rows } = await client.query(
      `SELECT id FROM leads WHERE meta_lead_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [lead.meta_lead_id],
    );
    if (rows[0]) return { id: rows[0].id, reason: 'meta_lead_id' };
  }
  if (lead.phone) {
    const { rows } = await client.query(
      `SELECT id FROM leads WHERE phone = $1 AND deleted_at IS NULL LIMIT 1`,
      [lead.phone],
    );
    if (rows[0]) return { id: rows[0].id, reason: 'phone' };
  }
  if (lead.email) {
    const { rows } = await client.query(
      `SELECT id FROM leads WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
      [lead.email],
    );
    if (rows[0]) return { id: rows[0].id, reason: 'email' };
  }
  return null;
}

/**
 * Main entrypoint.
 *
 * @param {object} opts
 * @param {string} opts.configId    - integration_configs.id (must be google_sheets)
 * @param {string} [opts.triggeredBy='manual']
 * @param {string} [opts.userId]
 * @param {boolean} [opts.assign=true]  - run distribution on each new lead
 * @param {number} [opts.maxRows]    - safety cap (default 5000)
 * @returns {Promise<{ imported:number, duplicates:number, failed:number, total:number, log_id:string }>}
 */
async function importFromConfig(opts) {
  const { configId, triggeredBy = 'manual', userId = null, assign = true, maxRows = 5000 } = opts;

  const { rows: [cfg] } = await query(
    `SELECT id, config, secrets_encrypted, label, purpose FROM integration_configs
       WHERE id = $1 AND kind = 'google_sheets'`,
    [configId],
  );
  if (!cfg) throw new Error('Config not found');
  if (!cfg.secrets_encrypted) throw new Error('No credentials on this config');

  // Create the log row immediately so failures are still tracked
  const { rows: [log] } = await query(
    `INSERT INTO sheet_import_logs(config_id, triggered_by, user_id) VALUES ($1, $2, $3) RETURNING id`,
    [configId, triggeredBy, userId],
  );
  const logId = log.id;

  const finishLog = async (stats, err = null) => {
    await query(
      `UPDATE sheet_import_logs
          SET finished_at = NOW(),
              total_rows = $1, imported = $2, duplicates = $3, failed = $4,
              error_message = $5, failed_samples = $6
        WHERE id = $7`,
      [stats.total, stats.imported, stats.duplicates, stats.failed, err, stats.failed_samples ? JSON.stringify(stats.failed_samples.slice(0, 10)) : null, logId],
    );
    await query(
      `UPDATE integration_configs
          SET last_import_at = NOW(), last_import_stats = $1
        WHERE id = $2`,
      [JSON.stringify({ ...stats, log_id: logId, finished_at: new Date().toISOString() }), configId],
    );
  };

  let sheets;
  try {
    sheets = await buildSheetsClient(decrypt(cfg.secrets_encrypted));
  } catch (err) {
    const stats = { total: 0, imported: 0, duplicates: 0, failed: 0, failed_samples: [] };
    await finishLog(stats, `Auth: ${err.message}`);
    throw err;
  }

  let values;
  try {
    values = await fetchAllRows({ sheets, sheetId: cfg.config?.sheet_id, sheetName: cfg.config?.sheet_name || 'Sheet1' });
  } catch (err) {
    const stats = { total: 0, imported: 0, duplicates: 0, failed: 0, failed_samples: [] };
    await finishLog(stats, `Fetch: ${err.message}`);
    throw err;
  }

  const { headerIdx, columnMap } = detectHeaderAndMap(values);
  if (headerIdx < 0) {
    const stats = { total: values.length, imported: 0, duplicates: 0, failed: 0, failed_samples: [] };
    await finishLog(stats, 'Could not detect header row (no phone/email/full_name column found)');
    throw new Error('Could not detect header row in sheet');
  }

  const dataRows = values.slice(headerIdx + 1, headerIdx + 1 + maxRows);
  const stats = { total: dataRows.length, imported: 0, duplicates: 0, failed: 0, failed_samples: [] };

  // Pre-load the set of known meta_form_id values so we only set the FK when
  // the form is already registered. Unknown form IDs get nulled out but
  // preserved in raw_payload for later auto-registration if desired.
  const knownFormIds = new Set();
  try {
    const { rows: fr } = await query(`SELECT form_id FROM meta_forms`);
    fr.forEach(r => knownFormIds.add(String(r.form_id)));
  } catch (_) { /* meta_forms may be empty */ }

  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    let lead;
    try {
      lead = rowToLead(row, columnMap);
    } catch (err) {
      stats.failed++;
      if (stats.failed_samples.length < 10) stats.failed_samples.push({ row_index: r + headerIdx + 2, error: err.message });
      continue;
    }
    if (!lead) {
      // No phone, no email — can't dedupe, skip
      stats.failed++;
      if (stats.failed_samples.length < 10) stats.failed_samples.push({ row_index: r + headerIdx + 2, error: 'no_phone_or_email' });
      continue;
    }

    try {
      // FK guard: only set meta_form_id if the form is registered; keep the
      // original in raw_payload either way so admins can register & re-import.
      const safeFormId = lead.meta_form_id && knownFormIds.has(String(lead.meta_form_id))
        ? lead.meta_form_id
        : null;

      // Map sheet purpose → leads.category. Sheet "partners" tags every imported
      // lead as category='partner' so partner lead-requests pull from this pool;
      // "traders" → category='trader'. Default 'trader' matches the column's
      // default in 002_roles_and_categories.sql.
      const leadCategory = cfg.purpose === 'partners' ? 'partner'
                         : cfg.purpose === 'traders'  ? 'trader'
                         : 'trader';

      const newId = await withTransaction(async (client) => {
        const dup = await findExistingId(client, lead);
        if (dup) return null;
        const ins = await client.query(
          `INSERT INTO leads (
             full_name, phone, email, city, state,
             source, meta_lead_id, meta_form_id, meta_page_id,
             meta_campaign_id, meta_adset_id, meta_ad_id, meta_created_time,
             product_tag, campaign_name, adset_name, ad_name, raw_payload, category
           ) VALUES (
             $1,$2,$3,$4,$5, $6,$7,$8,$9, $10,$11,$12,$13, $14,$15,$16,$17, $18, $19
           )
           ON CONFLICT (meta_lead_id) DO NOTHING
           RETURNING id`,
          [
            lead.full_name, lead.phone, lead.email, lead.city, lead.state,
            lead.source, lead.meta_lead_id, safeFormId, lead.meta_page_id,
            lead.meta_campaign_id, lead.meta_adset_id, lead.meta_ad_id, lead.meta_created_time,
            lead.product_tag, lead.campaign_name, lead.adset_name, lead.ad_name,
            JSON.stringify({ imported_from: 'google_sheet', config_id: configId, sheet_purpose: cfg.purpose, source_row: row, raw_form_id: lead.meta_form_id }),
            leadCategory,
          ],
        );
        return ins.rows[0]?.id || null;
      });

      if (!newId) { stats.duplicates++; continue; }
      stats.imported++;

      if (assign) {
        try {
          if (await isDistributionActive()) {
            await assignLead(newId);
          }
        } catch (e) {
          logger.warn({ leadId: newId, err: e.message }, '[SheetImport] distribution failed (lead saved, will re-assign later)');
        }
      }

      // Real-time broadcast — every new sheet-imported lead lights up dashboards
      // exactly the way a fresh webhook lead does. `appendLead` inside the helper
      // is a no-op for bulk imports of rows that came FROM the sheet (the row is
      // already there), so this is safe for both first-time and incremental runs.
      onLeadCreated(newId, { source: 'sheet_import' });
    } catch (err) {
      stats.failed++;
      if (stats.failed_samples.length < 10) stats.failed_samples.push({ row_index: r + headerIdx + 2, error: err.message });
      logger.error({ err: err.message, row: r }, '[SheetImport] row insert failed');
    }
  }

  await finishLog(stats);
  logger.info({ configId, ...stats }, '[SheetImport] complete');
  return { ...stats, log_id: logId };
}

async function getRecentLogs(configId, limit = 20) {
  const { rows } = await query(
    `SELECT id, triggered_by, started_at, finished_at, total_rows, imported, duplicates, failed,
            error_message, failed_samples,
            (SELECT full_name FROM users u WHERE u.id = sil.user_id) AS triggered_by_name
       FROM sheet_import_logs sil
      WHERE config_id = $1
      ORDER BY started_at DESC
      LIMIT $2`,
    [configId, Math.min(100, limit)],
  );
  return rows;
}

module.exports = {
  importFromConfig,
  getRecentLogs,
  // Exposed for tests
  detectHeaderAndMap,
  normPhone,
  normEmail,
  normSource,
};
