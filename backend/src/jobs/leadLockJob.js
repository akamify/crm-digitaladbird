const { query } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Periodically clears expired locked_until on leads so the next member
 * (or auto-distributor) can pick them up. Runs every 30 seconds.
 */
function startLeadLockJob() {
  const tick = async () => {
    try {
      const { rowCount } = await query(
        `UPDATE leads
            SET locked_by_user_id = NULL, locked_until = NULL
          WHERE locked_until IS NOT NULL AND locked_until < NOW()`
      );
      if (rowCount > 0) logger.info({ released: rowCount }, 'Expired lead locks released');
    } catch (err) {
      logger.error({ err }, 'leadLockJob failed');
    }
  };
  // run once on boot, then every 30s
  tick();
  return setInterval(tick, 30_000);
}

module.exports = { startLeadLockJob };
