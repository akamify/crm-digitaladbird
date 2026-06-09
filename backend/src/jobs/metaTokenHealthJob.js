/**
 * Periodic Meta token health monitor.
 *
 * Every 15 minutes: for each active meta_pages row, call Meta's
 * /debug_token endpoint and update meta_pages.token_* columns.
 *
 * Why a periodic check vs UI-test-only?
 *   - The UI badge was being cached on the React side from a test
 *     button click weeks ago. Owners saw green even when tokens were
 *     long-expired. Real leads stopped flowing for days unnoticed.
 *   - With this job, the admin UI reflects DB-stored truth that's
 *     never more than 15 minutes stale.
 *   - Operator can now alert / monitor by querying meta_pages
 *     WHERE is_active AND token_is_valid = FALSE.
 *
 * Token validity is determined by Meta's debug_token response:
 *   is_valid: true   -> token_is_valid = TRUE
 *   is_valid: false  -> token_is_valid = FALSE
 *   network failure  -> token_is_valid = NULL (so we don't flip green
 *                       to red because of a transient outage)
 *
 * No retries / no alerting fan-out — caller layers (admin UI, future
 * Slack/email alerts) read meta_pages.token_is_valid and surface the
 * state.
 */
const { query } = require('../config/database');
const logger = require('../utils/logger');

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

async function checkOnePageToken(page, appAccessToken) {
  if (!page.page_access_token) {
    await markUnknown(page.page_id, 'no access_token stored');
    return;
  }
  try {
    const url = `https://graph.facebook.com/v21.0/debug_token`
      + `?input_token=${page.page_access_token}`
      + `&access_token=${encodeURIComponent(appAccessToken)}`;
    const r = await fetch(url);
    const j = await r.json();
    if (!j.data) {
      const errMsg = j.error?.message || 'unknown error';
      await markInvalid(page.page_id, errMsg);
      logger.warn({ pageId: page.page_id, error: errMsg }, '[TokenHealth] debug_token returned no data');
      return;
    }
    const d = j.data;
    const expiresAt = d.expires_at ? new Date(d.expires_at * 1000) : null;
    const isValid = d.is_valid === true;
    const errMsg = d.error?.message || (isValid ? null : 'token marked invalid');
    await query(
      `UPDATE meta_pages SET
         token_last_checked = NOW(),
         token_is_valid     = $1,
         token_expires_at   = $2,
         token_last_error   = $3,
         updated_at         = NOW()
       WHERE page_id = $4`,
      [isValid, expiresAt, errMsg, page.page_id]
    );
    if (!isValid) {
      logger.warn({
        pageId: page.page_id, pageName: page.page_name,
        expiresAt, error: errMsg,
      }, '[TokenHealth] page token INVALID — webhook lead fetches will fail');
    }
  } catch (err) {
    // Network/transient — DON'T flip green→red. Keep last_checked
    // updated so we know we tried, but leave token_is_valid alone.
    logger.warn({ pageId: page.page_id, err: err.message }, '[TokenHealth] check failed (network)');
    await query(
      `UPDATE meta_pages SET token_last_checked = NOW(), token_last_error = $1
        WHERE page_id = $2`,
      [err.message.slice(0, 500), page.page_id]
    );
  }
}

async function markInvalid(pageId, reason) {
  await query(
    `UPDATE meta_pages SET token_last_checked = NOW(),
                          token_is_valid = FALSE,
                          token_last_error = $1
      WHERE page_id = $2`,
    [reason, pageId]
  );
}

async function markUnknown(pageId, reason) {
  await query(
    `UPDATE meta_pages SET token_last_checked = NOW(),
                          token_is_valid = NULL,
                          token_last_error = $1
      WHERE page_id = $2`,
    [reason, pageId]
  );
}

async function tickOnce() {
  const APP_ID = process.env.META_APP_ID;
  const APP_SEC = process.env.META_APP_SECRET;
  if (!APP_ID || !APP_SEC) {
    logger.warn('[TokenHealth] META_APP_ID/META_APP_SECRET missing — skipping check');
    return;
  }
  const appToken = `${APP_ID}|${APP_SEC}`;
  const { rows: pages } = await query(
    `SELECT page_id, page_name, page_access_token FROM meta_pages WHERE is_active = TRUE`
  );
  if (pages.length === 0) return;
  for (const p of pages) {
    await checkOnePageToken(p, appToken);
  }
  logger.info({ checked: pages.length }, '[TokenHealth] tick complete');
}

function startMetaTokenHealthJob() {
  logger.info('[TokenHealth] starting Meta token health monitor (every 15 min)');
  // Run once at startup so admins see fresh data immediately
  tickOnce().catch(err => logger.error({ err: err.message }, '[TokenHealth] initial tick failed'));
  const timer = setInterval(() => {
    tickOnce().catch(err => logger.error({ err: err.message }, '[TokenHealth] tick failed'));
  }, CHECK_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { startMetaTokenHealthJob, tickOnce };
