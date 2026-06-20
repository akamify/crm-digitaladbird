const config = require('../config/env');
const logger = require('../utils/logger');
const metaTokens = require('../services/metaTokenResolver');
const { graphGet, graphDebugToken } = require('../services/metaGraphClient');

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

async function checkOnePageToken(page) {
  if (!page.page_access_token) {
    await metaTokens.updatePageHealth(page.page_id, { valid: null, error: 'no page access token stored' });
    return { page_id: page.page_id, status: 'missing' };
  }
  try {
    await graphGet(page.page_id, { fields: 'id,name' }, page.page_access_token, {
      pageId: page.page_id,
      tokenSource: 'db_page_token',
    });
    await metaTokens.updatePageHealth(page.page_id, { valid: true });
    return { page_id: page.page_id, status: 'valid' };
  } catch (error) {
    await metaTokens.updatePageHealth(page.page_id, { valid: false, error: error.message });
    return { page_id: page.page_id, status: 'invalid', error: error.message };
  }
}

async function checkUserToken() {
  const resolved = await metaTokens.getUserToken();
  if (!resolved) return { status: 'missing', source: null };
  const appToken = config.meta.appId && config.meta.appSecret
    ? `${config.meta.appId}|${config.meta.appSecret}`
    : resolved.token;
  try {
    const response = await graphDebugToken(resolved.token, appToken);
    const data = response.data || response;
    const result = {
      status: data.is_valid === false ? 'expired' : 'valid',
      source: resolved.source,
      expires_at: data.expires_at ? new Date(data.expires_at * 1000).toISOString() : null,
    };
    await metaTokens.updateUserTokenStatus(result).catch(() => {});
    return result;
  } catch (error) {
    const result = { status: error.isOAuthError ? 'expired' : 'error', source: resolved.source, error: error.message };
    await metaTokens.updateUserTokenStatus(result).catch(() => {});
    return result;
  }
}

async function tickOnce() {
  const pages = await metaTokens.findActivePages();
  const pageResults = [];
  for (const page of pages) pageResults.push(await checkOnePageToken(page));
  const userToken = await checkUserToken();
  logger.info({
    pages_checked: pageResults.length,
    pages_valid: pageResults.filter(result => result.status === 'valid').length,
    user_token_status: userToken.status,
  }, '[TokenHealth] tick complete');
  return { pages: pageResults, userToken };
}

function startMetaTokenHealthJob() {
  logger.info('[TokenHealth] starting Meta token health monitor (every 15 min)');
  tickOnce().catch(error => logger.error({ err: error.message }, '[TokenHealth] initial tick failed'));
  const timer = setInterval(() => {
    tickOnce().catch(error => logger.error({ err: error.message }, '[TokenHealth] tick failed'));
  }, CHECK_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { startMetaTokenHealthJob, tickOnce, checkUserToken };
