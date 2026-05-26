/**
 * Plain-SQL migrator. Reads .sql files in /db/migrations alphabetically
 * and runs the ones not yet recorded in schema_migrations.
 *
 *   node src/db/migrate.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, withTransaction, closePool } = require('../config/database');
const logger = require('../utils/logger');

async function run() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  const { rows: done } = await query(`SELECT filename FROM schema_migrations`);
  const doneSet = new Set(done.map(r => r.filename));

  for (const f of files) {
    if (doneSet.has(f)) { logger.info(`SKIP ${f}`); continue; }
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await withTransaction(async (client) => {
      logger.info(`APPLY ${f}`);
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations(filename) VALUES ($1)`, [f]);
    });
  }
  logger.info('Migrations complete.');
  await closePool();
}
run().catch((e) => { logger.error({ e }, 'Migration failed'); process.exit(1); });
