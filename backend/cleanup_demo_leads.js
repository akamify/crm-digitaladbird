/**
 * CLEANUP — removes all demo data inserted by seed_demo_leads.js
 *
 * Safe: only deletes rows tagged with category='demo_seed' or metadata.demo=true.
 * Does NOT touch any real/production data.
 *
 * Run:  node cleanup_demo_leads.js
 */

const { query } = require('./src/config/database');

const DEMO_TAG = 'demo_seed';

(async () => {
  console.log('=== DEMO CLEANUP START ===\n');

  // 1. Delete remarks on demo leads
  const r1 = await query(`
    DELETE FROM lead_remarks WHERE lead_id IN (SELECT id FROM leads WHERE product_tag = $1)
  `, [DEMO_TAG]);
  console.log(`[1] Deleted ${r1.rowCount} lead remarks`);

  // 2. Delete assignments on demo leads
  const r2 = await query(`
    DELETE FROM lead_assignments WHERE lead_id IN (SELECT id FROM leads WHERE product_tag = $1)
  `, [DEMO_TAG]);
  console.log(`[2] Deleted ${r2.rowCount} lead assignments`);

  // 3. Delete demo leads
  const r3 = await query(`DELETE FROM leads WHERE product_tag = $1`, [DEMO_TAG]);
  console.log(`[3] Deleted ${r3.rowCount} demo leads`);

  // 4. Delete timeline entries for demo partner requests
  const r4 = await query(`
    DELETE FROM partner_request_timeline WHERE request_id IN (SELECT id FROM partner_lead_requests WHERE category = $1)
  `, [DEMO_TAG]);
  console.log(`[4] Deleted ${r4.rowCount} partner request timeline entries`);

  // 5. Delete demo partner requests
  const r5 = await query(`DELETE FROM partner_lead_requests WHERE category = $1`, [DEMO_TAG]);
  console.log(`[5] Deleted ${r5.rowCount} demo partner requests`);

  // 6. Delete demo notifications
  const r6 = await query(`DELETE FROM user_notifications WHERE metadata->>'demo' = 'true'`);
  console.log(`[6] Deleted ${r6.rowCount} demo notifications`);

  console.log('\n=== DEMO CLEANUP COMPLETE — all demo data removed safely ===\n');
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
