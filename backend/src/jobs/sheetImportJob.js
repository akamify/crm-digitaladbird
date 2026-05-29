/**
 * Auto-import job — runs every 60s. Each integration_configs row with
 * auto_import_enabled=true gets imported when at least its configured
 * `auto_import_minutes` have passed since `last_import_at`.
 */
const { query } = require('../config/database');
const logger    = require('../utils/logger');
const sheetImport = require('../services/sheetImportService');

let _running = false;

async function tick() {
  if (_running) return; // never overlap — long imports just skip the next tick
  _running = true;
  try {
    const { rows } = await query(
      `SELECT id, label, auto_import_minutes, last_import_at
         FROM integration_configs
        WHERE kind = 'google_sheets'
          AND auto_import_enabled = TRUE
          AND secrets_encrypted IS NOT NULL`,
    );
    const now = Date.now();
    for (const c of rows) {
      const dueMs = c.last_import_at
        ? new Date(c.last_import_at).getTime() + c.auto_import_minutes * 60_000
        : 0;
      if (dueMs > now) continue;
      try {
        logger.info({ configId: c.id, label: c.label }, '[SheetImport/auto] running');
        const stats = await sheetImport.importFromConfig({
          configId:    c.id,
          triggeredBy: 'auto',
          userId:      null,
          assign:      true,
          maxRows:     5000,
        });
        logger.info({ configId: c.id, ...stats }, '[SheetImport/auto] complete');
      } catch (err) {
        logger.error({ configId: c.id, err: err.message }, '[SheetImport/auto] failed');
      }
    }
  } finally {
    _running = false;
  }
}

function startSheetImportJob() {
  logger.info('[SheetImport] Auto-import scheduler started (every 60s, per-config interval)');
  // Kick once on boot so a freshly enabled config doesn't wait a full minute
  setTimeout(() => tick().catch(() => {}), 5_000);
  return setInterval(() => tick().catch(() => {}), 60_000);
}

module.exports = { startSheetImportJob };
