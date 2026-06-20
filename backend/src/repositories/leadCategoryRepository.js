const { query } = require('../config/database');

async function getContext({ metaCampaignId, metaFormId }) {
  const [campaignResult, formResult, rulesResult] = await Promise.all([
    metaCampaignId
      ? query(`SELECT campaign_id, campaign_name, category, category_notes FROM meta_campaigns WHERE campaign_id = $1 LIMIT 1`, [String(metaCampaignId)])
      : Promise.resolve({ rows: [] }),
    metaFormId
      ? query(`SELECT form_id, form_name, page_id, campaign_name, lead_category, category_notes FROM meta_forms WHERE form_id = $1 LIMIT 1`, [String(metaFormId)])
      : Promise.resolve({ rows: [] }),
    query(`SELECT * FROM lead_category_rules WHERE is_active = TRUE ORDER BY priority ASC, created_at ASC`),
  ]);
  return {
    campaign: campaignResult.rows[0] || null,
    form: formResult.rows[0] || null,
    rules: rulesResult.rows,
  };
}

async function getLead(leadId, runner = { query }) {
  const { rows } = await runner.query(`SELECT * FROM leads WHERE id = $1 LIMIT 1`, [leadId]);
  return rows[0] || null;
}

async function persistResolution(leadId, resolution, { force = false, runner = { query } } = {}) {
  const { rows } = await runner.query(
    `UPDATE leads
        SET category = $2,
            category_source = $3,
            category_rule_id = $4,
            category_resolved_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
        AND ($5::boolean = TRUE OR category IS NULL OR category = '' OR category = 'unknown')
      RETURNING id, category, category_source, category_rule_id, category_resolved_at`,
    [leadId, resolution.category, resolution.source, resolution.rule_id || null, !!force],
  );
  return rows[0] || null;
}

async function listRules() {
  const { rows } = await query(`SELECT * FROM lead_category_rules ORDER BY priority, created_at`);
  return rows;
}

async function createRule(input, userId) {
  const { rows } = await query(
    `INSERT INTO lead_category_rules(rule_name, source_type, match_value, match_mode, category, priority, is_active, notes, created_by_user_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [input.rule_name, input.source_type, input.match_value, input.match_mode, input.category, input.priority, input.is_active, input.notes, userId],
  );
  return rows[0];
}

async function updateRule(id, input) {
  const allowed = ['rule_name', 'source_type', 'match_value', 'match_mode', 'category', 'priority', 'is_active', 'notes'];
  const entries = allowed.filter(key => input[key] !== undefined).map(key => [key, input[key]]);
  if (!entries.length) return null;
  const values = entries.map(([, value]) => value);
  values.push(id);
  const sets = entries.map(([key], index) => `${key} = $${index + 1}`);
  const { rows } = await query(`UPDATE lead_category_rules SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`, values);
  return rows[0] || null;
}

async function deleteRule(id) {
  const { rows } = await query(`DELETE FROM lead_category_rules WHERE id = $1 RETURNING *`, [id]);
  return rows[0] || null;
}

async function updateCampaignCategory(campaignId, category, notes, userId) {
  const { rows } = await query(
    `UPDATE meta_campaigns
        SET category = $2, category_notes = $3, category_updated_by_user_id = $4,
            category_updated_at = NOW(), updated_at = NOW()
      WHERE campaign_id = $1
      RETURNING *`,
    [String(campaignId), category, notes || null, userId],
  );
  return rows[0] || null;
}

async function updateFormCategory(formId, category, notes, userId) {
  const { rows } = await query(
    `UPDATE meta_forms SET lead_category = $2, category_notes = $3,
                           category_updated_by_user_id = $4, category_updated_at = NOW()
      WHERE form_id = $1 RETURNING *`,
    [String(formId), category, notes || null, userId],
  );
  return rows[0] || null;
}

async function getCampaign(campaignId) {
  const { rows } = await query(`SELECT * FROM meta_campaigns WHERE campaign_id = $1 LIMIT 1`, [String(campaignId)]);
  return rows[0] || null;
}

async function backfillCampaign(campaignId, category, mode) {
  const { rows: [count] } = await query(
    `SELECT COUNT(*)::int AS scanned,
            COUNT(*) FILTER (WHERE category IS NULL OR category = '' OR category = 'unknown')::int AS unknown_count
       FROM leads WHERE meta_campaign_id = $1 AND deleted_at IS NULL`,
    [String(campaignId)],
  );
  if (mode === 'dry_run') return { scanned: count.scanned, updated: 0, skipped: count.scanned, would_update: count.unknown_count };
  const condition = mode === 'unknown_only' ? `AND (category IS NULL OR category = '' OR category = 'unknown')` : '';
  const update = await query(
    `UPDATE leads SET category = $2, category_source = 'campaign_mapping', category_rule_id = NULL,
                      category_resolved_at = NOW(), updated_at = NOW()
      WHERE meta_campaign_id = $1 AND deleted_at IS NULL ${condition}`,
    [String(campaignId), category],
  );
  return { scanned: count.scanned, updated: update.rowCount, skipped: count.scanned - update.rowCount };
}

async function manuallyUpdateLead(leadId, category, userId) {
  const { rows } = await query(
    `UPDATE leads SET category = $2, category_source = 'manual_override', category_rule_id = NULL,
                      category_resolved_at = NOW(), category_manually_updated_by_user_id = $3,
                      category_manually_updated_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [leadId, category, userId],
  );
  return rows[0] || null;
}

async function bulkUpdateLeads(leadIds, category, userId) {
  const { rows } = await query(
    `UPDATE leads SET category = $2, category_source = 'manual_override', category_rule_id = NULL,
                      category_resolved_at = NOW(), category_manually_updated_by_user_id = $3,
                      category_manually_updated_at = NOW(), updated_at = NOW()
      WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL RETURNING id`,
    [leadIds, category, userId],
  );
  return rows;
}

module.exports = {
  getContext, getLead, persistResolution, listRules, createRule, updateRule, deleteRule,
  updateCampaignCategory, updateFormCategory, getCampaign, backfillCampaign, manuallyUpdateLead,
  bulkUpdateLeads,
};
