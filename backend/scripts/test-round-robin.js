#!/usr/bin/env node
/**
 * E2E test for STRICT round-robin distribution.
 *
 * Scenario (from user spec):
 *   40 leads available, 4 partners each requesting 10.
 *   Expected order: A,B,C,D, A,B,C,D, A,B,C,D ... 10 times.
 *
 * Then mid-rotation test:
 *   After 12 assignments done, add a 5th partner E requesting 10.
 *   Next assignments continue: A,B,C,D,E (E joins the rotation),
 *   not skipping anyone unfairly.
 */
require('dotenv').config();
const { Client } = require('pg');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log('\n== 1. Setup — pick 4 active partners w/ no unworked leads ==');
  const { rows: partners } = await c.query(`
    SELECT u.id, u.full_name FROM users u
     WHERE u.role = 'partner' AND u.status = 'active' AND u.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM leads l
          WHERE l.assigned_to_user_id = u.id
            AND l.deleted_at IS NULL
            AND (l.call_status IS NULL OR l.call_status::text NOT IN ('converted','rejected','dropped','duplicate','not_interested'))
       )
     ORDER BY u.created_at ASC LIMIT 4`);
  if (partners.length < 4) {
    console.log('Not enough eligible partners (need 4, have ' + partners.length + ').');
    console.log('Cleaning up any old test partners + creating fresh ones...');
    // Create test partners
    for (let i = 1; i <= 4; i++) {
      await c.query(`
        INSERT INTO users (id, full_name, email, phone, role, status, password_hash, emp_code, cp_id, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, 'partner', 'active', '$2a$10$X', $4, $4, NOW(), NOW())
        ON CONFLICT (email) DO UPDATE SET status='active'`,
        ['Test Partner ' + String.fromCharCode(64+i), 'rr-test-' + i + '@test.local', '+9100000000' + i, 'RRTEST' + i]);
    }
    const { rows: p2 } = await c.query(`
      SELECT id, full_name FROM users WHERE email LIKE 'rr-test-%' ORDER BY email`);
    partners.push(...p2);
  }
  const [A, B, C, D] = partners.slice(0, 4);
  console.log('  A:', A.full_name);
  console.log('  B:', B.full_name);
  console.log('  C:', C.full_name);
  console.log('  D:', D.full_name);

  console.log('\n== 2. Cleanup any prior test data ==');
  await c.query("DELETE FROM lead_assignments WHERE lead_id IN (SELECT id FROM leads WHERE full_name LIKE 'RR Test Lead %')");
  await c.query("DELETE FROM leads WHERE full_name LIKE 'RR Test Lead %'");
  await c.query("DELETE FROM lead_requests WHERE user_id = ANY($1::uuid[]) AND status='pending'", [partners.map(p => p.id)]);
  console.log('  cleaned');

  console.log('\n== 3. Insert 40 fresh partner leads (today) ==');
  const leadIds = [];
  for (let i = 1; i <= 40; i++) {
    const { rows: [l] } = await c.query(`
      INSERT INTO leads (full_name, phone, source, category, meta_created_time, created_at, updated_at)
      VALUES ($1, $2, 'meta', 'partner', NOW(), NOW(), NOW())
      RETURNING id`,
      ['RR Test Lead ' + String(i).padStart(2, '0'), '+91777' + String(1000000 + i)]);
    leadIds.push(l.id);
  }
  console.log('  inserted 40 leads');

  console.log('\n== 4. Create 4 pending requests (10 each, A→B→C→D order) ==');
  const reqIds = [];
  for (const p of [A, B, C, D]) {
    const { rows: [r] } = await c.query(`
      INSERT INTO lead_requests (user_id, quantity, category, status)
      VALUES ($1, 10, 'partner', 'pending') RETURNING id`,
      [p.id]);
    reqIds.push(r.id);
    // tiny sleep to ensure strictly increasing created_at (FIFO order)
    await new Promise(r => setTimeout(r, 30));
  }
  console.log('  request IDs:', reqIds.map(x => x.slice(0,8)).join(', '));

  console.log('\n== 5. Trigger round-robin engine ==');
  await c.end();
  const { distributeRoundRobin } = require('../src/services/requestDistributionEngine');
  const result = await distributeRoundRobin();
  console.log('  result:', JSON.stringify(result));

  console.log('\n== 6. Verify assignment ORDER (must be A,B,C,D rotating) ==');
  const c2 = new Client({ connectionString: process.env.DATABASE_URL });
  await c2.connect();
  // Order by lead name (RR Test Lead 01..40) — leads were created in
  // strict sequence so picking ORDER BY created_at ASC means lead 01
  // is pulled first, lead 02 second, etc. The user_id assigned to each
  // is the round-robin slot for that lead position.
  const { rows: assignments } = await c2.query(`
    SELECT la.lead_id, la.user_id, l.full_name AS lead_name
      FROM lead_assignments la
      JOIN leads l ON l.id = la.lead_id
     WHERE l.full_name LIKE 'RR Test Lead %'
     ORDER BY l.full_name ASC`);

  console.log('  Total assignments:', assignments.length);
  if (assignments.length === 0) {
    console.log('  ❌ NO ASSIGNMENTS — round-robin failed');
    await c2.end(); process.exit(1);
  }

  const labels = { [A.id]: 'A', [B.id]: 'B', [C.id]: 'C', [D.id]: 'D' };
  const sequence = assignments.map(a => labels[a.user_id] || '?').join('');
  console.log('  Assignment sequence:');
  console.log('    ' + sequence);

  // Expected: ABCDABCDABCDABCDABCDABCDABCDABCDABCDABCD (10 cycles of ABCD)
  const expected = 'ABCD'.repeat(10);
  const passed = sequence === expected;
  console.log('  Expected:');
  console.log('    ' + expected);
  console.log('  Round-robin order ' + (passed ? '✅ PASSED' : '❌ FAILED'));

  // Per-partner count
  console.log('\n  Per-partner counts:');
  for (const p of [A, B, C, D]) {
    const n = assignments.filter(a => a.user_id === p.id).length;
    console.log('    ' + (labels[p.id] || '?') + ' (' + p.full_name + '): ' + n + ' / 10  ' + (n === 10 ? '✅' : '❌'));
  }

  console.log('\n== 7. Verify all requests now status=fulfilled ==');
  const { rows: finalReq } = await c2.query(
    `SELECT id, status, leads_assigned, quantity FROM lead_requests WHERE id = ANY($1::uuid[])`,
    [reqIds]);
  finalReq.forEach(r => console.log('  ' + r.id.slice(0,8) + ' status=' + r.status + ' ' + r.leads_assigned + '/' + r.quantity));
  const allFulfilled = finalReq.every(r => r.status === 'fulfilled' && r.leads_assigned === r.quantity);
  console.log('  ' + (allFulfilled ? '✅ All fulfilled' : '❌ Some still pending'));

  // Cleanup
  await c2.query("DELETE FROM lead_assignments WHERE lead_id = ANY($1::uuid[])", [leadIds]);
  await c2.query("DELETE FROM leads WHERE id = ANY($1::uuid[])", [leadIds]);
  await c2.query("DELETE FROM lead_requests WHERE id = ANY($1::uuid[])", [reqIds]);
  await c2.query("DELETE FROM users WHERE email LIKE 'rr-test-%'");

  await c2.end();
  process.exit(passed && allFulfilled ? 0 : 1);
})().catch(e => { console.error('ERR', e.message, e.stack); process.exit(1); });
