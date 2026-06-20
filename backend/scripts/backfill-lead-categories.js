const { query } = require('../src/config/database');
const { resolveLeadCategory } = require('../src/services/leadCategory/leadCategoryResolver');
const repository = require('../src/repositories/leadCategoryRepository');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const campaignArg = args.find(arg => arg.startsWith('--campaign-id='));
const campaignId = campaignArg ? campaignArg.slice('--campaign-id='.length) : null;

async function main() {
  const params = [];
  let where = `WHERE deleted_at IS NULL`;
  if (!force) where += ` AND (category IS NULL OR category = '' OR category = 'unknown')`;
  if (campaignId) { params.push(campaignId); where += ` AND meta_campaign_id = $${params.length}`; }
  const { rows } = await query(
    `SELECT id, category, category_source, meta_campaign_id, meta_form_id, meta_page_id,
            campaign_name, form_name, raw_payload
       FROM leads ${where} ORDER BY created_at ASC`,
    params,
  );

  const summary = { scanned: rows.length, updated_trader: 0, updated_partner: 0, unchanged: 0, unresolved_unknown: 0 };
  for (const lead of rows) {
    const resolution = await resolveLeadCategory({ leadPayload: { ...(lead.raw_payload || {}), ...lead }, existingLead: lead });
    if (resolution.category === 'unknown') { summary.unresolved_unknown++; continue; }
    if (resolution.category === lead.category && resolution.source === lead.category_source) { summary.unchanged++; continue; }
    if (!dryRun) await repository.persistResolution(lead.id, resolution, { force });
    if (resolution.category === 'trader') summary.updated_trader++;
    if (resolution.category === 'partner') summary.updated_partner++;
  }

  process.stdout.write(`${JSON.stringify({ dry_run: dryRun, force, campaign_id: campaignId, ...summary }, null, 2)}\n`);
}

main().then(() => process.exit(0)).catch(error => {
  process.stderr.write(`Backfill failed: ${error.message}\n`);
  process.exit(1);
});
