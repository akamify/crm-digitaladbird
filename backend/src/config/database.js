/**
 * PostgreSQL connection pool wrapper.
 * In production: connects to a real PostgreSQL instance.
 * In development (when PG is unavailable): falls back to pg-mem (in-memory).
 *
 * Exposes:
 *   - query(sql, params)
 *   - getClient()          -> for manual checkout
 *   - withTransaction(fn)  -> auto BEGIN/COMMIT/ROLLBACK
 */
const { Pool } = require('pg');
const config = require('./env');
const logger = require('../utils/logger');

let pool;
let _query;
let _withTransaction;
let _closePool;

function createPgPool() {
  const p = new Pool({
    connectionString: config.db.url,
    ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
    max: config.db.poolMax,
    statement_timeout: config.db.statementTimeoutMs,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
    allowExitOnIdle: false,
  });

  // Pin every checked-out connection to IST. This guarantees that NOW(),
  // CURRENT_DATE, AGE(), and any timestamp formatting (e.g. JSON serialization
  // of TIMESTAMPTZ) return India time regardless of the cluster's default tz.
  // Runs once per new physical connection — the pool reuses connections so
  // there's no per-query overhead. PROCESS_TZ env can override (default IST).
  const SESSION_TZ = process.env.PROCESS_TZ || 'Asia/Kolkata';
  p.on('connect', async (client) => {
    try { await client.query(`SET TIME ZONE '${SESSION_TZ}'`); }
    catch (err) { logger.warn({ err: err.message }, '[pg] failed to set session timezone'); }
  });

  p.on('error', (err) => {
    logger.error({ err }, 'Unexpected error on idle pg client');
  });

  // Warm the pool on startup — pre-create connections
  const warmCount = Math.min(3, config.db.poolMax);
  const warmPool = async () => {
    const clients = [];
    for (let i = 0; i < warmCount; i++) {
      try { clients.push(await p.connect()); } catch { break; }
    }
    clients.forEach(c => c.release());
  };
  warmPool().catch(() => {});

  return p;
}

async function tryConnect(pgPool, attempt) {
  try {
    await pgPool.query('SELECT 1');
    return true;
  } catch (err) {
    if (attempt < 5) {
      logger.warn({ attempt, err: err.message }, 'PG connection attempt failed, retrying...');
      await new Promise(r => setTimeout(r, 2000));
      return tryConnect(pgPool, attempt + 1);
    }
    throw err;
  }
}

async function initDb() {
  // Try real PostgreSQL first
  try {
    const pgPool = createPgPool();
    // Test the connection with retries
    await tryConnect(pgPool, 1);
    logger.info('Connected to PostgreSQL successfully');
    pool = pgPool;

    _query = async function query(text, params) {
      const start = Date.now();
      try {
        const res = await pool.query(text, params);
        if (config.env !== 'production') {
          logger.debug({ ms: Date.now() - start, rows: res.rowCount, sql: text.slice(0, 80) }, 'pg query');
        }
        return res;
      } catch (err) {
        logger.error({ err, sql: text }, 'pg query failed');
        throw err;
      }
    };

    _withTransaction = async function withTransaction(fn) {
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
    };

    _closePool = async function closePool() {
      await pool.end();
    };

  } catch (err) {
    // In production, NEVER fall back to in-memory — fail fast
    if (config.env === 'production') {
      logger.fatal({ err: err.message }, 'PostgreSQL connection failed in production — aborting');
      throw err;
    }

    logger.warn({ err: err.message }, 'PostgreSQL unavailable — falling back to pg-mem (in-memory database)');
    logger.warn('⚠️  Data will NOT persist between restarts. Install PostgreSQL for production use.');

    // Fall back to pg-mem (dev only)
    const memDb = require('./database-mem');
    pool = memDb.pool;
    _query = memDb.query;
    _withTransaction = memDb.withTransaction;
    _closePool = memDb.closePool;
  }
}

// Initialize synchronously using a module-level promise
// All callers will await this before running queries
let _initPromise = null;

function getInitPromise() {
  if (!_initPromise) {
    _initPromise = initDb();
  }
  return _initPromise;
}

// Initialize immediately
getInitPromise().catch(err => {
  logger.error({ err }, 'Database initialization failed');
  process.exit(1);
});

async function query(text, params) {
  await getInitPromise();
  return _query(text, params);
}

async function withTransaction(fn) {
  await getInitPromise();
  return _withTransaction(fn);
}

async function closePool() {
  if (_closePool) await _closePool();
}

async function getPool() {
  await getInitPromise();
  return pool;
}

module.exports = { get pool() { return pool; }, query, withTransaction, closePool, getPool };
