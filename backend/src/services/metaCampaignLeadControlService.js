const { query } = require('../config/database');
const logger = require('../utils/logger');

async function getCampaignLeadReceptionPolicy(campaignId) {
  if (!campaignId) {
    return {
      allowed: true,
      reason: 'missing_campaign_id',
      campaign: null,
    };
  }

  const { rows: [campaign] } = await query(
    `SELECT id, campaign_id, campaign_name, internal_label, lead_receiving_enabled
       FROM meta_campaigns
      WHERE campaign_id = $1
      LIMIT 1`,
    [String(campaignId)],
  );

  if (!campaign) {
    return {
      allowed: true,
      reason: 'unknown_campaign',
      campaign: null,
    };
  }

  if (campaign.lead_receiving_enabled === false) {
    return {
      allowed: false,
      reason: 'campaign_receiving_disabled',
      campaign,
    };
  }

  return {
    allowed: true,
    reason: 'campaign_receiving_enabled',
    campaign,
  };
}

async function recordSkippedCampaignLead({
  source,
  leadgenId,
  campaignId,
  campaignName,
  pageId = null,
  formId = null,
  adsetId = null,
  adId = null,
}) {
  try {
    await query(
      `INSERT INTO audit_logs(user_id, entity, entity_id, action, metadata)
         VALUES(NULL, 'lead_ingestion', NULL, 'ignored_campaign_receiving_disabled', $1)`,
      [JSON.stringify({
        reason: 'campaign_receiving_disabled',
        source,
        leadgen_id: leadgenId || null,
        campaign_id: campaignId || null,
        campaign_name: campaignName || null,
        page_id: pageId,
        form_id: formId,
        adset_id: adsetId,
        ad_id: adId,
      })],
    );
  } catch (error) {
    logger.warn({ err: error.message, campaignId, leadgenId, source }, 'Failed to audit skipped disabled-campaign lead');
  }
}

module.exports = {
  getCampaignLeadReceptionPolicy,
  recordSkippedCampaignLead,
};
