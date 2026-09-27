// Isolated integration database; never reads DATABASE_URL or production .env.
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = await new Promise(resolve => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const databaseDir = await mkdtemp(path.join(tmpdir(), 'crm-workflow-test-'));
const pg = new EmbeddedPostgres({ databaseDir, user: 'postgres', password: 'local-test-only', port, persistent: true });
let started = false;
try {
  await pg.initialise();
  await pg.start();
  started = true;
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/jest/bin/jest.js', '--runInBand', 'counselorWorkflow'], {
      cwd, stdio: 'inherit', windowsHide: true,
      env: { ...process.env, COUNSELOR_WORKFLOW_TEST_URL: `postgres://postgres:local-test-only@127.0.0.1:${port}/postgres` },
    });
    child.on('error', reject);
    child.on('exit', resolve);
  });
  process.exitCode = code ?? 1;
  if(code===0 && process.argv.includes('--recovery')) {
    const {verifyRecovery}=await import('./verify-workflow-recovery.mjs');
    // verifyRecovery stops the source before copying and stops its restored server.
    await verifyRecovery({databaseDir,port,server:pg,cwd});
    started=false;
  }
} finally {
  if (started) await pg.stop();
  console.log('Isolated test data retained at:', databaseDir);
}
