const { query } = require('../config/database');
const { getVisibleUserIds } = require('../middleware/rbac');
const { AppError } = require('../utils/errors');
const { hasVerifiedLeadCost } = require('./metaLeadCost');

function summarizeCosts(rows, showSpend) {
  let total = 0, missing = 0;
  const currencies = new Map();
  for (const row of rows) {
    const count = Number(row.lead_count);
    total += count;
    const cpl = row.cost_per_result == null ? NaN : Number(row.cost_per_result);
    const currency = String(row.currency || '').toUpperCase();
    if (!hasVerifiedLeadCost(row) || !Number.isFinite(cpl) || cpl < 0 || !/^[A-Z]{3}$/.test(currency) || !row.last_metrics_synced_at || row.metrics_error) {
      missing += count;
      continue;
    }
    const item = currencies.get(currency) || {currency, priced_leads: 0, allocated_cost: 0, campaign_spend: 0, spend_known: true, oldest_sync: row.last_metrics_synced_at};
    item.priced_leads += count;
    item.allocated_cost += count * cpl;
    const spend = row.spend == null ? NaN : Number(row.spend);
    if (Number.isFinite(spend) && spend >= 0) item.campaign_spend += spend;
    else item.spend_known = false;
    if (new Date(row.last_metrics_synced_at) < new Date(item.oldest_sync)) item.oldest_sync = row.last_metrics_synced_at;
    currencies.set(currency, item);
  }
  return {total_leads: total, missing_cost_leads: missing, basis: 'latest_campaign_cpl', period: 'all_time', groups: [...currencies.values()].map(item => ({
    currency: item.currency, priced_leads: item.priced_leads,
    average_cpl: item.allocated_cost / item.priced_leads,
    allocated_cost: item.allocated_cost,
    ...(showSpend && item.spend_known ? {campaign_spend: item.campaign_spend} : {}), oldest_sync: item.oldest_sync,
  }))};
}

async function leadCosts(actor) {
  if (!['super_admin','rm','member','partner'].includes(actor.role)) throw new AppError(403, 'FORBIDDEN', 'Lead cost reporting is not available for this role');
  const visible = ['member','partner'].includes(actor.role) ? [actor.id] : await getVisibleUserIds(actor);
  // Count each current lead once before joining the unique campaign/account records.
  // No caller-supplied owner IDs: scope comes only from the authenticated actor.
  const { rows } = await query(`WITH campaign_counts AS (
    SELECT l.meta_campaign_id, COUNT(*)::int AS lead_count
    FROM leads l WHERE l.deleted_at IS NULL
      AND ($1::uuid[] IS NULL OR l.assigned_to_user_id = ANY($1::uuid[]))
    GROUP BY l.meta_campaign_id
  ) SELECT c.lead_count, m.cost_per_result, m.spend, m.last_metrics_synced_at, m.metrics_error, a.currency,
      m.raw_meta->'crm_lead_cost' AS cost_evidence
    FROM campaign_counts c LEFT JOIN meta_campaigns m ON m.campaign_id = c.meta_campaign_id
    LEFT JOIN meta_ad_accounts a ON a.account_id = m.ad_account_id`, [visible]);
  return summarizeCosts(rows, actor.role === 'super_admin');
}
module.exports = { leadCosts, summarizeCosts };
