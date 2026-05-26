const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:postgres@localhost:5433/digitaladbird' });

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Delete ALL 22 demo leads (all have @demo.test emails or are duplicates)
    const delLeads = await client.query(
      `DELETE FROM leads WHERE deleted_at IS NULL
       AND (email LIKE '%@demo.test' OR email LIKE '%demo@gmail.com')
       RETURNING id, full_name, email`
    );
    console.log(`Deleted ${delLeads.rowCount} demo leads:`);
    delLeads.rows.forEach(l => console.log(`  - ${l.full_name} (${l.email})`));

    // 2. Clean up workflow data tied to deleted leads
    const delWorkflows = await client.query(
      `DELETE FROM lead_workflow WHERE lead_id NOT IN (SELECT id FROM leads WHERE deleted_at IS NULL)
       RETURNING id`
    );
    console.log(`Deleted ${delWorkflows.rowCount} orphan workflow records`);

    const delFollowups = await client.query(
      `DELETE FROM lead_followup_tracker WHERE lead_id NOT IN (SELECT id FROM leads WHERE deleted_at IS NULL)
       RETURNING id`
    );
    console.log(`Deleted ${delFollowups.rowCount} orphan followup records`);

    const delConversions = await client.query(
      `DELETE FROM lead_conversion WHERE lead_id NOT IN (SELECT id FROM leads WHERE deleted_at IS NULL)
       RETURNING id`
    );
    console.log(`Deleted ${delConversions.rowCount} orphan conversion records`);

    // 3. Clean up test chat messages (only messages in conversations that have no real purpose)
    // Keep conversations between real users, delete only orphan/test ones
    const delTestMsgs = await client.query(
      `DELETE FROM chat_messages WHERE body LIKE 'Test message for chat%'
       RETURNING id`
    );
    console.log(`Deleted ${delTestMsgs.rowCount} test chat messages`);

    // 4. Remove Demo RM user and Dev user (test accounts)
    const demoRm = await client.query(
      `UPDATE users SET deleted_at = NOW(), status = 'inactive'
       WHERE email = 'rm@digitaladbird.com' AND role = 'rm'
       RETURNING id, full_name, email`
    );
    if (demoRm.rowCount) console.log(`Soft-deleted Demo RM: ${demoRm.rows[0].full_name} (${demoRm.rows[0].email})`);

    const devUser = await client.query(
      `UPDATE users SET deleted_at = NOW(), status = 'inactive'
       WHERE email = 'dev@digitaladbird.com' AND role = 'super_admin'
       RETURNING id, full_name, email`
    );
    if (devUser.rowCount) console.log(`Soft-deleted Dev user: ${devUser.rows[0].full_name} (${devUser.rows[0].email})`);

    // 5. Clean orphan chat data from deleted leads
    const delLeadConvs = await client.query(
      `UPDATE chat_conversations SET is_deleted = TRUE
       WHERE type = 'lead' AND lead_id NOT IN (SELECT id FROM leads WHERE deleted_at IS NULL)
       RETURNING id`
    );
    console.log(`Soft-deleted ${delLeadConvs.rowCount} orphan lead conversations`);

    // 6. Clean empty conversations (0 messages)
    const emptyConvs = await client.query(
      `UPDATE chat_conversations SET is_deleted = TRUE
       WHERE is_deleted = FALSE
       AND id NOT IN (SELECT DISTINCT conversation_id FROM chat_messages)
       RETURNING id`
    );
    console.log(`Soft-deleted ${emptyConvs.rowCount} empty conversations`);

    await client.query('COMMIT');

    // Final counts
    console.log('\n=== POST-CLEANUP COUNTS ===');
    const fLeads = await pool.query('SELECT COUNT(*) as c FROM leads WHERE deleted_at IS NULL');
    const fUsers = await pool.query('SELECT COUNT(*) as c FROM users WHERE deleted_at IS NULL');
    const fMsgs = await pool.query('SELECT COUNT(*) as c FROM chat_messages');
    const fConvs = await pool.query('SELECT COUNT(*) as c FROM chat_conversations WHERE is_deleted = FALSE');
    console.log('Leads:', fLeads.rows[0].c);
    console.log('Users:', fUsers.rows[0].c);
    console.log('Messages:', fMsgs.rows[0].c);
    console.log('Active Conversations:', fConvs.rows[0].c);
    console.log('\nCleanup complete. Database is production-ready.');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ROLLBACK - Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
})();
