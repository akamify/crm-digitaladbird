const { query } = require('../src/config/database');

async function main() {
  const { rows: [summary] } = await query(`
    SELECT COUNT(*)::int AS total
      FROM leads l
      JOIN users u ON u.id = l.assigned_to_user_id
     WHERE l.deleted_at IS NULL
       AND u.deleted_at IS NULL
       AND u.role = 'rm'
  `);

  const { rows } = await query(`
    SELECT l.id AS lead_id,
           l.full_name AS lead_name,
           l.phone AS lead_phone,
           l.assigned_at,
           l.created_at,
           u.id AS rm_id,
           u.full_name AS rm_name,
           u.email AS rm_email
      FROM leads l
      JOIN users u ON u.id = l.assigned_to_user_id
     WHERE l.deleted_at IS NULL
       AND u.deleted_at IS NULL
       AND u.role = 'rm'
     ORDER BY l.assigned_at DESC NULLS LAST, l.created_at DESC
     LIMIT 200
  `);

  console.log(JSON.stringify({
    success: true,
    total: Number(summary?.total || 0),
    returned: rows.length,
    note: 'Read-only report. Reassign these leads manually through the existing reassignment workflow if needed.',
    rows,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    success: false,
    error: err.message,
  }, null, 2));
  process.exitCode = 1;
});
