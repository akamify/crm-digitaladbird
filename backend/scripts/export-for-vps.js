#!/usr/bin/env node
/**
 * Export full DB state from localhost into a single SQL file
 * that can be loaded onto VPS with: psql < crm-data-dump.sql
 *
 * Output: crm-data-dump.sql at repo root.
 *
 * Strategy: TRUNCATE + INSERT per table. Disables FK checks via single
 * transaction with `SET session_replication_role = replica`. Idempotent —
 * re-running on VPS produces the exact same state.
 *
 * Tables exported (in FK-safe order):
 *   users, distribution_settings, distribution_rules, integration_configs,
 *   sheet_configs, meta_pages, meta_forms, meta_campaigns, meta_ad_accounts,
 *   meta_sync_log, leads, lead_assignments, lead_requests, rm_lead_requests,
 *   activity_logs, auth_sessions
 *
 * Skipped: schema_migrations (handled by migrate.js on VPS)
 */
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '..', 'crm-data-dump.sql');

// Order matters — parents first
const TABLES = [
  'users',
  'distribution_settings',
  'distribution_rules',
  'integration_configs',
  'sheet_configs',
  'meta_pages',
  'meta_forms',
  'meta_campaigns',
  'meta_ad_accounts',
  'meta_sync_log',
  'leads',
  'lead_assignments',
  'lead_requests',
  'rm_lead_requests',
  'activity_logs',
  'auth_sessions',
];

function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (v instanceof Date) return "'" + v.toISOString() + "'::timestamptz";
  if (Array.isArray(v)) return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";
  if (typeof v === 'object') return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const out = fs.createWriteStream(OUT);
  out.write('-- DigitalADbird CRM full data dump\n');
  out.write('-- Generated: ' + new Date().toISOString() + '\n');
  out.write('-- Source: localhost embedded Postgres\n');
  out.write('-- Restore: psql $DATABASE_URL < crm-data-dump.sql\n\n');
  out.write('BEGIN;\n');
  out.write("SET session_replication_role = replica;  -- bypass FK + triggers during load\n\n");

  const summary = [];
  for (const t of TABLES) {
    try {
      const cols = await c.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND table_schema='public' ORDER BY ordinal_position",
        [t]
      );
      if (cols.rows.length === 0) { summary.push([t, '(skipped — table missing)']); continue; }

      // Skip generated columns — INSERT can't write them
      const genCols = await c.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND table_schema='public' AND is_generated='ALWAYS'",
        [t]
      );
      const generated = new Set(genCols.rows.map(r => r.column_name));
      const colNames = cols.rows.map(r => r.column_name).filter(n => !generated.has(n));

      const data = await c.query(`SELECT ${colNames.map(c => `"${c}"`).join(',')} FROM "${t}"`);
      out.write(`-- ${t}: ${data.rows.length} rows\n`);
      out.write(`TRUNCATE TABLE "${t}" CASCADE;\n`);

      if (data.rows.length === 0) { summary.push([t, 0]); out.write('\n'); continue; }

      // Batch into chunks of 200 rows per INSERT
      const chunk = 200;
      for (let i = 0; i < data.rows.length; i += chunk) {
        const slice = data.rows.slice(i, i + chunk);
        out.write(`INSERT INTO "${t}" (${colNames.map(c => `"${c}"`).join(',')}) VALUES\n`);
        const valLines = slice.map(row => '  (' + colNames.map(col => lit(row[col])).join(',') + ')');
        out.write(valLines.join(',\n') + ';\n');
      }
      out.write('\n');
      summary.push([t, data.rows.length]);
    } catch (e) {
      summary.push([t, 'ERR: ' + e.message]);
    }
  }

  out.write('SET session_replication_role = DEFAULT;\n');
  out.write('COMMIT;\n');
  out.write('\n-- Refresh any sequence ownership if needed\n');
  out.write("SELECT setval(pg_get_serial_sequence(quote_ident(t.tablename), c.column_name), \n");
  out.write("              (SELECT MAX(id::bigint)::bigint FROM ONLY public.tablename t2 LIMIT 0), true)\n");
  out.write("  FROM pg_tables t JOIN information_schema.columns c\n");
  out.write("    ON c.table_name = t.tablename WHERE FALSE; -- placeholder; UUID PKs don't need sequences\n");
  out.end();

  await c.end();

  // Wait for stream flush
  await new Promise(r => out.on('close', r));

  const stat = fs.statSync(OUT);
  console.log('\nExport summary:');
  summary.forEach(([t, n]) => console.log('  ' + t.padEnd(25) + ' ' + n));
  console.log('\nOutput: ' + OUT);
  console.log('Size:   ' + (stat.size / 1024 / 1024).toFixed(2) + ' MB');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
