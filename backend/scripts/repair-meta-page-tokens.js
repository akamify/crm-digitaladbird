require('dotenv').config();

const { closePool } = require('../src/config/database');
const metaTokens = require('../src/services/metaTokenResolver');
const metaSync = require('../src/services/metaSyncService');

async function inspectPage(page) {
  if (!page.page_access_token) return { page_id: page.page_id, status: 'missing' };
  try {
    const subscriptions = await metaSync.getPageSubscriptions(page.page_id);
    const apps = subscriptions.data || [];
    const subscribed = apps.some(app => Array.isArray(app.subscribed_fields) && app.subscribed_fields.includes('leadgen'));
    return { page_id: page.page_id, status: 'valid', subscribed };
  } catch (error) {
    await metaTokens.updatePageHealth(page.page_id, { valid: false, error: error.message });
    return { page_id: page.page_id, status: 'invalid', error: error.message };
  }
}

async function main() {
  const userToken = process.env.USER_TOKEN || null;
  const pages = await metaTokens.findActivePages();
  const before = [];
  for (const page of pages) before.push(await inspectPage(page));

  let repaired = [];
  if (userToken) {
    await metaTokens.validateUserTokenPermissions(userToken);
    repaired = await metaTokens.deriveAndSavePageTokenFromUserToken({ userToken });
    for (const page of repaired) await metaSync.subscribePageToLeadgen(page.page_id);
  }

  console.log(JSON.stringify({
    inspected: before,
    repaired_pages: repaired.map(page => ({ page_id: page.page_id, page_name: page.page_name })),
    note: userToken ? 'Page tokens repaired and leadgen subscriptions requested.' : 'Inspection only. Set USER_TOKEN to derive and save fresh Page Access Tokens.',
  }, null, 2));
}

main()
  .catch(error => {
    console.error(JSON.stringify({ success: false, code: error.code || 'REPAIR_FAILED', message: error.message }));
    process.exitCode = 1;
  })
  .finally(() => closePool());
