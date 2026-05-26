/**
 * Seed real Meta (Facebook) page, form, and ad account data.
 * Run once: node src/db/seed_meta.js
 */
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/digitaladbird',
  connectionTimeoutMillis: 10000,
});

async function seedMeta() {
  const pageId = process.env.META_PAGE_ID || '220342467819979';
  const pageName = process.env.META_PAGE_NAME || 'Digital AdBird';
  const pageToken = process.env.META_PAGE_ACCESS_TOKEN;
  const formId = process.env.META_FORM_ID || '120234965746240243';
  const adAccounts = (process.env.META_AD_ACCOUNT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

  // 1. Upsert Meta page
  if (pageToken) {
    await pool.query(
      `INSERT INTO meta_pages(page_id, page_name, page_access_token, is_active)
       VALUES($1, $2, $3, TRUE)
       ON CONFLICT(page_id) DO UPDATE
         SET page_name = EXCLUDED.page_name,
             page_access_token = EXCLUDED.page_access_token,
             is_active = TRUE`,
      [pageId, pageName, pageToken]
    );
    console.log(`[Meta Seed] Page upserted: ${pageId} (${pageName})`);
  } else {
    console.warn('[Meta Seed] No META_PAGE_ACCESS_TOKEN set — skipping page upsert');
  }

  // 2. Upsert Meta form
  await pool.query(
    `INSERT INTO meta_forms(form_id, form_name, page_id, campaign_label, product_tag, is_active)
     VALUES($1, $2, $3, $4, $5, TRUE)
     ON CONFLICT(form_id) DO UPDATE
       SET form_name = EXCLUDED.form_name,
           campaign_label = EXCLUDED.campaign_label,
           is_active = TRUE`,
    [formId, 'Digital AdBird Lead Form', pageId, 'default', 'education']
  );
  console.log(`[Meta Seed] Form upserted: ${formId}`);

  // 3. Upsert ad accounts
  for (const accId of adAccounts) {
    await pool.query(
      `INSERT INTO meta_ad_accounts(account_id, account_name, is_active)
       VALUES($1, $2, TRUE)
       ON CONFLICT(account_id) DO UPDATE SET is_active = TRUE`,
      [accId, `Ad Account ${accId}`]
    );
    console.log(`[Meta Seed] Ad account upserted: ${accId}`);
  }

  console.log('[Meta Seed] Done!');
  await pool.end();
}

seedMeta().catch(e => {
  console.error('[Meta Seed] Error:', e.message);
  process.exit(1);
});
