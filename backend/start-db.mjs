/**
 * Embedded PostgreSQL startup script for development.
 * Uses embedded-postgres to start a local PostgreSQL instance.
 * Run: node start-db.mjs
 */
import EmbeddedPostgres from 'embedded-postgres';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_DIR = path.join(__dirname, 'data', 'pgdata');
const PG_PORT = 5433;
const PG_USER = 'postgres';
const PG_PASSWORD = 'postgres';
const DB_NAME = 'digitaladbird';

// Ensure data directory exists
fs.mkdirSync(DB_DIR, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: DB_DIR,
  user: PG_USER,
  password: PG_PASSWORD,
  port: PG_PORT,
  persistent: true,
});

async function main() {
  console.log('[db] Initializing embedded PostgreSQL...');

  try {
    await pg.initialise();
  } catch (e) {
    // Already initialized - that's fine
    if (!e.message?.includes('already exists') && !e.message?.includes('initdb')) {
      console.log('[db] Init note:', e.message);
    }
  }

  console.log('[db] Starting PostgreSQL on port', PG_PORT, '...');
  await pg.start();
  console.log('[db] PostgreSQL started!');

  // Create the database if it doesn't exist
  try {
    await pg.createDatabase(DB_NAME);
    console.log('[db] Created database:', DB_NAME);
  } catch (e) {
    // Database may already exist
    console.log('[db] Database note:', e.message?.split('\n')[0]);
  }

  console.log('[db] Running migrations...');
  await runMigrations();

  console.log('[db] Starting backend server...');
  startBackend();
}

function runMigrations() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['src/db/migrate.js'], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, DATABASE_URL: `postgres://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${DB_NAME}` }
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('Migration failed with code ' + code));
    });
  });
}

function startBackend() {
  const proc = spawn('node', ['src/server.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: `postgres://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${DB_NAME}` }
  });

  proc.on('close', async (code) => {
    console.log('[db] Backend exited with code', code);
    await pg.stop();
    process.exit(code);
  });
}

// Graceful shutdown
async function shutdown() {
  console.log('\n[db] Shutting down...');
  try {
    await pg.stop();
  } catch (e) {
    // ignore
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(async (err) => {
  console.error('[db] Fatal error:', err.message);
  try {
    await pg.stop();
  } catch (e) {
    // ignore
  }
  process.exit(1);
});
