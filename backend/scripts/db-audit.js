const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:postgres@localhost:5433/digitaladbird' });

(async () => {
  try {
    // Counts
    const leads = await pool.query('SELECT COUNT(*) as c FROM leads WHERE deleted_at IS NULL');
    const users = await pool.query('SELECT COUNT(*) as c FROM users WHERE deleted_at IS NULL');
    const msgs = await pool.query('SELECT COUNT(*) as c FROM chat_messages');
    const convs = await pool.query('SELECT COUNT(*) as c FROM chat_conversations WHERE is_deleted = FALSE');
    const workflows = await pool.query('SELECT COUNT(*) as c FROM lead_workflow');
    const followups = await pool.query('SELECT COUNT(*) as c FROM lead_followup_tracker');
    const conversions = await pool.query('SELECT COUNT(*) as c FROM lead_conversion');

    console.log('=== DATABASE AUDIT ===');
    console.log('Leads:', leads.rows[0].c);
    console.log('Users:', users.rows[0].c);
    console.log('Messages:', msgs.rows[0].c);
    console.log('Conversations:', convs.rows[0].c);
    console.log('Workflows:', workflows.rows[0].c);
    console.log('Followups:', followups.rows[0].c);
    console.log('Conversions:', conversions.rows[0].c);

    // Get leads table columns
    console.log('\n=== LEADS TABLE COLUMNS ===');
    const cols = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'leads' ORDER BY ordinal_position`
    );
    cols.rows.forEach(c => console.log(`  ${c.column_name} (${c.data_type})`));

    // List all leads
    console.log('\n=== ALL LEADS ===');
    const allLeads = await pool.query(
      `SELECT id, full_name, email, phone, source, stage, created_at
       FROM leads WHERE deleted_at IS NULL ORDER BY created_at DESC`
    );
    allLeads.rows.forEach((l, i) => {
      console.log(`${i+1}. ${l.full_name} | ${l.email || '-'} | ${l.phone || '-'} | source=${l.source} | stage=${l.stage} | ${l.created_at.toISOString().slice(0,10)}`);
    });

    // List all users
    console.log('\n=== ALL USERS (roles summary) ===');
    const roleCounts = await pool.query(
      `SELECT role, COUNT(*) as c FROM users WHERE deleted_at IS NULL GROUP BY role ORDER BY role`
    );
    roleCounts.rows.forEach(r => console.log(`  ${r.role}: ${r.c}`));

    console.log('\n=== ADMIN + RM USERS ===');
    const keyUsers = await pool.query(
      `SELECT id, full_name, email, phone, role, status, cp_id, created_at
       FROM users WHERE deleted_at IS NULL AND role IN ('super_admin', 'rm')
       ORDER BY role, full_name`
    );
    keyUsers.rows.forEach((u, i) => {
      console.log(`${i+1}. [${u.role}] ${u.full_name} | ${u.email} | ${u.phone || '-'} | cp=${u.cp_id || '-'} | ${u.status}`);
    });

    // Check for demo-pattern leads
    console.log('\n=== POTENTIAL DEMO/FAKE LEADS ===');
    const demoLeads = await pool.query(
      `SELECT id, full_name, email, phone, source, created_at
       FROM leads WHERE deleted_at IS NULL
       AND (
         email LIKE '%@example%' OR email LIKE '%@test%' OR email LIKE '%@demo%'
         OR full_name ILIKE '%test%' OR full_name ILIKE '%demo%' OR full_name ILIKE '%fake%' OR full_name ILIKE '%sample%'
         OR source = 'seed' OR source = 'demo'
         OR phone LIKE '555%' OR phone LIKE '000%'
       )
       ORDER BY created_at`
    );
    if (demoLeads.rows.length === 0) {
      console.log('No obvious demo/fake leads by pattern.');
    } else {
      demoLeads.rows.forEach((l, i) => {
        console.log(`${i+1}. [DEMO] ${l.full_name} | ${l.email} | ${l.phone} | source=${l.source}`);
      });
    }

    // All leads with source breakdown
    console.log('\n=== LEAD SOURCE BREAKDOWN ===');
    const sources = await pool.query(
      `SELECT source, COUNT(*) as c FROM leads WHERE deleted_at IS NULL GROUP BY source ORDER BY c DESC`
    );
    sources.rows.forEach(s => console.log(`  ${s.source}: ${s.c}`));

    // Chat data
    console.log('\n=== CHAT CONVERSATIONS ===');
    const chatData = await pool.query(
      `SELECT c.id, c.type, c.title,
              (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) as msg_count,
              c.created_at
       FROM chat_conversations c WHERE c.is_deleted = FALSE
       ORDER BY c.updated_at DESC`
    );
    chatData.rows.forEach((c, i) => {
      console.log(`${i+1}. [${c.type}] ${c.title || 'untitled'} | ${c.msg_count} msgs | ${c.created_at.toISOString().slice(0,10)}`);
    });

    // Meta-related columns check
    console.log('\n=== META LEAD FIELDS ===');
    const metaCols = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'leads' AND column_name LIKE 'meta%' ORDER BY column_name`
    );
    if (metaCols.rows.length === 0) {
      console.log('NO meta columns found in leads table! Need migration.');
    } else {
      metaCols.rows.forEach(c => console.log(`  ${c.column_name}`));
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
})();
