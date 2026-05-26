/**
 * Demo seed — DigitalADbird CRM
 *
 * Adds/updates demo accounts for every role type + seeds sample leads.
 * Does NOT wipe the real production users — safe to run alongside seed_production.
 *
 * Run: node src/db/seeds/seed_demo.js
 *
 * Demo credentials (all roles):
 *   Password: Abhi@9012
 *
 * Demo accounts:
 *   Super Admin  → anshusingh00108@gmail.com  (Abhishek Singh) | or name: Abhishek Singh
 *   RM           → rm@digitaladbird.com  (Demo RM)
 *   Fresher      → fresher@digitaladbird.com
 *   Veteran      → veteran@digitaladbird.com
 *   Trader Mgr   → trader@digitaladbird.com  (handles trader leads)
 *   Partner Mgr  → partner@digitaladbird.com (handles partner leads)
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, closePool } = require('../../config/database');
const logger = require('../../utils/logger');

const PASSWORD = 'Abhi@9012';

const DEMO_USERS = [
  // ── Super Admin / Admin demo ─────────────────────────────────────────
  {
    emp_code:    'DEMO_SA',
    full_name:   'Abhishek Singh',
    email:       'anshusingh00108@gmail.com',
    phone:       '+919149050944',
    role:        'super_admin',
    member_type: null,
    team_name:   null,
    label:       'Super Admin / Admin',
  },

  // ── RM demo ──────────────────────────────────────────────────────────
  {
    emp_code:    'DEMO_RM',
    full_name:   'Demo RM',
    email:       'rm@digitaladbird.com',
    phone:       '+919000000001',
    role:        'rm',
    member_type: null,
    team_name:   'Demo Team',
    label:       'RM',
  },

  // ── Member — Fresher ─────────────────────────────────────────────────
  {
    emp_code:    'DEMO_FR',
    full_name:   'Demo Fresher',
    email:       'fresher@digitaladbird.com',
    phone:       '+919000000002',
    role:        'member',
    member_type: 'fresher',
    team_name:   'Demo Team',
    label:       'Member (Fresher)',
  },

  // ── Member — Veteran ─────────────────────────────────────────────────
  {
    emp_code:    'DEMO_VT',
    full_name:   'Demo Veteran',
    email:       'veteran@digitaladbird.com',
    phone:       '+919000000003',
    role:        'member',
    member_type: 'veteran',
    team_name:   'Demo Team',
    label:       'Member (Veteran)',
  },

  // ── Member — Trader leads handler ────────────────────────────────────
  {
    emp_code:    'DEMO_TR',
    full_name:   'Demo Trader',
    email:       'trader@digitaladbird.com',
    phone:       '+919000000004',
    role:        'member',
    member_type: 'fresher',
    team_name:   'Demo Team',
    label:       'Member (Trader leads)',
  },

  // ── Member — Partner leads handler ───────────────────────────────────
  {
    emp_code:    'DEMO_PT',
    full_name:   'Demo Partner',
    email:       'partner@digitaladbird.com',
    phone:       '+919000000005',
    role:        'member',
    member_type: 'veteran',
    team_name:   'Demo Team',
    label:       'Member (Partner leads)',
  },
];

// Sample leads to demonstrate the lead pipeline
const SAMPLE_LEADS = [
  // Trader leads (assigned to Demo Trader)
  { full_name: 'Rajesh Kumar',   phone: '+919811111111', email: 'rajesh@example.com',   city: 'Mumbai',    state: 'Maharashtra', source: 'meta',   category: 'trader', call_status: 'not_called', stage: 'new',       assign_to: 'trader@digitaladbird.com' },
  { full_name: 'Priya Sharma',   phone: '+919822222222', email: 'priya@example.com',    city: 'Delhi',     state: 'Delhi',       source: 'google', category: 'trader', call_status: 'rnr',       stage: 'contacted', assign_to: 'trader@digitaladbird.com' },
  { full_name: 'Amit Verma',     phone: '+919833333333', email: 'amit@example.com',     city: 'Pune',      state: 'Maharashtra', source: 'meta',   category: 'trader', call_status: 'interested',stage: 'qualified', assign_to: 'trader@digitaladbird.com' },
  { full_name: 'Sunita Patel',   phone: '+919844444444', email: 'sunita@example.com',   city: 'Ahmedabad', state: 'Gujarat',     source: 'manual', category: 'trader', call_status: 'follow_up', stage: 'proposal',  assign_to: 'trader@digitaladbird.com' },
  { full_name: 'Vikram Singh',   phone: '+919855555555', email: 'vikram@example.com',   city: 'Jaipur',    state: 'Rajasthan',   source: 'google', category: 'trader', call_status: 'converted', stage: 'won',       assign_to: 'trader@digitaladbird.com' },

  // Partner leads (assigned to Demo Partner)
  { full_name: 'Neha Gupta',     phone: '+919866666666', email: 'neha@example.com',     city: 'Bangalore', state: 'Karnataka',   source: 'meta',   category: 'partner', call_status: 'not_called', stage: 'new',       assign_to: 'partner@digitaladbird.com' },
  { full_name: 'Rohit Mehta',    phone: '+919877777777', email: 'rohit@example.com',    city: 'Chennai',   state: 'Tamil Nadu',  source: 'google', category: 'partner', call_status: 'interested', stage: 'qualified', assign_to: 'partner@digitaladbird.com' },
  { full_name: 'Kavita Joshi',   phone: '+919888888888', email: 'kavita@example.com',   city: 'Hyderabad', state: 'Telangana',   source: 'meta',   category: 'partner', call_status: 'follow_up',  stage: 'proposal',  assign_to: 'partner@digitaladbird.com' },
  { full_name: 'Deepak Rao',     phone: '+919899999999', email: 'deepak@example.com',   city: 'Kolkata',   state: 'West Bengal', source: 'manual', category: 'partner', call_status: 'converted',  stage: 'won',       assign_to: 'partner@digitaladbird.com' },
  { full_name: 'Anita Nair',     phone: '+919700000001', email: 'anita@example.com',    city: 'Kochi',     state: 'Kerala',      source: 'meta',   category: 'partner', call_status: 'not_interested', stage: 'lost', assign_to: 'partner@digitaladbird.com' },

  // Mixed leads for Fresher (trader)
  { full_name: 'Suresh Pillai',  phone: '+919700000002', email: 'suresh@example.com',   city: 'Pune',      state: 'Maharashtra', source: 'meta',   category: 'trader', call_status: 'not_called', stage: 'new',       assign_to: 'fresher@digitaladbird.com' },
  { full_name: 'Meena Reddy',    phone: '+919700000003', email: 'meena@example.com',    city: 'Mumbai',    state: 'Maharashtra', source: 'google', category: 'trader', call_status: 'rnr',       stage: 'contacted', assign_to: 'fresher@digitaladbird.com' },
  { full_name: 'Arun Bose',      phone: '+919700000004', email: 'arun@example.com',     city: 'Kolkata',   state: 'West Bengal', source: 'manual', category: 'trader', call_status: 'busy',      stage: 'new',       assign_to: 'fresher@digitaladbird.com' },

  // Mixed leads for Veteran (partner)
  { full_name: 'Sanjay Iyer',    phone: '+919700000005', email: 'sanjay@example.com',   city: 'Chennai',   state: 'Tamil Nadu',  source: 'meta',   category: 'partner', call_status: 'interested', stage: 'qualified', assign_to: 'veteran@digitaladbird.com' },
  { full_name: 'Pooja Desai',    phone: '+919700000006', email: 'pooja@example.com',    city: 'Ahmedabad', state: 'Gujarat',     source: 'google', category: 'partner', call_status: 'converted',  stage: 'won',       assign_to: 'veteran@digitaladbird.com' },
  { full_name: 'Ravi Chandra',   phone: '+919700000007', email: 'ravi@example.com',     city: 'Delhi',     state: 'Delhi',       source: 'meta',   category: 'partner', call_status: 'follow_up',  stage: 'proposal',  assign_to: 'veteran@digitaladbird.com' },
];

async function upsertUser(u, passwordHash) {
  await query(
    `INSERT INTO users (emp_code, full_name, email, phone, role, member_type, team_name, password_hash, status,
                        daily_lead_cap, distribution_weight, is_available)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', 50, 1, TRUE)
       ON CONFLICT (email) DO UPDATE
         SET full_name    = EXCLUDED.full_name,
             phone        = EXCLUDED.phone,
             role         = EXCLUDED.role,
             member_type  = EXCLUDED.member_type,
             team_name    = EXCLUDED.team_name,
             password_hash = EXCLUDED.password_hash,
             status       = 'active'`,
    [u.emp_code, u.full_name, u.email.toLowerCase(), u.phone, u.role,
     u.member_type, u.team_name, passwordHash]
  );
}

async function seedLeads() {
  // Delete existing demo leads (by email domain patterns)
  await query(`DELETE FROM lead_remarks WHERE lead_id IN (SELECT id FROM leads WHERE email LIKE '%@example.com')`);
  await query(`DELETE FROM lead_assignments WHERE lead_id IN (SELECT id FROM leads WHERE email LIKE '%@example.com')`);
  await query(`UPDATE leads SET locked_by_user_id = NULL WHERE email LIKE '%@example.com'`);
  await query(`DELETE FROM leads WHERE email LIKE '%@example.com'`);

  let inserted = 0;
  for (const l of SAMPLE_LEADS) {
    const { rows: [assignee] } = await query(
      `SELECT id FROM users WHERE LOWER(email) = $1`, [l.assign_to.toLowerCase()]
    );
    if (!assignee) { logger.warn(`Assignee not found: ${l.assign_to}`); continue; }

    await query(
      `INSERT INTO leads (full_name, phone, email, city, state, source, category,
                          call_status, stage, assigned_to_user_id, assigned_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [l.full_name, l.phone, l.email, l.city, l.state, l.source, l.category,
       l.call_status, l.stage, assignee.id]
    );
    inserted++;
  }
  logger.info(`  ${inserted} demo leads inserted.`);
}

async function setHierarchy() {
  // Wire fresher, veteran, trader, partner members to report to Demo RM
  const { rows: [rm] } = await query(`SELECT id FROM users WHERE email = 'rm@digitaladbird.com'`);
  if (!rm) return;
  await query(
    `UPDATE users SET report_to_id = $1
      WHERE email IN (
        'fresher@digitaladbird.com',
        'veteran@digitaladbird.com',
        'trader@digitaladbird.com',
        'partner@digitaladbird.com'
      )`,
    [rm.id]
  );
  logger.info('  Hierarchy set: Fresher, Veteran, Trader, Partner → Demo RM');
}

async function ensureDefaultRule() {
  const { rows } = await query(`SELECT id FROM distribution_rules WHERE form_id IS NULL LIMIT 1`);
  if (rows.length === 0) {
    await query(
      `INSERT INTO distribution_rules(name, form_id, strategy, priority)
         VALUES ('Default Round Robin', NULL, 'round_robin', 100)`
    );
    logger.info('  Default distribution rule created.');
  }
}

async function run() {
  logger.info('=== DigitalADbird CRM — Demo Seed ===');
  logger.info(`Hashing password...`);
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  logger.info(`Upserting ${DEMO_USERS.length} demo accounts...`);
  for (const u of DEMO_USERS) {
    await upsertUser(u, passwordHash);
    logger.info(`  ✓ [${u.label.padEnd(22)}] ${u.full_name.padEnd(18)} <${u.email}>`);
  }

  await setHierarchy();
  logger.info('Seeding demo leads...');
  await seedLeads();
  await ensureDefaultRule();

  logger.info('');
  logger.info('=== Demo seed complete ===');
  logger.info('');
  logger.info('╔══════════════════════════════════════════════════════════╗');
  logger.info('║              DEMO LOGIN CREDENTIALS                     ║');
  logger.info('║  Password for ALL accounts: Abhi@9012                   ║');
  logger.info('╠══════════════════════════════════════════════════════════╣');
  logger.info('║  Super Admin  anshusingh00108@gmail.com                 ║');
  logger.info('║              "Abhishek Singh"  or  9149050944           ║');
  logger.info('╠══════════════════════════════════════════════════════════╣');
  logger.info('║  RM           rm@digitaladbird.com                 ║');
  logger.info('║  Fresher      fresher@digitaladbird.com            ║');
  logger.info('║  Veteran      veteran@digitaladbird.com            ║');
  logger.info('║  Trader Mgr   trader@digitaladbird.com             ║');
  logger.info('║  Partner Mgr  partner@digitaladbird.com            ║');
  logger.info('╚══════════════════════════════════════════════════════════╝');

  await closePool();
}

run().catch((e) => { logger.error({ e }, 'Demo seed failed'); process.exit(1); });
