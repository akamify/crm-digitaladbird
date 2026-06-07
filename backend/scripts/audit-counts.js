#!/usr/bin/env node
/**
 * Print actual lead counts from every layer. Run on EACH environment
 * (local + prod), then compare side-by-side. Any line that differs
 * identifies the gap.
 *
 * Usage:
 *   cd backend && node scripts/audit-counts.js
 *
 * Prints:
 *   ENV     hostname + commit + DB URL (password redacted)
 *   DB      direct COUNT(*) per dimension + per-campaign + per-form
 *   API     same numbers from the dashboard endpoints via an admin JWT
 *
 * No psql required — uses the same node + pg client the backend uses.
 */
require('dotenv').config();
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const { execSync } = require('child_process');

const PUB = process.env.PUBLIC_URL || 'http://127.0.0.1:4000';

function hdr(s) { process.stdout.write('\n\x1b[1m== ' + s + ' ==\x1b[0m\n'); }
function row(label, value) {
  console.log('  ' + (label + '').padEnd(28) + ': ' + value);
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  hdr('ENV');
  let commit = '?';
  try { commit = execSync('git log -1 --oneline', { encoding: 'utf8' }).trim(); } catch {}
  row('host',     require('os').hostname());
  row('commit',   commit);
  row('DB URL',   (process.env.DATABASE_URL || '').replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@'));

  hdr('[DB] Direct COUNT(*) per dimension');
  const r = await c.query(`SELECT
    current_database() AS db_name,
    current_setting('TimeZone') AS tz,
    now()::text AS now_db,
    (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text AS today_ist,
    (SELECT COUNT(*)::int FROM users WHERE deleted_at IS NULL) AS users_active,
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL) AS leads_active,
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND source='meta') AS meta_leads,
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND source='import') AS import_leads,
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND source='manual') AS manual_leads,
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND assigned_to_user_id IS NULL) AS unassigned,
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND assigned_to_user_id IS NOT NULL) AS assigned,
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND is_pending=TRUE) AS is_pending,
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND call_status='converted') AS converted,
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND category='partner') AS partner_cat,
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND category='trader') AS trader_cat,
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL
       AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_ist_count,
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL
       AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date - 1) AS yesterday_ist,
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL
       AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date - 2) AS day_before_yesterday,
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL
       AND COALESCE(meta_created_time, created_at) > NOW() - INTERVAL '7 days') AS last_7_days,
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL
       AND COALESCE(meta_created_time, created_at) > NOW() - INTERVAL '30 days') AS last_30_days,
    (SELECT COUNT(*)::int FROM meta_pages WHERE is_active=TRUE) AS meta_pages_active,
    (SELECT COUNT(*)::int FROM meta_forms) AS meta_forms,
    (SELECT COUNT(*)::int FROM integration_configs) AS integration_configs,
    (SELECT COUNT(*)::int FROM lead_requests WHERE status='pending') AS lr_pending,
    (SELECT COUNT(*)::int FROM lead_requests WHERE status='fulfilled') AS lr_fulfilled,
    (SELECT COUNT(*)::int FROM lead_requests WHERE status='fulfilled' AND leads_assigned < quantity) AS lr_violations
  `);
  const d = r.rows[0];
  row('db_name',                d.db_name);
  row('session timezone',       d.tz);
  row('now() in DB tz',         d.now_db);
  row('today (IST)',            d.today_ist);
  console.log('  ---');
  row('users (active)',         d.users_active);
  row('leads (active)',         d.leads_active);
  row('leads source=meta',      d.meta_leads);
  row('leads source=import',    d.import_leads);
  row('leads source=manual',    d.manual_leads);
  console.log('  ---');
  row('today_IST',              d.today_ist_count);
  row('yesterday_IST',          d.yesterday_ist);
  row('day_before_yesterday',   d.day_before_yesterday);
  row('last_7_days',            d.last_7_days);
  row('last_30_days',           d.last_30_days);
  console.log('  ---');
  row('unassigned in queue',    d.unassigned);
  row('assigned',               d.assigned);
  row('is_pending=TRUE',        d.is_pending);
  row('call_status=converted',  d.converted);
  console.log('  ---');
  row('category=partner',       d.partner_cat);
  row('category=trader',        d.trader_cat);
  console.log('  ---');
  row('meta_pages active',      d.meta_pages_active);
  row('meta_forms',             d.meta_forms);
  row('integration_configs',    d.integration_configs);
  row('lead_requests pending',  d.lr_pending);
  row('lead_requests fulfilled',d.lr_fulfilled);
  row('CRITICAL: violations',   d.lr_violations);

  hdr('[DB] Per-campaign (top 10 by total)');
  const camp = await c.query(`
    SELECT
      COALESCE(campaign_name, '(no campaign)') AS campaign,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date)::int AS today,
      COUNT(*) FILTER (WHERE assigned_to_user_id IS NULL)::int AS unassigned
    FROM leads WHERE deleted_at IS NULL AND source='meta'
    GROUP BY 1 ORDER BY total DESC LIMIT 10
  `);
  console.log('  ' + 'campaign'.padEnd(42) + 'total  today  unassigned');
  camp.rows.forEach(r => {
    console.log('  ' + (r.campaign || '').slice(0, 40).padEnd(42)
      + String(r.total).padStart(5) + '  '
      + String(r.today).padStart(5) + '  '
      + String(r.unassigned).padStart(10));
  });

  hdr('[DB] Per-form (top 10)');
  const form = await c.query(`
    SELECT
      COALESCE(meta_form_id, '(no form_id)') AS form_id,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date)::int AS today
    FROM leads WHERE deleted_at IS NULL AND source='meta'
    GROUP BY 1 ORDER BY total DESC LIMIT 10
  `);
  console.log('  ' + 'form_id'.padEnd(28) + 'total  today');
  form.rows.forEach(r => {
    console.log('  ' + (r.form_id || '').padEnd(28)
      + String(r.total).padStart(5) + '  '
      + String(r.today).padStart(5));
  });

  // -- mint admin JWT against the SAME DB the backend uses --
  const { rows: [u] } = await c.query(
    "SELECT id, role, full_name FROM users WHERE role='super_admin' AND deleted_at IS NULL LIMIT 1"
  );
  await c.end();
  if (!u) { console.log('\nNo super_admin user found — skipping API probe'); return; }

  hdr('[API] Same numbers via dashboard endpoints');
  console.log('  admin user = ' + u.full_name);
  const T = jwt.sign(
    { sub: u.id, role: u.role, name: u.full_name },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '5m', issuer: 'digitaladbird-crm' }
  );

  const endpoints = [
    '/api/admin/live-stats',
    '/api/reports/summary',
    '/api/admin/leads/fresh?scope=today',
    '/api/distribution/stats',
  ];
  // Each gets a cache-buster so we see fresh numbers (not 10-15s old cached)
  for (const ep of endpoints) {
    const sep = ep.includes('?') ? '&' : '?';
    const url = PUB + ep + sep + '_=' + Date.now();
    try {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + T } });
      const b = await r.json().catch(() => null);
      const data = b?.data || {};
      console.log('\n  GET ' + ep);
      console.log('    HTTP ' + r.status + '  X-Cache=' + (r.headers.get('X-Cache') || 'n/a'));
      // Print every numeric field at the top level
      const interesting = ['total_leads','today_leads','today_assigned','today_conversions','queued_leads','today_received','today_distributed','total','pending_lead_requests'];
      for (const k of interesting) {
        if (data[k] !== undefined) console.log('    ' + k.padEnd(28) + ' = ' + data[k]);
      }
      if (data.counts) {
        for (const [k, v] of Object.entries(data.counts)) {
          console.log('    counts.' + k.padEnd(20) + ' = ' + v);
        }
      }
    } catch (e) {
      console.log('  ' + ep + ' → ERR: ' + e.message);
    }
  }

  hdr('DONE');
  console.log('Paste this entire output for comparison.');
  console.log('Run the same script on the OTHER environment.');
  console.log('Any line that differs identifies the gap.');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
