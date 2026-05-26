/**
 * Real Production Hierarchy Seed — DigitalADbird CRM
 *
 * Inserts / updates:
 *   - 6 real RMs (Shahnaz, Pinak, Sitara, Manisha, Reena Jha, Vishnu Sudha)
 *   - 166 real member accounts with generated work emails
 *   - Proper report_to_id hierarchy (member → RM)
 *
 * SAFE to run multiple times (upserts on email).
 * Does NOT touch Super Admins or demo accounts.
 *
 * Run: node src/db/seeds/seed_hierarchy.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, closePool } = require('../../config/database');
const logger = require('../../utils/logger');

const DEFAULT_PASSWORD = 'Abhi@9012';

// ─── Real RM data ─────────────────────────────────────────────────────────────
const RM_HIERARCHY = [
  {
    rm_emp:   'RM001',
    rm_name:  'Vishnu Sudha',
    rm_email: 'vishnudigital.adbird@gmail.com',  // existing
    rm_phone: '+919149050944',
    team:     'Team Vishnu',
    members: [
      'Shailja Nayak', 'Neetu Devi', 'Ranvijay Kumar', 'Priyanka Singh',
      'Shabeer Ahmad Najar', 'Lata Verma', 'Virendra Singh Pal', 'Nitu Kumari',
    ],
  },
  {
    rm_emp:   'RM002',
    rm_name:  'Shahnaz',
    rm_email: 'shahnazdigitaladbird@gmail.com',  // existing
    rm_phone: '+919149050944',
    team:     'Team Shahnaz',
    members: [
      'Ishrat Jahan', 'Baljeet Kumar', 'Sucharita Das Jana', 'Mohammad Ali',
      'Ritesh Sattiya', 'Pawan Shukla', 'Naba Kr Chinte', 'Deepak Kr Diwakar',
      'Rekha Singh', 'Sunil Kumar Sagar', 'Suresh Bahadur', 'Hemlata Mahour',
      'Sanjay Kumar', 'Rajkumar Thakur', 'Mridula Singh', 'Sanman Singh',
      'Anuradha Prajapati', 'Rani Yadav', 'Sonali Soni', 'Aradhana Sharma',
      'Ahivaran Singh', 'Jainal Malita', 'Stephen Purty', 'Preeti Balani',
      'Shakeel Ahmed', 'Gayatri Kumari', 'Rajnish Nayankumar', 'Anjan Kumar',
      'Ashish Saxena', 'Praveen Kumar', 'Sayeeda Begam', 'Soni Kumari',
    ],
  },
  {
    rm_emp:   'RM003',
    rm_name:  'Pinak Sir',
    rm_email: 'pinakdigitaladbird@gmail.com',    // existing
    rm_phone: '+919149050944',
    team:     'Team Pinak',
    members: [
      'Deepika Singh', 'Md Rehan', 'Pramod Kumar Singh', 'Pramod Mahto',
      'Neelam Kamraj', 'Vida Bhushan', 'Amrita Singh', 'Rajni Singh',
      'Mohammad Salam', 'Pravin Kumar', 'Anshu Singh', 'Sarita Malviya',
      'Khushboo Chaturvedi', 'Gyandeep Raw', 'Anil Kaswan', 'Karan Thakur',
      'Navneet Singh', 'Aditya Kumar Singh', 'Anil Mahto', 'Siya Mandana',
      'Priyanka Waliya', 'Rahul Gagoliya', 'Vijay', 'Neha Jaiswal',
      'Vivek Singh Gaur', 'Parmesh Kumar Hind', 'Vicky Shakya', 'Sonam Sen',
      'Shailendra Rajwade', 'Ved Prakash', 'Md Jamshed Shakil', 'Avijit Mukherjee',
      'Prem Narayan Kushawaha', 'Sachin Sharma', 'Kuldeep Singh', 'Famida Kishwer',
      'Ravi Kumar', 'Monika Srivastav', 'Juli Chik Baraik', 'Chiranji Singh',
      'Sanjay Hedau', 'Dharvendra Kumar', 'Ram Chandra Maurya', 'Sunita Kumari',
      'Satyaprasad Chakrabarty', 'Arun Bharadwaj', 'Nur E Elahi',
      'Utpal Das Ishan', 'Kishori Khadse', 'Sangeeta Negi Krishnakant Sharma',
    ],
  },
  {
    rm_emp:   'RM004',
    rm_name:  'Reena Jha',
    rm_email: 'reenajhadigitaladbird@gmail.com', // existing
    rm_phone: '+919149050944',
    team:     'Team Reena',
    members: [
      'Pratiksha Malik', 'Kavita Mahto', 'Megha Kulwala', 'Ruma Kundu',
      'Swadesh Barua', 'Shashi Yadav', 'Anjali Abhay Singh', 'Laychee Radha',
      'Sunil Kumar', 'Chandresh Kumar', 'Deepak Kumar Kaushal', 'Maushmi Behura',
      'Nirmala Singh', 'Prabha Singh Badal', 'Reshma Varma', 'Satyabhama',
    ],
  },
  {
    rm_emp:   'RM005',
    rm_name:  'Sitara Gaur',
    rm_email: 'sitaragaurdigitaladbird46@gmail.com', // existing
    rm_phone: '+919149050944',
    team:     'Team Sitara',
    members: [
      'Dilip Kumar Singh', 'Uttam Kr Saha', 'Parimal Pippal',
      'Anshika Pramod Keshari', 'Mayank', 'Sangeeta', 'Manoj Kumar',
      'Sonal Sharma', 'Khurshid Sayyad', 'Poonam Raut', 'Rajni Kurve',
      'Rajan Yadav', 'Anupam Rani', 'Fatima Kosar', 'AzmatUllah',
      'Sohel Rana', 'Pankaj Deb', 'Priyanka Singh', 'Suresh Singh',
      'Anita Kumari', 'Vidya Sagar', 'Amol Ashtekar', 'Nilesh Kumar',
      'Dipali Parab', 'Paramjeet', 'Poonam Kumari', 'Arjun',
      'Arti Sharma', 'Nandini Singh', 'Sukhdeb Singh Jadon',
      'Sonu Suwalka', 'Chhoti Kumari', 'Jay Patel', 'Muska Gupta',
    ],
  },
  {
    rm_emp:   'RM006',
    rm_name:  'Manisha',           // NEW RM — not in DB yet
    rm_email: 'manishadigitaladbird@gmail.com',
    rm_phone: '+919149050944',
    team:     'Team Manisha',
    members: [
      'Deepak Kumar', 'Himanshu Singh', 'Nilam Gupta', 'Nanda Parwin',
      'Sneha Thakur', 'Pramod Poddar', 'Parmod Kumar', 'Varsha Sharma',
      'Satender Kumar', 'Paup Singh Pawan', 'Tejinder Singh', 'Sankesh Sharma',
      'Sweta Saurabh', 'Anjoo Vishwakarma', 'Kamil', 'Neeti Singh',
      'Lakshay Thakur', 'Sarika Parmar', 'Anand Kumar', 'Sona Das',
      'Punam', 'Devnarayan', 'Niketa Chaudhary', 'Khushi Keshwani',
      'Sudesh Kumari', 'Neelam Tiwari',
    ],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeForEmail(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')  // keep only alphanumeric + spaces
    .trim()
    .replace(/\s+/g, '.');         // spaces → dots
}

/** Global email registry to handle duplicate names across teams. */
const emailRegistry = new Set();

function uniqueEmail(name) {
  const base    = sanitizeForEmail(name);
  let   email   = `${base}@digitaladbird.com`;
  let   counter = 2;
  while (emailRegistry.has(email)) {
    email = `${base}.${counter}@digitaladbird.com`;
    counter++;
  }
  emailRegistry.add(email);
  return email;
}

function empCode(rmEmp, idx) {
  // e.g. RM001M001, RM002M001, etc.
  return `${rmEmp}M${String(idx).padStart(3, '0')}`;
}

// ─── Seed logic ───────────────────────────────────────────────────────────────

async function upsertRM(rm, passwordHash) {
  await query(
    `INSERT INTO users (emp_code, full_name, email, phone, role, team_name, password_hash, status,
                        daily_lead_cap, distribution_weight, is_available)
       VALUES ($1, $2, $3, $4, 'rm', $5, $6, 'active', 50, 1, TRUE)
       ON CONFLICT (email) DO UPDATE
         SET full_name    = EXCLUDED.full_name,
             phone        = EXCLUDED.phone,
             team_name    = EXCLUDED.team_name,
             password_hash = EXCLUDED.password_hash,
             status       = 'active'`,
    [rm.rm_emp, rm.rm_name, rm.rm_email.toLowerCase(),
     rm.rm_phone, rm.team, passwordHash]
  );
}

async function upsertMember(memberName, rmEmail, teamName, empCode, passwordHash) {
  const email = uniqueEmail(memberName);
  await query(
    `INSERT INTO users (emp_code, full_name, email, phone, role, member_type, team_name,
                        password_hash, status, daily_lead_cap, distribution_weight, is_available)
       VALUES ($1, $2, $3, NULL, 'member', 'fresher', $4, $5, 'active', 50, 1, TRUE)
       ON CONFLICT (email) DO UPDATE
         SET full_name     = EXCLUDED.full_name,
             emp_code      = EXCLUDED.emp_code,
             team_name     = EXCLUDED.team_name,
             password_hash  = EXCLUDED.password_hash,
             status        = 'active'`,
    [empCode, memberName, email, teamName, passwordHash]
  );
  return email;
}

async function setHierarchy(memberEmails, rmEmail) {
  if (memberEmails.length === 0) return;
  const { rows: [rm] } = await query(
    `SELECT id FROM users WHERE LOWER(email) = $1`, [rmEmail.toLowerCase()]
  );
  if (!rm) { logger.warn(`RM not found: ${rmEmail}`); return; }

  await query(
    `UPDATE users SET report_to_id = $1
      WHERE LOWER(email) = ANY($2::text[])`,
    [rm.id, memberEmails.map(e => e.toLowerCase())]
  );
}

async function run() {
  logger.info('=== DigitalADbird CRM — Real Hierarchy Seed ===');
  logger.info('Hashing password...');
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);

  let totalMembers = 0;

  for (const rm of RM_HIERARCHY) {
    logger.info(`\n  RM: ${rm.rm_name} (${rm.team}) — ${rm.members.length} members`);
    await upsertRM(rm, passwordHash);

    const memberEmails = [];
    for (let i = 0; i < rm.members.length; i++) {
      const name  = rm.members[i];
      const code  = empCode(rm.rm_emp, i + 1);
      const email = await upsertMember(name, rm.rm_email, rm.team, code, passwordHash);
      memberEmails.push(email);
      totalMembers++;
    }

    await setHierarchy(memberEmails, rm.rm_email);
    logger.info(`  ✓ ${rm.members.length} members created and linked to ${rm.rm_name}`);
  }

  // Stats summary
  const { rows: stats } = await query(
    `SELECT role, COUNT(*) FROM users WHERE deleted_at IS NULL GROUP BY role ORDER BY role`
  );
  logger.info('\n=== Database users after seed ===');
  stats.forEach(r => logger.info(`  ${r.role.padEnd(15)}: ${r.count}`));

  logger.info(`\n=== Hierarchy seed complete ===`);
  logger.info(`  RMs seeded    : ${RM_HIERARCHY.length}`);
  logger.info(`  Members seeded: ${totalMembers}`);
  logger.info(`  Password      : ${DEFAULT_PASSWORD}`);
  logger.info(`\nMembers can login via generated emails:`);
  logger.info(`  Format: firstname.lastname@digitaladbird.com`);
  logger.info(`  Example: ishrat.jahan@digitaladbird.com`);

  await closePool();
}

run().catch((e) => { logger.error({ e }, 'Hierarchy seed failed'); process.exit(1); });
