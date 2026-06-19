/**
 * Production seed script.
 *
 * Reads CSV exports from /db/seeds and inserts:
 *   - users.csv     -> users table  (admin/RM/members + hierarchy)
 *   - leads.csv     -> leads table  (optional historical seed)
 *
 * USAGE:
 *   1. Export each tab of your DigitalADbird Google Sheet as CSV:
 *        File -> Download -> Comma Separated Values (.csv)
 *      Save them into backend/src/db/seeds/  with these exact names:
 *        - users.csv
 *        - leads.csv      (optional)
 *
 *   2. Expected users.csv columns (header row required):
 *        emp_code, full_name, email, phone, role, report_to_email,
 *        team_name, daily_lead_cap, distribution_weight
 *      (role must be one of: admin, rm, member)
 *
 *   3. Expected leads.csv columns (header row required):
 *        full_name, phone, email, city, state, source, campaign_label,
 *        product_tag, assigned_to_email
 *
 *   4. Run:  npm run seed
 *
 * The script is IDEMPOTENT — re-running it upserts on email/phone.
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { query, closePool, withTransaction } = require('../config/database');
const logger = require('../utils/logger');

const SEED_DIR = path.join(__dirname, 'seeds');

function readCsv(name) {
  const file = path.join(SEED_DIR, name);
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  return parse(buf, { columns: true, skip_empty_lines: true, trim: true });
}

function normalizePhone(p) {
  if (!p) return null;
  let x = String(p).trim().replace(/[\s-()]/g, '');
  if (/^\d{10}$/.test(x)) x = '+91' + x;
  if (!x.startsWith('+')) x = '+' + x;
  return x;
}

async function seedUsers() {
  const rows = readCsv('users.csv');
  if (!rows) { logger.warn('users.csv not found — skipping user seed'); return; }
  logger.info(`Seeding ${rows.length} users...`);

  // pass 1: insert/update everyone without the report_to FK
  for (const r of rows) {
    const role = (r.role || '').toLowerCase().trim();
    if (!['super_admin', 'admin', 'rm', 'member'].includes(role)) {
      logger.warn({ row: r }, 'Skipping row with invalid role');
      continue;
    }
    // Normalise legacy 'admin' -> 'super_admin'
    const normalizedRole = role === 'admin' ? 'super_admin' : role;
    const memberType = (r.member_type || '').toLowerCase().trim() || null;
    await query(
      `INSERT INTO users (emp_code, cp_id, full_name, email, phone, role, member_type, team_name,
                          daily_lead_cap, distribution_weight)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                COALESCE(NULLIF($9,'')::int, 50),
                COALESCE(NULLIF($10,'')::int, 1))
        ON CONFLICT (email) DO UPDATE
          SET full_name = EXCLUDED.full_name,
              phone     = EXCLUDED.phone,
              role      = EXCLUDED.role,
              member_type = EXCLUDED.member_type,
              team_name = EXCLUDED.team_name,
              daily_lead_cap = EXCLUDED.daily_lead_cap,
              distribution_weight = EXCLUDED.distribution_weight`,
      [r.emp_code || null, String(r.cp_id || r.emp_code || '').trim().toUpperCase(), r.full_name, r.email.toLowerCase(),
       normalizePhone(r.phone), normalizedRole, memberType, r.team_name || null,
       r.daily_lead_cap || '', r.distribution_weight || '']
    );
  }

  // pass 2: hierarchy
  for (const r of rows) {
    if (!r.report_to_email) continue;
    await query(
      `UPDATE users
          SET report_to_id = (SELECT id FROM users WHERE email = $1)
        WHERE email = $2`,
      [r.report_to_email.toLowerCase(), r.email.toLowerCase()]
    );
  }

  // create a default distribution rule if none exists
  const { rows: existing } = await query(`SELECT id FROM distribution_rules WHERE form_id IS NULL`);
  if (existing.length === 0) {
    await query(
      `INSERT INTO distribution_rules(name, form_id, strategy, priority)
         VALUES ('Default Round Robin', NULL, 'round_robin', 100)`
    );
    logger.info('Default distribution rule created.');
  }
}

async function seedLeads() {
  const rows = readCsv('leads.csv');
  if (!rows) { logger.warn('leads.csv not found — skipping lead seed (this is fine)'); return; }
  logger.info(`Seeding ${rows.length} leads...`);

  await withTransaction(async (client) => {
    for (const r of rows) {
      let assignedId = null;
      if (r.assigned_to_email) {
        const { rows: u } = await client.query(
          `SELECT id FROM users WHERE email = $1`, [r.assigned_to_email.toLowerCase()]
        );
        assignedId = u[0]?.id || null;
      }
      await client.query(
        `INSERT INTO leads (full_name, phone, email, city, state, source,
                            campaign_label, product_tag, assigned_to_user_id, assigned_at)
            VALUES ($1, $2, $3, $4, $5, COALESCE(NULLIF($6,''),'import'), $7, $8, $9,
                    CASE WHEN $9::uuid IS NOT NULL THEN NOW() ELSE NULL END)`,
        [r.full_name, normalizePhone(r.phone), r.email || null, r.city || null,
         r.state || null, r.source || 'import', r.campaign_label || null,
         r.product_tag || null, assignedId]
      );
    }
  });
}

async function run() {
  await seedUsers();
  await seedLeads();
  logger.info('Seed complete.');
  await closePool();
}
run().catch((e) => { logger.error({ e }, 'Seed failed'); process.exit(1); });
