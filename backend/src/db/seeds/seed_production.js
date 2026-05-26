/**
 * Production seed — DigitalADbird CRM
 *
 * Wipes all data and inserts the real production users.
 * Password for all accounts: Abhi@9012
 * OTP testing phone: 9149050944
 *
 * Run: node src/db/seeds/seed_production.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, closePool } = require('../../config/database');
const logger = require('../../utils/logger');

const DEFAULT_PASSWORD = 'Abhi@9012';

// ─── Real production users ────────────────────────────────────────────────────
const USERS = [
  // ── Super Admins ──────────────────────────────────────────────────────────
  {
    emp_code:    'SA001',
    full_name:   'Prince Vinit',
    email:       'prince@digitaladbird.com',
    phone:       '+919234262810',
    role:        'super_admin',
    member_type: null,
    team_name:   null,
  },
  {
    emp_code:    'SA002',
    full_name:   'Dev',
    email:       'dev@digitaladbird.com',
    phone:       '+919304951165',
    role:        'super_admin',
    member_type: null,
    team_name:   null,
  },

  // ── RMs ───────────────────────────────────────────────────────────────────
  // (All RMs share +919149050944 as the OTP test number for now)
  {
    emp_code:    'RM001',
    full_name:   'Vishnu Sudha',
    email:       'vishnudigital.adbird@gmail.com',
    phone:       '+919149050944',
    role:        'rm',
    member_type: null,
    team_name:   'Team Vishnu',
  },
  {
    emp_code:    'RM002',
    full_name:   'Shahnaz',
    email:       'shahnazdigitaladbird@gmail.com',
    phone:       '+919149050944',
    role:        'rm',
    member_type: null,
    team_name:   'Team Shahnaz',
  },
  {
    emp_code:    'RM003',
    full_name:   'Pinak Sir',
    email:       'pinakdigitaladbird@gmail.com',
    phone:       '+919149050944',
    role:        'rm',
    member_type: null,
    team_name:   'Team Pinak',
  },
  {
    emp_code:    'RM004',
    full_name:   'Reena Jha',
    email:       'reenajhadigitaladbird@gmail.com',
    phone:       '+919149050944',
    role:        'rm',
    member_type: null,
    team_name:   'Team Reena',
  },
  {
    emp_code:    'RM005',
    full_name:   'Sitara Gaur',
    email:       'sitaragaurdigitaladbird46@gmail.com',
    phone:       '+919149050944',
    role:        'rm',
    member_type: null,
    team_name:   'Team Sitara',
  },
];

async function clearData() {
  logger.info('Clearing existing data (in dependency order)...');
  await query(`DELETE FROM audit_logs`);
  await query(`DELETE FROM auth_sessions`);
  await query(`DELETE FROM otp_codes`);
  await query(`DELETE FROM rr_state`);
  await query(`DELETE FROM lead_assignments`);
  await query(`DELETE FROM lead_remarks`);
  await query(`UPDATE leads SET locked_by_user_id = NULL`);
  await query(`UPDATE leads SET assigned_to_user_id = NULL`);
  await query(`DELETE FROM leads`);
  await query(`DELETE FROM distribution_rules`);
  await query(`DELETE FROM meta_forms`);
  await query(`DELETE FROM meta_pages`);
  await query(`DELETE FROM users`);
  logger.info('All data cleared.');
}

async function seedUsers(passwordHash) {
  logger.info(`Seeding ${USERS.length} users...`);
  for (const u of USERS) {
    await query(
      `INSERT INTO users
         (emp_code, full_name, email, phone, role, member_type, team_name, password_hash, status,
          daily_lead_cap, distribution_weight, is_available)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', 50, 1, TRUE)`,
      [u.emp_code, u.full_name, u.email.toLowerCase(), u.phone, u.role,
       u.member_type, u.team_name, passwordHash]
    );
    logger.info(`  ✓ [${u.role.toUpperCase().padEnd(11)}] ${u.full_name.padEnd(20)} <${u.email}>`);
  }
}

async function seedDefaultRule() {
  await query(
    `INSERT INTO distribution_rules(name, form_id, strategy, priority)
       VALUES ('Default Round Robin', NULL, 'round_robin', 100)`
  );
  logger.info('Default distribution rule (round_robin) created.');
}

async function run() {
  logger.info('=== DigitalADbird CRM — Production Seed ===');
  logger.info(`Hashing password (bcrypt cost 12)...`);
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
  logger.info('Password hashed.');

  await clearData();
  await seedUsers(passwordHash);
  await seedDefaultRule();

  logger.info('');
  logger.info('=== Seed complete ===');
  logger.info('Login credentials for all accounts:');
  logger.info(`  Password : ${DEFAULT_PASSWORD}`);
  logger.info(`  OTP test : Read OTP from backend logs (console provider)`);
  logger.info('');
  logger.info('Super Admins:');
  logger.info('  prince@digitaladbird.com  (Prince Vinit)');
  logger.info('  dev@digitaladbird.com     (Dev)');
  logger.info('');
  logger.info('RMs:');
  USERS.filter(u => u.role === 'rm').forEach(u => logger.info(`  ${u.email}  (${u.full_name})`));

  await closePool();
}

run().catch((e) => { logger.error({ e }, 'Production seed failed'); process.exit(1); });
