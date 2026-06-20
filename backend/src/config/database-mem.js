/**
 * In-memory PostgreSQL adapter using pg-mem.
 * Used when a real PostgreSQL server is not available (local dev).
 * Provides the same interface as database.js: query, withTransaction, closePool.
 */
const { newDb } = require('pg-mem');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Create the in-memory DB instance
const db = newDb();

// Register gen_random_uuid() since pgcrypto is not available
db.public.registerFunction({
  name: 'gen_random_uuid',
  returns: 'uuid',
  implementation: () => require('crypto').randomUUID(),
});

// Create pg-compatible Pool/Client classes
const { Pool } = db.adapters.createPg();
const pool = new Pool();

// Run the pg-mem compatible schema
function initSchema() {
  const schemaPath = path.join(__dirname, '../db/schema_mem.sql');
  if (!fs.existsSync(schemaPath)) {
    logger.warn('pg-mem schema file not found:', schemaPath);
    return;
  }
  const sql = fs.readFileSync(schemaPath, 'utf8')
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
  // Split on semicolons, filter empty, run each
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  let ok = 0;
  let skip = 0;
  for (const stmt of statements) {
    try {
      db.public.none(stmt + ';');
      ok++;
    } catch (err) {
      // Ignore "already exists" errors
      if (
        err.message?.includes('already exists') ||
        err.message?.includes('duplicate') ||
        err.message?.includes('ALREADY_EXISTS')
      ) {
        skip++;
      } else {
        logger.warn({ err: err.message, sql: stmt.slice(0, 80) }, 'pg-mem schema statement skipped');
        skip++;
      }
    }
  }
  logger.info({ ok, skip }, 'pg-mem schema initialized');
}

// Initialize schema
initSchema();

// Seed a default admin user if none exists
async function seedAdminIfNeeded() {
  try {
    const { rows } = await query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (rows.length === 0) {
      const bcrypt = require('bcryptjs');
      const passwordHash = await bcrypt.hash('admin123', 10);
      await query(
        `INSERT INTO users (emp_code, cp_id, full_name, email, phone, role, status, password_hash)
         VALUES ('DEV-ADMIN', 'DEV-ADMIN', $1, $2, $3, $4, $5, $6)`,
        ['Admin User', 'admin@digitaladbird.com', '+919999999999', 'admin', 'active', passwordHash]
      );
      logger.info('Seeded default admin user: phone=+919999999999, OTP will be shown in console');
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not seed admin user');
  }
}

async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    logger.debug({ ms: Date.now() - start, rows: res.rowCount, sql: text.slice(0, 80) }, 'pg-mem query');
    return res;
  } catch (err) {
    logger.error({ err: err.message, sql: text }, 'pg-mem query failed');
    throw err;
  }
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function closePool() {
  // No-op for in-memory DB
}

// Seed on next tick so the server is ready first
setImmediate(() => seedAdminIfNeeded().catch(() => {}));

logger.info('Using pg-mem (in-memory PostgreSQL) — data will be lost on restart');

module.exports = { pool, query, withTransaction, closePool };
