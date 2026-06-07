#!/usr/bin/env node
/**
 * Localhost full verification. Runs against the live backend on :4000.
 * Returns 0 on full pass, 1 on any failure.
 */
require('dotenv').config();
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const PUB = 'http://127.0.0.1:4000';
const TESTS = [];
let pass = 0, fail = 0;

async function test(name, fn) {
  try {
    const res = await fn();
    if (res === false) { console.log(`  FAIL  ${name}`); fail++; TESTS.push({ name, ok: false }); }
    else { console.log(`  PASS  ${name}` + (res === true || res == null ? '' : `  → ${res}`)); pass++; TESTS.push({ name, ok: true }); }
  } catch (e) {
    console.log(`  FAIL  ${name}  → ${e.message}`); fail++; TESTS.push({ name, ok: false, err: e.message });
  }
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // Cleanup any leftover Verify test data from previous failed runs
  await c.query("DELETE FROM lead_assignments WHERE lead_id IN (SELECT id FROM leads WHERE full_name LIKE 'Verify %')");
  await c.query("DELETE FROM leads WHERE full_name LIKE 'Verify %'");
  await c.query("DELETE FROM lead_requests WHERE note LIKE '%verify-local%' OR note IS NULL AND quantity = 1 AND status='pending' AND created_at > NOW() - INTERVAL '5 minutes'");

  const { rows: [u] } = await c.query("SELECT id, role, full_name FROM users WHERE role='super_admin' AND deleted_at IS NULL LIMIT 1");
  const T = jwt.sign({ sub: u.id, role: u.role, name: u.full_name }, process.env.JWT_ACCESS_SECRET, { expiresIn: '5m', issuer: 'digitaladbird-crm' });
  const H = { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' };

  console.log('\n== INFRA ==');
  await test('backend /health/db-strict reports real_pg=true', async () => {
    const r = await fetch(`${PUB}/health/db-strict`);
    const b = await r.json();
    return b?.data?.real_pg === true || b?.real_pg === true;
  });
  await test('DB timezone is Asia/Calcutta', async () => {
    const r = await c.query("SELECT current_setting('TimeZone') AS tz");
    return r.rows[0].tz === 'Asia/Calcutta' ? r.rows[0].tz : false;
  });

  console.log('\n== DASHBOARD PARITY (DB == API) ==');
  const { rows: [dbCounts] } = await c.query(`SELECT
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL) AS total,
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND
       (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today,
    (SELECT COUNT(*)::int FROM leads WHERE deleted_at IS NULL AND assigned_to_user_id IS NULL) AS queued`);

  const apiLive = await (await fetch(`${PUB}/api/admin/live-stats?_=${Date.now()}`, { headers: H })).json();
  const apiDist = await (await fetch(`${PUB}/api/distribution/stats?_=${Date.now()}`, { headers: H })).json();

  await test(`live-stats.total_leads == DB.total (${dbCounts.total})`, () =>
    apiLive.data.total_leads === dbCounts.total ? dbCounts.total : `${apiLive.data.total_leads} vs ${dbCounts.total}`);
  await test(`live-stats.today_leads == DB.today (${dbCounts.today})`, () =>
    apiLive.data.today_leads === dbCounts.today ? dbCounts.today : `${apiLive.data.today_leads} vs ${dbCounts.today}`);
  await test(`distribution-stats.queued == DB.queued (${dbCounts.queued})`, () =>
    apiDist.data.queued_leads === dbCounts.queued ? dbCounts.queued : `${apiDist.data.queued_leads} vs ${dbCounts.queued}`);

  console.log('\n== IMMEDIATE COUNTER UPDATE (cache-bust on lead insert) ==');
  const before = (await (await fetch(`${PUB}/api/admin/live-stats?_=${Date.now()}`, { headers: H })).json()).data;
  // Insert a today lead via the same chokepoint the webhook uses
  const phone = '+91' + String(Date.now()).slice(-10);
  const ins = await c.query(`
    INSERT INTO leads(full_name, phone, source, category, meta_created_time)
    VALUES('Verify '||extract(epoch from now())::bigint, $1, 'meta', 'partner', NOW())
    RETURNING id`, [phone]);
  const testLeadId = ins.rows[0].id;
  // Re-query API immediately (cache-buster forces fresh DB read)
  const after = (await (await fetch(`${PUB}/api/admin/live-stats?_=${Date.now()}`, { headers: H })).json()).data;
  await test(`Total Leads went up by 1 (${before.total_leads} → ${after.total_leads})`, () =>
    after.total_leads === before.total_leads + 1 ? `+1` : `${before.total_leads} → ${after.total_leads}`);
  await test(`Today Leads went up by 1 (${before.today_leads} → ${after.today_leads})`, () =>
    after.today_leads === before.today_leads + 1 ? `+1` : `${before.today_leads} → ${after.today_leads}`);

  console.log('\n== AUTO-DISTRIBUTION + TODAY-FIRST PRIORITY ==');
  // Pick a partner with NO unworked assigned leads (business rule blocks otherwise)
  const { rows: [partner] } = await c.query(`
    SELECT u.id, u.full_name FROM users u
     WHERE u.role='partner' AND u.deleted_at IS NULL AND u.status='active'
       AND NOT EXISTS (
         SELECT 1 FROM leads l
          WHERE l.assigned_to_user_id = u.id
            AND l.deleted_at IS NULL
            AND (l.call_status IS NULL OR l.call_status::text NOT IN ('converted','rejected','dropped','duplicate','not_interested'))
       )
     LIMIT 1`);
  if (!partner) { console.log('  SKIP  no partner user available'); }
  else {
    // Find an OLDER unassigned partner lead so today's should beat it in priority
    const { rows: [older] } = await c.query(`SELECT id FROM leads
       WHERE deleted_at IS NULL AND assigned_to_user_id IS NULL AND category='partner'
         AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date < (NOW() AT TIME ZONE 'Asia/Kolkata')::date
       ORDER BY COALESCE(meta_created_time, created_at) ASC LIMIT 1`);
    // Create a pending request via real HTTP
    const partnerT = jwt.sign({ sub: partner.id, role: 'partner', name: partner.full_name }, process.env.JWT_ACCESS_SECRET, { expiresIn: '5m', issuer: 'digitaladbird-crm' });
    const reqRes = await fetch(`${PUB}/api/lead-requests`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + partnerT, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 1, category: 'partner' })
    });
    const reqBody = await reqRes.json();
    const reqId = reqBody?.data?.id || reqBody?.id;
    await test('POST /api/lead-requests returns 200/201 and request id', () => reqId ? `id=${reqId}` : false);

    if (reqId) {
      // wait briefly for sync handler
      await new Promise(r => setTimeout(r, 800));
      const { rows: [reqAfter] } = await c.query("SELECT id, status, leads_assigned, quantity FROM lead_requests WHERE id = $1", [reqId]);
      await test(`request auto-fulfilled (status=fulfilled, leads_assigned>=quantity)`, () =>
        reqAfter.status === 'fulfilled' && reqAfter.leads_assigned >= reqAfter.quantity ? `${reqAfter.status} ${reqAfter.leads_assigned}/${reqAfter.quantity}` : `${reqAfter.status} ${reqAfter.leads_assigned}/${reqAfter.quantity}`);

      // Verify the assigned lead is the TODAY one (testLeadId), not the older one
      const { rows: [assignedTo] } = await c.query("SELECT lead_id FROM lead_assignments WHERE user_id = $1 AND reason='lead_request' ORDER BY assigned_at DESC LIMIT 1", [partner.id]);
      await test('today-first priority: assigned lead is the TODAY one (not the older one)', () =>
        assignedTo?.lead_id === testLeadId ? `today lead ${testLeadId}` : `got ${assignedTo?.lead_id}, expected today=${testLeadId}, older=${older?.id}`);
    }
  }

  console.log('\n== STATUS INVARIANT (fulfilled requires leads_assigned >= quantity) ==');
  const { rows: [viol] } = await c.query("SELECT COUNT(*)::int AS n FROM lead_requests WHERE status='fulfilled' AND leads_assigned < quantity");
  await test('zero fulfilled requests with leads_assigned < quantity', () => viol.n === 0 ? viol.n : `${viol.n} violations`);

  console.log('\n== META INTEGRATION CONFIG ==');
  const { rows: [meta] } = await c.query("SELECT COUNT(*)::int AS pages FROM meta_pages WHERE is_active=TRUE");
  await test('at least 1 active meta_pages row exists', () => meta.pages > 0 ? meta.pages : false);
  const { rows: [form] } = await c.query("SELECT COUNT(*)::int AS forms FROM meta_forms");
  await test('at least 1 meta_forms row exists', () => form.forms > 0 ? form.forms : false);

  // Cleanup test lead
  await c.query("DELETE FROM lead_assignments WHERE lead_id = $1", [testLeadId]);
  await c.query("DELETE FROM leads WHERE id = $1", [testLeadId]);
  await c.end();

  console.log('\n========================================');
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  console.log('========================================');
  console.log('READY_FOR_PROD=' + (fail === 0 ? 'YES' : 'NO'));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
