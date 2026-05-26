#!/usr/bin/env node
/**
 * Seed production users — 2 admins, 5 RMs, 7 partners.
 *
 * Usage:
 *   node src/db/seeds/seed_production_users.js
 *
 * Idempotent: uses ON CONFLICT(email) DO UPDATE so it can be run multiple times.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, closePool } = require('../../config/database');

const SALT_ROUNDS = 12;

const USERS = [
  // ── ADMINS ──────────────────────────────────────────────────────
  {
    full_name: 'Abhishek Singh',
    email: 'anshusingh00108@gmail.com',
    phone: '+919149050944',
    role: 'super_admin',
    password: 'Abhi@7086',
    cp_id: 'ABH7086SING',
    team_name: null,
  },
  {
    full_name: 'Rohit Kumar',
    email: 'digitaladbirddmk@gmail.com',
    phone: '+919905907287',
    role: 'super_admin',
    password: 'Rohit@123',
    cp_id: 'ROH9001IT',
    team_name: null,
  },

  // ── RMs ─────────────────────────────────────────────────────────
  {
    full_name: 'Sitara Gaur',
    email: 'sitaragaurdigitaladbird46@gmail.com',
    phone: '+919548431936',
    role: 'rm',
    password: 'Abhi@708090',
    cp_id: 'SBA28071544',
    team_name: 'Team Sitara',
  },
  {
    full_name: 'Manisha Singh',
    email: 'manishadigitaladbird@gmail.com',
    phone: '+91827997550',
    role: 'rm',
    password: 'Abhi@708090',
    cp_id: 'MSA09110578',
    team_name: 'Team Manisha',
  },
  {
    full_name: 'SHAHNAZ',
    email: 'shahnazdigitaladbird@gmail.com',
    phone: '+918700607861',
    role: 'rm',
    password: 'Abhi@708090',
    cp_id: 'SBA02120635',
    team_name: 'Team Shahnaz',
  },
  {
    full_name: 'Rajesh Sir',
    email: 'rajeshmpkrr@gmail.com',
    phone: '+917260868188',
    role: 'rm',
    password: 'Abhi@708090',
    cp_id: 'RYA00000001',
    team_name: 'Team Rajesh',
  },
  {
    full_name: 'Vishnusudha Pandey',
    email: 'vishnudigital.adbird@gmail.com',
    phone: '+919643445515',
    role: 'rm',
    password: 'Abhi@708090',
    cp_id: 'VSA17031013',
    team_name: 'Team Vishnu',
  },

  // ── PARTNERS ────────────────────────────────────────────────────
  {
    full_name: 'Manoj Kumar',
    email: 'monurock3027@gmail.com',
    phone: '+916394583360',
    role: 'partner',
    password: 'Abhi@708090',
    cp_id: '1553',
    team_name: null,
  },
  {
    full_name: 'Nilam Gupta',
    email: 'atulsumitgupta@gmail.com',
    phone: '+918417978251',
    role: 'partner',
    password: 'Abhi@708090',
    cp_id: '0542',
    team_name: null,
  },
  {
    full_name: 'Mohammad Ali',
    email: 'alikhan98640@gmail.com',
    phone: '+918051023484',
    role: 'partner',
    password: 'Abhi@708090',
    cp_id: 'MAA27071541',
    team_name: null,
  },
  {
    full_name: 'Priyanka Kumari',
    email: 'pk5252168@gmail.com',
    phone: '+919523623467',
    role: 'partner',
    password: 'Abhi@708090',
    cp_id: 'PKA00000002',
    team_name: null,
  },
  {
    full_name: 'Lata Ji',
    email: 'vlata015@gmail.com',
    phone: '+917678141952',
    role: 'partner',
    password: 'Abhi@708090',
    cp_id: 'LVA00000023',
    team_name: null,
  },
  {
    full_name: 'Shabbir Ji',
    email: 'shabeerahil17@gmail.com',
    phone: '+919858455865',
    role: 'partner',
    password: 'Abhi@708090',
    cp_id: 'SAA18060218',
    team_name: null,
  },
  {
    full_name: 'Priyanka Ji',
    email: 'priyankarth2006@gmail.com',
    phone: '+919905926580',
    role: 'partner',
    password: 'Abhi@708090',
    cp_id: 'PSA14100521',
    team_name: null,
  },
];

async function seedUsers() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Seeding Production Users                ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  let created = 0;
  let updated = 0;

  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, SALT_ROUNDS);
    const empCode = u.cp_id || `SA${Date.now().toString().slice(-6)}`;

    const result = await query(
      `INSERT INTO users (emp_code, full_name, email, phone, role, password_hash, cp_id, team_name, status, is_available)
       VALUES ($1, $2, $3, $4, $5::user_role, $6, $7, $8, 'active', TRUE)
       ON CONFLICT (email) DO UPDATE SET
         full_name     = EXCLUDED.full_name,
         role          = EXCLUDED.role,
         password_hash = EXCLUDED.password_hash,
         cp_id         = EXCLUDED.cp_id,
         phone         = EXCLUDED.phone,
         team_name     = COALESCE(EXCLUDED.team_name, users.team_name),
         status        = 'active',
         is_available  = TRUE,
         updated_at    = NOW()
       RETURNING (xmax = 0) AS is_new, id, full_name, role`,
      [empCode, u.full_name, u.email.toLowerCase(), u.phone, u.role, hash, u.cp_id, u.team_name]
    );

    const row = result.rows[0];
    if (row.is_new) {
      created++;
      console.log(`  + CREATED  ${row.role.padEnd(12)} ${row.full_name} (${u.email})`);
    } else {
      updated++;
      console.log(`  ~ UPDATED  ${row.role.padEnd(12)} ${row.full_name} (${u.email})`);
    }
  }

  // Link existing RM team members to their RM if they exist by matching team_name
  const rmRows = await query(`SELECT id, full_name, team_name FROM users WHERE role = 'rm' AND deleted_at IS NULL AND team_name IS NOT NULL`);
  for (const rm of rmRows.rows) {
    const { rowCount } = await query(
      `UPDATE users SET report_to_id = $1
       WHERE team_name = $2 AND role = 'member' AND deleted_at IS NULL AND (report_to_id IS NULL OR report_to_id != $1)`,
      [rm.id, rm.team_name]
    );
    if (rowCount > 0) {
      console.log(`  → Linked ${rowCount} members to RM ${rm.full_name} (${rm.team_name})`);
    }
  }

  console.log('');
  console.log(`Done: ${created} created, ${updated} updated.`);
}

(async () => {
  try {
    await seedUsers();
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await closePool();
    process.exit(0);
  }
})();
