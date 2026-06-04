#!/usr/bin/env node
/**
 * One-shot recovery for missed Meta leads.
 *
 * Walks every form in meta_forms, resolves the owning page's access token
 * from meta_pages, fetches /<form_id>/leads?since=<N hours ago> via Graph
 * API, and runs each result through the same ingest path the webhook uses
 * (ingestGraphLead) — so deduplication, distribution, Socket.IO broadcast,
 * and Google Sheet append all happen automatically.
 *
 * USAGE — run on the VPS (or wherever the live DATABASE_URL points):
 *
 *   cd backend
 *   node scripts/recover-meta-leads.js                  # default: last 48h
 *   HOURS_BACK=24  node scripts/recover-meta-leads.js
 *   FORM_ID=12345  node scripts/recover-meta-leads.js   # just one form
 *
 * Output: per-form summary (fetched / created / duplicate / error) and a
 * grand total at the end. Exits non-zero only on fatal config errors —
 * per-form failures are logged and the script continues.
 */
require('dotenv').config();
const { query, withTransaction } = require('../src/config/database');
const axios = require('axios');
const config = require('../src/config/env');
const logger = require('../src/utils/logger');
const { findExistingByContact } = require('../src/services/leadEventService');
const { onLeadCreated } = require('../src/services/leadEventService');
const { assignLead } = require('../src/services/leadDistributionService');
const { isDistributionActive } = require('../src/services/distributionScheduler');
const {
  ingestGraphLead, // sync-path ingest with full attribution + dedup
  deriveCampaignLabel,
} = require('../src/services/metaSyncService');

const GRAPH = `https://graph.facebook.com/${config.meta.graphVersion}`;
const HOURS_BACK = Number(process.env.HOURS_BACK || '48');
const SINCE = Math.floor((Date.now() - HOURS_BACK * 60 * 60 * 1000) / 1000);
const ONE_FORM = process.env.FORM_ID || null;

function log(line) { process.stdout.write(line + '\n'); }
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const amber = (s) => `\x1b[33m${s}\x1b[0m`;

async function listFormsWithTokens() {
  // meta_forms doesn't have deleted_at — soft delete uses is_active.
  const sql = `
    SELECT f.form_id, f.form_name, f.page_id, p.page_access_token, p.page_name
      FROM meta_forms f
      LEFT JOIN meta_pages p ON p.page_id = f.page_id AND p.is_active = TRUE
     WHERE COALESCE(f.is_active, TRUE) = TRUE
     ${ONE_FORM ? 'AND f.form_id = $1' : ''}
  `;
  const params = ONE_FORM ? [ONE_FORM] : [];
  const { rows } = await query(sql, params);
  return rows;
}

// If meta_forms is empty (or none for the requested PAGE_ID), discover them
// from Graph directly using each active page's token. Populates meta_forms
// as a side-effect so future recoveries don't need this step.
async function discoverFormsForActivePages() {
  const ONE_PAGE = process.env.PAGE_ID || null;
  const sql = ONE_PAGE
    ? `SELECT page_id, page_name, page_access_token FROM meta_pages WHERE is_active=TRUE AND page_id=$1`
    : `SELECT page_id, page_name, page_access_token FROM meta_pages WHERE is_active=TRUE`;
  const params = ONE_PAGE ? [ONE_PAGE] : [];
  const { rows: pages } = await query(sql, params);
  const out = [];
  for (const p of pages) {
    if (!p.page_access_token) continue;
    try {
      const r = await axios.get(`${GRAPH}/${p.page_id}/leadgen_forms`, {
        params: { access_token: p.page_access_token, fields: 'id,name,status', limit: 50 },
        timeout: 20000,
      });
      const forms = r.data?.data || [];
      for (const f of forms) {
        await query(
          `INSERT INTO meta_forms(form_id, form_name, page_id) VALUES($1,$2,$3)
             ON CONFLICT (form_id) DO UPDATE SET form_name=EXCLUDED.form_name, page_id=EXCLUDED.page_id`,
          [f.id, f.name || null, p.page_id]
        );
        out.push({ form_id: f.id, form_name: f.name, page_id: p.page_id, page_access_token: p.page_access_token, page_name: p.page_name });
      }
      log(`  discovered ${forms.length} forms on page ${p.page_name || p.page_id}`);
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      log(red(`  page ${p.page_id} (${p.page_name || '?'}): Graph error — ${msg}`));
    }
  }
  return out;
}

async function fetchFormLeadsSince(formId, token) {
  // Use Graph's time_created GREATER_THAN filter and walk pagination.
  const out = [];
  let url = `${GRAPH}/${formId}/leads`;
  let params = {
    access_token: token,
    fields: 'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data,platform',
    limit: 100,
  };
  // HOURS_BACK=0 means "fetch ALL historical leads, no time filter" — first-time full backfill.
  if (HOURS_BACK > 0) {
    params.filtering = JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: SINCE }]);
  }
  let pages = 0;
  while (url && pages < 200) {
    const resp = await axios.get(url, { params, timeout: 30000 });
    out.push(...(resp.data?.data || []));
    url = resp.data?.paging?.next || null;
    params = {}; // `next` URL already has all params baked in
    pages++;
  }
  return out;
}

(async () => {
  const startedAt = new Date().toISOString();
  log(bold('\n== Meta lead recovery =='));
  log(`Started:    ${startedAt}`);
  log(`HOURS_BACK: ${HOURS_BACK} (since unix ${SINCE} = ${new Date(SINCE * 1000).toISOString()})`);
  log(`FORM_ID:    ${ONE_FORM || '(all forms)'}`);

  let forms = await listFormsWithTokens();

  // If meta_forms hasn't been populated, or the user is targeting a specific
  // PAGE_ID that has no forms in DB, walk Graph and discover them.
  // Set DISCOVER=1 to force re-discovery even if DB has rows.
  if (!forms.length || process.env.DISCOVER === '1') {
    log(amber('\nNo forms in meta_forms (or DISCOVER=1) — discovering via Graph using active page tokens...'));
    forms = await discoverFormsForActivePages();
    if (!forms.length) {
      log(red('\nNo forms discoverable. Either meta_pages has no active page with a working token, or none of those pages have leadgen forms.'));
      process.exit(1);
    }
  }
  log(`Forms to scan: ${forms.length}`);

  const grand = { fetched: 0, created: 0, duplicate: 0, errors: 0, skipped_no_token: 0 };
  for (const f of forms) {
    const tag = `[${f.form_name || '?'} / form_id=${f.form_id} / page=${f.page_name || f.page_id || '?'}]`;
    if (!f.page_access_token) {
      log(amber(`\n${tag}  SKIP — no active page token in meta_pages for page_id=${f.page_id}`));
      grand.skipped_no_token++;
      continue;
    }

    log(bold(`\n${tag}`));

    let leads = [];
    try {
      leads = await fetchFormLeadsSince(f.form_id, f.page_access_token);
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      log(red(`  ✘ Graph fetch failed: ${msg}`));
      grand.errors++;
      continue;
    }
    log(`  Fetched from Graph:  ${leads.length}`);
    grand.fetched += leads.length;

    let created = 0, duplicate = 0, err = 0;
    for (const lead of leads) {
      try {
        const r = await ingestGraphLead(lead, f.form_id);
        if (r.status === 'created') created++;
        else if (r.status === 'duplicate') duplicate++;
      } catch (e) {
        err++;
        logger.warn({ leadgenId: lead.id, err: e.message }, '[recovery] ingestGraphLead failed');
      }
    }
    log(`  ${green('✔ created:')}     ${created}`);
    log(`  ${amber('· duplicate:')}   ${duplicate}`);
    if (err) log(`  ${red('✘ errors:')}      ${err}`);
    grand.created += created; grand.duplicate += duplicate; grand.errors += err;
  }

  log(bold('\n== Recovery summary =='));
  log(`Fetched from Graph:   ${grand.fetched}`);
  log(`${green('Created in CRM:')}      ${grand.created}`);
  log(`${amber('Duplicate skipped:')}   ${grand.duplicate}   (already in DB or matched within dedup window)`);
  log(`${red('Errors:')}              ${grand.errors}`);
  log(`Forms skipped (no token): ${grand.skipped_no_token}`);
  log('');
  log('Next:');
  log('  • Hard-refresh the admin dashboard — counters bump live via Socket.IO,');
  log('    but a refresh clears any stale React Query cache.');
  log('  • If "Duplicate skipped" >> "Created" and you expected more new leads,');
  log('    your dedup window may still be filtering them. Try:');
  log('      LEAD_DEDUP_WINDOW_DAYS=0 node scripts/recover-meta-leads.js');
  log('    to recover even leads whose phone exists historically. Then');
  log('    restart pm2 with the desired permanent value.');
  log('');

  process.exit(grand.errors > 0 && grand.created === 0 ? 1 : 0);
})().catch((err) => {
  console.error('\nFATAL:', err.message);
  console.error(err.stack);
  process.exit(2);
});
