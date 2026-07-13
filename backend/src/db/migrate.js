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

const NO_TRANSACTION_MIGRATIONS = new Set([
  '002_roles_and_categories.sql',
  '006_call_status_update.sql',
  '012_partner_role_and_cpid.sql',
  '038_user_lifecycle_role_simplification.sql',
  '046_lead_call_log_outcomes.sql',
  '057_workflow_step2_multiselect_and_call_cut_busy.sql',
]);

function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  let quote = null;
  let dollarTag = null;
  let lineComment = false;
  let blockComment = false;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      current += ch;
      if (ch === '\n') lineComment = false;
      i++;
      continue;
    }

    if (blockComment) {
      current += ch;
      if (ch === '*' && next === '/') {
        current += next;
        blockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (dollarTag) {
      current += ch;
      if (sql.startsWith(dollarTag, i)) {
        current += sql.slice(i + 1, i + dollarTag.length);
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      i++;
      continue;
    }

    if (quote) {
      current += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          current += sql[i + 1];
          i += 2;
          continue;
        }
        quote = null;
      }
      i++;
      continue;
    }

    if (ch === '-' && next === '-') {
      current += ch + next;
      lineComment = true;
      i += 2;
      continue;
    }

    if (ch === '/' && next === '*') {
      current += ch + next;
      blockComment = true;
      i += 2;
      continue;
    }

    if (ch === "'" || ch === '"') {
      current += ch;
      quote = ch;
      i++;
      continue;
    }

    if (ch === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }

    if (ch === ';') {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const last = current.trim();
  if (last) statements.push(last);

  return statements;
}

async function runSqlAutocommit(sql, filename) {
  const statements = splitSqlStatements(sql);

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    logger.debug({ filename, statement: i + 1 }, 'migration statement');
    await query(statement);
  }
}

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
    if (doneSet.has(f)) {
      logger.info(`SKIP ${f}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    logger.info(`APPLY ${f}`);

    if (NO_TRANSACTION_MIGRATIONS.has(f)) {
      await runSqlAutocommit(sql, f);
      await query(`INSERT INTO schema_migrations(filename) VALUES ($1)`, [f]);
      continue;
    }

    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations(filename) VALUES ($1)`, [f]);
    });
  }

  logger.info('Migrations complete.');
  await closePool();
}

run().catch((e) => {
  logger.error({ e }, 'Migration failed');
  process.exit(1);
});

