#!/usr/bin/env node
/**
 * ONE-SHOT: Validate new Meta System User token → update DB → recover 4-day leads
 *
 * Token is read from $env:META_TOKEN_NEW (NEVER paste in chat).
 *
 * Usage on PowerShell:
 *   cd C:/Users/vinit/crm/backend
 *   $env:META_TOKEN_NEW = 'PASTE_TOKEN_DIRECTLY_HERE_IN_POWERSHELL'
 *   $env:BACKFILL_HOURS = '120'   # optional, default 120 = 5 days
 *   node scripts/fix-token-and-recover.js
 *   Remove-Item Env:META_TOKEN_NEW   # clear after use
 *
 * What it does (atomically — stops on first failure):
 *   1. Verify token with Meta /debug_token (is_valid + expires_at + app_id match)
 *   2. Verify each active page accepts the token (GET /<page_id>)
 *   3. UPDATE meta_pages.page_access_token for all active pages
 *   4. UPDATE backend/.env META_PAGE_ACCESS_TOKEN
 *   5. Run recover-meta-leads.js for last 120 hours (configurable)
 *   6. Print before/after lead counts
 */
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TOKEN  = process.env.META_TOKEN_NEW;
const HOURS  = Number(process.env.BACKFILL_HOURS || '120');
const APP_ID = process.env.META_APP_ID;
const APP_SEC = process.env.META_APP_SECRET;

const hdr = (s) => process.stdout.write(`\n\x1b[1m== ${s} ==\x1b[0m\n`);
const ok  = (s) => console.log('  \x1b[32m✓\x1b[0m ' + s);
const err = (s) => console.log('  \x1b[31m✗\x1b[0m ' + s);
const row = (k,v) => console.log('  ' + (k+'').padEnd(28) + ': ' + v);

(async () => {
  // Validation
  if (!TOKEN || TOKEN.length < 100) {
    console.error('\n✗ META_TOKEN_NEW env variable missing or too short.');
    console.error('  Set it in PowerShell first:');
    console.error('    $env:META_TOKEN_NEW = "your-token-here"');
    console.error('  Then run this script again.\n');
    process.exit(1);
  }
  if (!APP_ID || !APP_SEC) {
    console.error('\n✗ META_APP_ID or META_APP_SECRET missing from backend/.env\n');
    process.exit(1);
  }

  hdr('1. Verify token with Meta debug_token endpoint');
  const dbg = await fetch(`https://graph.facebook.com/v21.0/debug_token?input_token=${TOKEN}&access_token=${APP_ID}|${APP_SEC}`);
  const dbgJ = await dbg.json();
  if (!dbgJ.data) {
    err('debug_token failed: ' + JSON.stringify(dbgJ.error || dbgJ).slice(0, 300));
    process.exit(1);
  }
  const d = dbgJ.data;
  row('app_id',     d.app_id + (d.app_id === APP_ID ? ' (✓ matches META_APP_ID)' : ' (✗ MISMATCH)'));
  row('type',       d.type);
  row('is_valid',   d.is_valid);
  row('expires_at', d.expires_at ? new Date(d.expires_at * 1000).toISOString() : 'NEVER ✓');
  row('scopes',     (d.scopes || []).join(', '));

  if (!d.is_valid) {
    err('Token is INVALID per Meta. Stopping.');
    process.exit(1);
  }
  if (d.app_id !== APP_ID) {
    err('Token belongs to a DIFFERENT app than META_APP_ID. Stopping.');
    process.exit(1);
  }
  if (d.expires_at && d.expires_at * 1000 < Date.now() + 24 * 3600 * 1000) {
    err('Token expires within 24 hours. Use a NEVER-EXPIRE System User token.');
    process.exit(1);
  }
  if (d.expires_at) {
    console.log('  \x1b[33m⚠\x1b[0m Token expires on ' + new Date(d.expires_at * 1000).toISOString() + '. Recommend NEVER-EXPIRE token.');
  }
  ok('Token validated with Meta');

  hdr('2. Verify token works against each active page');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const pagesRes = await c.query("SELECT page_id, page_name FROM meta_pages WHERE is_active = TRUE");
  if (pagesRes.rows.length === 0) {
    err('No active meta_pages rows. Cannot proceed.');
    await c.end(); process.exit(1);
  }

  for (const p of pagesRes.rows) {
    const r = await fetch(`https://graph.facebook.com/v21.0/${p.page_id}?fields=id,name&access_token=${TOKEN}`);
    const j = await r.json();
    if (r.status === 200) {
      ok(`Page ${p.page_id} (${p.page_name}) — token works, Meta name="${j.name}"`);
    } else {
      err(`Page ${p.page_id} (${p.page_name}) — ${j.error?.message?.slice(0, 100)}`);
      console.log('     Token may not have access to this page. Check System User → Add Assets.');
    }
  }

  hdr('3. Lead counts BEFORE recovery (snapshot)');
  const before = await c.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE COALESCE(meta_created_time, created_at) > NOW() - INTERVAL '7 days')::int AS last_7days
      FROM leads WHERE source='meta' AND deleted_at IS NULL`);
  row('Total Meta leads',  before.rows[0].total);
  row('Last 7 days',       before.rows[0].last_7days);

  hdr('4. Update meta_pages.page_access_token for all active pages');
  const upd = await c.query(`
    UPDATE meta_pages SET page_access_token = $1, updated_at = NOW()
     WHERE is_active = TRUE
     RETURNING page_id, page_name`, [TOKEN]);
  upd.rows.forEach(r => ok(`Updated ${r.page_id} (${r.page_name})`));

  hdr('5. Update backend/.env META_PAGE_ACCESS_TOKEN');
  const envPath = path.join(__dirname, '..', '.env');
  let envText = fs.readFileSync(envPath, 'utf8');
  if (/^META_PAGE_ACCESS_TOKEN=/m.test(envText)) {
    envText = envText.replace(/^META_PAGE_ACCESS_TOKEN=.*$/m, `META_PAGE_ACCESS_TOKEN=${TOKEN}`);
  } else {
    envText += `\nMETA_PAGE_ACCESS_TOKEN=${TOKEN}\n`;
  }
  fs.writeFileSync(envPath, envText);
  ok('backend/.env updated');

  await c.end();

  hdr(`6. Run recover-meta-leads.js (HOURS_BACK=${HOURS})`);
  console.log('  Spawning child process...\n');

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'recover-meta-leads.js')], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, HOURS_BACK: String(HOURS) },
      stdio: 'inherit',
    });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error('recover script exit ' + code)));
    child.on('error', reject);
  }).catch(e => { console.error('\n  recover-meta-leads.js failed:', e.message); });

  hdr('7. Lead counts AFTER recovery');
  const c2 = new Client({ connectionString: process.env.DATABASE_URL });
  await c2.connect();
  const after = await c2.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE COALESCE(meta_created_time, created_at) > NOW() - INTERVAL '7 days')::int AS last_7days
      FROM leads WHERE source='meta' AND deleted_at IS NULL`);
  row('Total Meta leads',  after.rows[0].total + '  (was ' + before.rows[0].total + ', +' + (after.rows[0].total - before.rows[0].total) + ')');
  row('Last 7 days',       after.rows[0].last_7days + '  (was ' + before.rows[0].last_7days + ', +' + (after.rows[0].last_7days - before.rows[0].last_7days) + ')');

  const perDay = await c2.query(`
    SELECT (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date AS day, COUNT(*)::int AS n
      FROM leads WHERE source='meta' AND deleted_at IS NULL
        AND COALESCE(meta_created_time, created_at) > NOW() - INTERVAL '7 days'
     GROUP BY day ORDER BY day DESC`);
  console.log('\n  Per-day breakdown (last 7 days IST):');
  perDay.rows.forEach(r => console.log('    ' + r.day.toISOString().slice(0,10) + '  ' + String(r.n).padStart(4) + ' leads'));

  await c2.end();
  console.log('\n\x1b[32m✓ COMPLETE.\x1b[0m Open http://localhost:3000/dashboard to verify.\n');
  console.log('  IMPORTANT: clear token from your shell session now:');
  console.log('    PowerShell:  Remove-Item Env:META_TOKEN_NEW\n');
})().catch(e => { console.error('\nFATAL:', e.message); process.exit(1); });
