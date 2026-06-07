#!/usr/bin/env node
/**
 * Diagnose why partner lead-requests are stuck in pending status.
 *
 * For each pending request, prints:
 *   - Partner name, role, status, RM
 *   - Request age, quantity, category
 *   - How many eligible leads exist in queue right now
 *   - Whether distribution window is currently active
 *   - Exact reason it hasn't been fulfilled
 *
 * Run:
 *   cd backend && node scripts/diagnose-pending-requests.js
 */
require('dotenv').config();
const { Client } = require('pg');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const hdr = (s) => process.stdout.write(`\n\x1b[1m== ${s} ==\x1b[0m\n`);
  const row = (k, v) => console.log('  ' + (k+'').padEnd(28) + ': ' + v);

  hdr('1. Distribution settings');
  const ds = await c.query("SELECT key, value FROM distribution_settings");
  const s = {}; ds.rows.forEach(r => s[r.key] = r.value);
  row('auto_distribution_enabled', s.auto_distribution_enabled || '(not set)');
  row('active window (IST)',        (s.distribution_start_hour || '8') + ':00 - ' + (s.distribution_end_hour || '19') + ':00');
  row('timezone',                   s.distribution_timezone || 'Asia/Kolkata');

  const now = new Date();
  const ist = new Date(now.getTime() + 5.5*3600*1000);
  const istHour = ist.getUTCHours();
  const startHour = parseInt(s.distribution_start_hour || '8', 10);
  const endHour   = parseInt(s.distribution_end_hour   || '19', 10);
  const inWindow  = istHour >= startHour && istHour < endHour;
  row('current IST hour',           istHour + ' (' + (inWindow ? 'INSIDE active window' : 'OUTSIDE — stored only, no auto-assign') + ')');

  hdr('2. Global queue snapshot');
  const queue = await c.query(`
    SELECT
      COUNT(*) FILTER (WHERE category='partner')::int AS partner_unassigned,
      COUNT(*) FILTER (WHERE category='trader')::int  AS trader_unassigned,
      COUNT(*) FILTER (WHERE category IS NULL)::int   AS uncategorized,
      COUNT(*)::int AS total
      FROM leads WHERE assigned_to_user_id IS NULL AND deleted_at IS NULL`);
  const q = queue.rows[0];
  row('partner leads unassigned', q.partner_unassigned);
  row('trader leads unassigned',  q.trader_unassigned);
  row('uncategorized',            q.uncategorized);
  row('TOTAL unassigned',         q.total);

  hdr('3. Pending lead_requests breakdown');
  const pending = await c.query(`
    SELECT lr.id, lr.created_at, lr.quantity, lr.category, lr.leads_assigned, lr.note,
           u.full_name AS partner, u.id AS user_id, u.role,
           u.status AS user_status, u.deleted_at IS NULL AS user_active,
           rm.full_name AS rm_name, u.report_to_id AS rm_id,
           (SELECT COUNT(*)::int FROM leads
             WHERE assigned_to_user_id = u.id AND deleted_at IS NULL AND is_pending=TRUE) AS unworked_count
      FROM lead_requests lr
      JOIN users u ON u.id = lr.user_id
      LEFT JOIN users rm ON rm.id = u.report_to_id
     WHERE lr.status = 'pending'
     ORDER BY lr.created_at ASC
  `);

  if (pending.rows.length === 0) {
    console.log('  (no pending requests — all caught up)');
  }

  for (const r of pending.rows) {
    const ageH = Math.floor((Date.now() - new Date(r.created_at)) / 3600000);
    console.log();
    console.log('  ─────────────────────────────────────────────────────────────');
    console.log('  ' + r.partner + ' (' + r.role + ', status=' + r.user_status + ', active=' + r.user_active + ')');
    console.log('  request   : ' + r.id.slice(0, 8) + '   ' + r.quantity + ' leads, ' +
                'category=' + (r.category||'NULL') + ', assigned=' + r.leads_assigned + ', age=' + ageH + 'h');
    console.log('  RM        : ' + (r.rm_name || 'NONE'));
    console.log('  unworked  : ' + r.unworked_count + ' leads pending action on this partner');

    // Determine the EXACT reason it's stuck
    let reasons = [];
    if (s.auto_distribution_enabled !== 'true')
      reasons.push('AUTO-DIST DISABLED globally (distribution_settings.auto_distribution_enabled)');
    if (!inWindow)
      reasons.push(`OUTSIDE ACTIVE WINDOW (now IST hour ${istHour}, window ${startHour}-${endHour})`);
    if (!r.user_active)
      reasons.push('REQUESTER ACCOUNT DELETED (users.deleted_at IS NOT NULL)');
    if (r.user_status !== 'active')
      reasons.push('REQUESTER STATUS = ' + r.user_status + ' (must be "active")');

    // Eligible leads count for this category
    const elig = await c.query(`
      SELECT COUNT(*)::int AS n FROM leads
       WHERE deleted_at IS NULL AND assigned_to_user_id IS NULL
         AND ($1::text IS NULL OR category = $1)`, [r.category]);
    const eligCount = elig.rows[0].n;
    if (eligCount < r.quantity - r.leads_assigned) {
      reasons.push(`QUEUE STARVATION — needs ${r.quantity - r.leads_assigned} more leads of category="${r.category||'any'}", queue has ${eligCount}`);
    }

    if (reasons.length === 0) {
      console.log('  \x1b[31mROOT CAUSE : UNKNOWN — should fulfill on next scheduler tick (60s)\x1b[0m');
      console.log('              → try: pm2 logs digital-adbird-crm-backend | grep auto-distribute');
      console.log('              → or click "Run distribution now" in admin UI');
    } else {
      console.log('  \x1b[31mROOT CAUSE :\x1b[0m');
      reasons.forEach(r => console.log('              → ' + r));
    }
  }

  hdr('4. What will happen next');
  if (pending.rows.length > 0) {
    if (s.auto_distribution_enabled !== 'true') {
      console.log('  Auto-distribution is DISABLED. Pending requests will NOT auto-fulfill.');
      console.log('  Fix: UPDATE distribution_settings SET value=\'true\' WHERE key=\'auto_distribution_enabled\';');
    } else if (!inWindow) {
      console.log('  Outside active window. Pending requests will resume processing at ' + startHour + ':00 IST.');
    } else if (q.partner_unassigned === 0 && q.trader_unassigned === 0) {
      console.log('  No eligible leads in queue. Pending requests will fulfill when new leads arrive.');
      console.log('  → If Meta token expired: rotate token. New webhooks will trigger onLeadCreated');
      console.log('    which calls processAllMemberRequests automatically. Pending requests will top up.');
      console.log('  → To backfill historic leads: BACKFILL_DAYS=7 node scripts/recover-meta-leads.js');
    } else {
      console.log('  Eligible leads exist + window is active + auto-dist enabled.');
      console.log('  Pending requests should fulfill within 60 seconds (next scheduler tick).');
      console.log('  → Check pm2 logs digital-adbird-crm-backend | grep -E "RequestEngine|auto-distribute"');
      console.log('  → To force-run now: trigger /api/admin/distribution/run-now from admin UI.');
    }
  }

  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
