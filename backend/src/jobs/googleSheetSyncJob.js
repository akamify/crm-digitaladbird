const logger = require('../utils/logger');
const userSheets = require('../services/userGoogleSheetsService');

const TICK_MS = 90_000;

async function tick() {
  try {
    await userSheets.processPendingSyncEvents({ limit: 25 });
    await userSheets.runAutoPullCycle({ limit: 5 });
  } catch (error) {
    logger.warn({ err: error.message }, '[GoogleSheetSync] background tick failed');
  }
}

function startGoogleSheetSyncJob() {
  logger.info('[GoogleSheetSync] controlled sync scheduler started (every 90s)');
  const timer = setInterval(() => tick().catch(() => {}), TICK_MS);
  timer.unref?.();
  return timer;
}

module.exports = { startGoogleSheetSyncJob, tick };
