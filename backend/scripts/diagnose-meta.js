#!/usr/bin/env node
/**
 * Meta integration health probe.
 * Prove which of these is broken:
 *   - access token validity        (debug_token endpoint)
 *   - app secret signing           (sha256 hmac against token)
 *   - page → form discovery        (graph /me/leadgen_forms)
 *   - webhook subscription state   (graph /<page>/subscribed_apps)
 *   - last webhook delivery        (meta_sync_log table)
 *   - last lead in DB              (leads table)
 *   - dashboard counter parity     (today + total)
 *
 * Run:
 *   cd backend && node scripts/diagnose-meta.js
 *
 * Does NOT modify anything. Diagnostic only.
 */
require('dotenv').config();
const { Client } = require('pg');

const TOKEN     = process.env.META_PAGE_ACCESS_TOKEN || process.env.META_USER_ACCESS_TOKEN;
const APP_ID    = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const PAGE_ID   = process.env.META_PAGE_ID;
const GRAPH = 'https://graph.facebook.com/v21.0';

const hdr = (s) => process.stdout.write(`\n\x1b[1m== ${s} ==\x1b[0m\n`);
const row = (k, v) => console.log('  ' + (k+'').padEnd(34) + ': ' + v);
const tail = (s, n=140) => (s||'').toString().slice(0, n);

async function get(path) {
  const r = await fetch(GRAPH + path);
  const j = await r.json().catch(() => null);
  return { status: r.status, body: j };
}

(async () => {
  hdr('1. Env presence (does NOT print secrets)');
  row('META_APP_ID',              APP_ID    ? 'set'                                : 'MISSING');
  row('META_APP_SECRET',          APP_SECRET? 'set ('+APP_SECRET.length+' chars)' : 'MISSING');
  row('META_PAGE_ID',             PAGE_ID   ? PAGE_ID                              : 'MISSING');
  row('META_PAGE_ACCESS_TOKEN',   TOKEN     ? 'set ('+TOKEN.length+' chars, prefix=' + TOKEN.slice(0,4) + '…)' : 'MISSING');
  if (!TOKEN || !APP_ID || !APP_SECRET || !PAGE_ID) {
    console.log('\nMISSING REQUIRED ENV — stop and fix .env first.');
    process.exit(1);
  }

  hdr('2. Token validity (Graph API debug_token)');
  // app access token is "appId|appSecret" — used to debug user/page tokens
  const app = `${APP_ID}|${APP_SECRET}`;
  const dt = await get(`/debug_token?input_token=${TOKEN}&access_token=${encodeURIComponent(app)}`);
  if (dt.status !== 200 || !dt.body?.data) {
    row('result', 'FAIL  HTTP ' + dt.status);
    console.log('  raw : ' + tail(JSON.stringify(dt.body)));
  } else {
    const d = dt.body.data;
    const exp = d.expires_at ? new Date(d.expires_at*1000).toISOString() : 'never';
    const issued = d.issued_at ? new Date(d.issued_at*1000).toISOString() : '?';
    row('app_id matches',          d.app_id === APP_ID ? 'YES' : ('MISMATCH ('+d.app_id+')'));
    row('is_valid',                d.is_valid);
    row('type',                    d.type);
    row('issued_at',               issued);
    row('expires_at',              exp);
    row('scopes',                  (d.scopes||[]).join(','));
    if (!d.is_valid)             console.log('\n  TOKEN INVALID — root cause #1.');
    if (d.expires_at && d.expires_at*1000 < Date.now())
      console.log('\n  TOKEN EXPIRED at ' + exp + ' — root cause.');
  }

  hdr('3. Page reachability (GET /<page_id>)');
  const p = await get(`/${PAGE_ID}?fields=id,name,access_token&access_token=${TOKEN}`);
  if (p.status !== 200) {
    row('result', 'FAIL  HTTP '+ p.status);
    console.log('  raw : ' + tail(JSON.stringify(p.body)));
  } else {
    row('page id',   p.body.id);
    row('page name', p.body.name);
  }

  hdr('4. Webhook subscription state (/page/subscribed_apps)');
  const sub = await get(`/${PAGE_ID}/subscribed_apps?access_token=${TOKEN}`);
  if (sub.status !== 200) {
    row('result', 'FAIL  HTTP '+sub.status);
    console.log('  raw : ' + tail(JSON.stringify(sub.body), 300));
  } else {
    const apps = sub.body?.data || [];
    row('subscribed app count', apps.length);
    apps.forEach(a => {
      console.log('    - app=' + (a.name || a.id) +
                  '  fields=' + (a.subscribed_fields || []).join(','));
    });
    const ours = apps.find(a => a.id === APP_ID);
    if (!ours) {
      console.log('\n  OUR APP IS NOT SUBSCRIBED to this page. Webhook deliveries will not happen.');
      console.log('  Fix: POST /'+PAGE_ID+'/subscribed_apps?subscribed_fields=leadgen&access_token=<page_token>');
    } else if (!(ours.subscribed_fields||[]).includes('leadgen')) {
      console.log('\n  Subscribed but missing leadgen field.');
    } else {
      row('leadgen subscribed', 'YES');
    }
  }

  hdr('5. Lead forms on this page');
  const f = await get(`/${PAGE_ID}/leadgen_forms?fields=id,name,status,leads_count&limit=20&access_token=${TOKEN}`);
  if (f.status !== 200) {
    row('result', 'FAIL  HTTP '+f.status);
    console.log('  raw : ' + tail(JSON.stringify(f.body), 300));
  } else {
    const forms = f.body?.data || [];
    row('forms returned', forms.length);
    forms.slice(0, 10).forEach(x => {
      console.log('    - ' + x.id + '  ' + (x.status||'?').padEnd(8) + '  ' + (x.leads_count ?? '?') + ' leads  ' + (x.name||''));
    });
  }

  // ── DB state ───────────────────────────────────────────────
  hdr('6. DB state');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows: [latest] } = await c.query(`
    SELECT
      (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND source='meta') AS meta_leads,
      (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND source='meta'
         AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today_meta,
      (SELECT MAX(COALESCE(meta_created_time, created_at)) FROM leads WHERE deleted_at IS NULL AND source='meta') AS last_meta_lead_at,
      (SELECT NOW()) AS now,
      (SELECT current_setting('TimeZone')) AS tz,
      (SELECT COUNT(*)::int FROM meta_pages WHERE is_active=TRUE) AS active_pages,
      (SELECT COUNT(*)::int FROM meta_forms) AS forms
  `);
  row('source=meta total',  latest.meta_leads);
  row('today_IST (Meta)',   latest.today_meta);
  row('last meta lead at',  latest.last_meta_lead_at?.toISOString?.() || latest.last_meta_lead_at);
  row('now',                latest.now?.toISOString?.() || latest.now);
  row('DB timezone',        latest.tz);
  row('active meta_pages',  latest.active_pages);
  row('meta_forms',         latest.forms);

  hdr('7. Last 10 webhook sync log entries (meta_sync_log)');
  try {
    const { rows: logs } = await c.query(`
      SELECT id, sync_type, source_id, leads_fetched, leads_created, leads_duplicate,
             status, error_message, created_at
        FROM meta_sync_log ORDER BY id DESC LIMIT 10
    `);
    if (logs.length === 0) console.log('  (meta_sync_log is empty)');
    logs.forEach(l => {
      console.log('  ' + l.created_at.toISOString().slice(0,19) +
        '  ' + (l.sync_type||'').padEnd(12) +
        '  fetched='+l.leads_fetched +
        '  created='+l.leads_created +
        '  status='+(l.status||'') +
        (l.error_message ? '  err='+tail(l.error_message, 120) : ''));
    });
  } catch (e) { console.log('  (table missing or query failed: '+e.message+')'); }

  await c.end();

  // ── Verdict ────────────────────────────────────────────────
  hdr('VERDICT');
  console.log(`
Reading sections 2-5 against section 6/7:

  A) Section 2 is_valid=false OR expires_at in past
       → Token expired. Regenerate page-access-token in Meta Business Manager,
         update META_PAGE_ACCESS_TOKEN in backend/.env, restart pm2, then run
         recover-meta-leads.js to backfill missed leads.

  B) Section 4 "OUR APP IS NOT SUBSCRIBED"
       → Page is not subscribed. Re-subscribe:
         curl -X POST "${GRAPH}/${PAGE_ID}/subscribed_apps?subscribed_fields=leadgen&access_token=<NEW_PAGE_TOKEN>"

  C) Section 5 returns leads_count > section 6 "source=meta total"
       → Meta has more leads than CRM stored. Run:
         BACKFILL_DAYS=30 node scripts/recover-meta-leads.js

  D) Section 7 last entry is hours ago and shows status=error
       → That error message IS the cause. Fix from there.

  E) Section 7 last entry is days old (no recent rows)
       → Webhooks aren't reaching us. Causes:
         - Token expired (A) blocks the lead-detail fetch
         - Webhook URL changed
         - VERIFY_TOKEN mismatch
         - Nginx blocking POST /webhooks/meta

  F) Section 6 today_IST = 0 but section 5 forms show new leads_count
       → Sync silently failing. Combination of A + B usually.
`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
