#!/usr/bin/env node
require('dotenv').config();
const { query, closePool } = require('../src/config/database');

async function run() {
  const { rows: duplicates } = await query(`
    SELECT UPPER(TRIM(cp_id)) AS normalized_cp_id,
           COUNT(*)::int AS count,
           ARRAY_AGG(id ORDER BY created_at) AS user_ids
      FROM users
     WHERE cp_id IS NOT NULL AND TRIM(cp_id) <> ''
     GROUP BY UPPER(TRIM(cp_id))
    HAVING COUNT(*) > 1
     ORDER BY UPPER(TRIM(cp_id))
  `);
  const { rows: [missing] } = await query(`
    SELECT COUNT(*)::int AS count
      FROM users
     WHERE cp_id IS NULL OR TRIM(cp_id) = ''
  `);

  console.log(JSON.stringify({ duplicate_groups: duplicates, missing_count: missing.count }, null, 2));
  if (duplicates.length) process.exitCode = 2;
}

run()
  .catch((error) => { console.error(`CP ID check failed: ${error.message}`); process.exitCode = 1; })
  .finally(() => closePool());
