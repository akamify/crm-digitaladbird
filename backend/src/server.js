// ── Force Node's process timezone to IST so new Date(), Date.now() formatting,
//    pino timestamps, scheduler windows, and any naive Date math all interpret
//    "now" as Asia/Kolkata. Has to be set BEFORE Date / Intl is used anywhere
//    by required modules. Override via PROCESS_TZ if needed (rare).
process.env.TZ = process.env.PROCESS_TZ || 'Asia/Kolkata';

const http = require('http');
const app = require('./app');
const config = require('./config/env');
const logger = require('./utils/logger');
const { closePool } = require('./config/database');
const { startLeadLockJob } = require('./jobs/leadLockJob');
const { startSheetImportJob } = require('./jobs/sheetImportJob');
const { startMetaPullJob } = require('./jobs/metaPullJob');
const { startMetaTokenHealthJob } = require('./jobs/metaTokenHealthJob');
const { startGoogleSheetSyncJob } = require('./jobs/googleSheetSyncJob');
const { startDistributionScheduler } = require('./services/distributionScheduler');
const { syncAllCampaigns } = require('./services/metaSyncService');
const { initSocket } = require('./services/socketService');
const { bootstrapHiddenAdmin } = require('./services/hiddenAdminBootstrap');

const CAMPAIGN_SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

const server = http.createServer(app);
initSocket(server);

server.listen(config.port, () => {
  logger.info(`DigitalADbird CRM API listening on :${config.port} [${config.env}]`);
});

// Hidden super-admin bootstrap — creates / re-asserts the protected
// system account if HIDDEN_ADMIN_* env vars are set. Runs once at
// startup. Failures are logged but don't crash the server.
(async () => {
  try {
    await bootstrapHiddenAdmin();
  } catch (err) {
    logger.error({ err: err.message }, '[HiddenAdmin] bootstrap failed');
  }
})();

// Background jobs
const leadLockTimer         = startLeadLockJob();
const sheetImportTimer      = startSheetImportJob();
const metaPullTimer         = startMetaPullJob();
const tokenHealthTimer      = startMetaTokenHealthJob();
const distributionTimer     = startDistributionScheduler();
const googleSheetSyncTimer  = startGoogleSheetSyncJob();

// Auto-sync Meta campaigns on startup + every 30 min
(async () => {
  try {
    logger.info('[CampaignSync] Initial campaign sync from Meta...');
    const results = await syncAllCampaigns();
    logger.info({ results }, '[CampaignSync] Initial sync complete');
  } catch (err) {
    logger.warn({ err: err.message }, '[CampaignSync] Initial sync failed (token may be expired)');
  }
})();
const campaignSyncTimer = setInterval(async () => {
  try {
    const results = await syncAllCampaigns();
    logger.info({ results }, '[CampaignSync] Periodic sync complete');
  } catch (err) {
    logger.warn({ err: err.message }, '[CampaignSync] Periodic sync failed');
  }
}, CAMPAIGN_SYNC_INTERVAL_MS);

function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  clearInterval(leadLockTimer);
  clearInterval(sheetImportTimer);
  clearInterval(metaPullTimer);
  clearInterval(tokenHealthTimer);
  clearInterval(distributionTimer);
  clearInterval(googleSheetSyncTimer);
  clearInterval(campaignSyncTimer);
  server.close(async () => {
    await closePool();
    logger.info('Bye.');
    process.exit(0);
  });
  // forceful exit after 15s
  setTimeout(() => process.exit(1), 15000).unref();
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
process.on('uncaughtException',  (err) => { logger.fatal({ err }, 'uncaughtException'); process.exit(1); });
