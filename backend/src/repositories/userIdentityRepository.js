const { query } = require('../config/database');

async function findByCpId(cpId, excludeUserId = null) {
  const { rows } = await query(
    `SELECT id FROM users
      WHERE UPPER(cp_id) = $1
        AND ($2::uuid IS NULL OR id <> $2::uuid)
      LIMIT 1`,
    [cpId, excludeUserId],
  );
  return rows[0] || null;
}

module.exports = { findByCpId };
