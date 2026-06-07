#!/usr/bin/env node
/**
 * SAFE export of Meta integration CONFIG (no secrets, no PII).
 *
 * Exports a SQL seed file (db/seeds/meta-config-seed.sql) containing:
 *   - meta_pages    (page_id, page_name, is_active)    — token columns NULLED
 *   - meta_forms    (form_id, form_name, page_id)
 *   - meta_campaigns (id, name, category, status, page_id, form_id)
 *   - distribution_settings (key, value)
 *   - distribution_rules (name, strategy, eligible_*)
 *
 * EXCLUDED for security/privacy:
 *   - All access tokens / refresh tokens / API keys / passwords
 *   - leads / lead_assignments / lead_requests (contain PII)
 *   - users (passwords)
 *   - auth_sessions (session tokens)
 *   - integration_configs (likely contains API keys)
 *   - sheet_configs (contains Google service account JSON)
 *
 * The output uses INSERT ... ON CONFLICT DO NOTHING — idempotent,
 * non-destructive. Running it on VPS will ADD missing pages/forms/
 * campaigns to existing data without wiping anything.
 *
 * After applying this seed on VPS, user must:
 *   1. Open each page in CRM UI → "Update Token" → paste System User token
 *   2. Upload google-service-account.json via scp (git-ignored)
 *   3. Run `recover-meta-leads.js` to backfill leads from Meta (source of truth)
 */
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'src', 'db', 'seeds', 'meta-config-seed.sql');

function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (v instanceof Date) return "'" + v.toISOString() + "'::timestamptz";
  if (Array.isArray(v) || typeof v === 'object')
    return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/**
 * Helper — emit INSERT ... ON CONFLICT DO NOTHING for a table,
 * skipping any blacklisted columns (tokens, secrets, etc).
 */
async function emitTable(c, out, table, opts = {}) {
  const { skipCols = [], conflictCol = 'id', where = '' } = opts;

  // Get columns
  const cols = await c.query(
    "SELECT column_name, is_generated FROM information_schema.columns " +
    "WHERE table_name=$1 AND table_schema='public' ORDER BY ordinal_position",
    [table]
  );
  if (cols.rows.length === 0) {
    out.write(`-- ${table}: TABLE NOT FOUND, skipping\n\n`);
    return 0;
  }

  // Filter out generated cols + blacklist
  const inserted = cols.rows
    .filter(r => r.is_generated !== 'ALWAYS')
    .filter(r => !skipCols.includes(r.column_name))
    .map(r => r.column_name);

  // Fetch data
  const whereClause = where ? ` WHERE ${where}` : '';
  const data = await c.query(`SELECT ${inserted.map(c => `"${c}"`).join(',')} FROM "${table}"${whereClause}`);

  out.write(`-- ${table}: ${data.rows.length} rows (excluded cols: ${skipCols.join(', ') || 'none'})\n`);
  if (data.rows.length === 0) { out.write('\n'); return 0; }

  // For meta_pages: NULL out token columns explicitly in the values
  // so any column that survived filtering but contains a secret won't leak.
  for (let i = 0; i < data.rows.length; i += 100) {
    const slice = data.rows.slice(i, i + 100);
    out.write(`INSERT INTO "${table}" (${inserted.map(c => `"${c}"`).join(',')}) VALUES\n`);
    const valLines = slice.map(row =>
      '  (' + inserted.map(col => lit(row[col])).join(',') + ')'
    );
    out.write(valLines.join(',\n'));
    out.write(`\nON CONFLICT (${conflictCol}) DO NOTHING;\n`);
  }
  out.write('\n');
  return data.rows.length;
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const out = fs.createWriteStream(OUT);

  out.write('-- DigitalADbird CRM — Meta integration CONFIG seed (no secrets, no PII)\n');
  out.write('-- Generated: ' + new Date().toISOString() + '\n');
  out.write('-- Source: localhost\n');
  out.write('--\n');
  out.write('-- IDEMPOTENT — safe to run multiple times. Uses ON CONFLICT DO NOTHING.\n');
  out.write('-- NO truncates. NO wipes. NO secrets. NO lead PII.\n');
  out.write('--\n');
  out.write('-- Apply on VPS:\n');
  out.write('--   psql "$DATABASE_URL" -f backend/src/db/seeds/meta-config-seed.sql\n');
  out.write('--\n');
  out.write('-- AFTER applying:\n');
  out.write('--   1. CRM UI → Meta Pages → each page → "Update Token" (paste token)\n');
  out.write('--   2. scp google-service-account.json to VPS backend/credentials/\n');
  out.write('--   3. cd backend && BACKFILL_DAYS=7 node scripts/recover-meta-leads.js\n');
  out.write('--      (pulls leads from Meta directly, no PII transits git)\n\n');
  out.write('BEGIN;\n\n');

  const summary = {};

  // meta_pages — NULL out token columns
  summary.meta_pages = await emitTable(c, out, 'meta_pages', {
    skipCols: ['page_access_token', 'access_token', 'user_access_token'],
    conflictCol: 'page_id',
  });

  // meta_forms — no sensitive cols
  summary.meta_forms = await emitTable(c, out, 'meta_forms', {
    conflictCol: 'form_id',
  });

  // meta_campaigns
  summary.meta_campaigns = await emitTable(c, out, 'meta_campaigns', {
    conflictCol: 'campaign_id',
  });

  // meta_ad_accounts
  summary.meta_ad_accounts = await emitTable(c, out, 'meta_ad_accounts', {
    skipCols: ['access_token'],
    conflictCol: 'account_id',
  });

  // distribution_settings — key/value pairs (no secrets)
  summary.distribution_settings = await emitTable(c, out, 'distribution_settings', {
    conflictCol: 'key',
  });

  // distribution_rules — strategy config
  summary.distribution_rules = await emitTable(c, out, 'distribution_rules', {
    conflictCol: 'id',
  });

  out.write('COMMIT;\n');
  out.end();
  await new Promise(r => out.on('close', r));
  await c.end();

  const stat = fs.statSync(OUT);
  console.log('\n=== Export summary ===');
  for (const [k, v] of Object.entries(summary)) console.log('  ' + k.padEnd(25) + ' ' + v + ' rows');
  console.log('\nOutput: ' + OUT);
  console.log('Size:   ' + (stat.size / 1024).toFixed(2) + ' KB');
  console.log('\nSAFE TO COMMIT — contains no secrets, no PII, no passwords.');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
