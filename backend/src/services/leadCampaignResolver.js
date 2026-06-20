const UNKNOWN_CAMPAIGN = 'Unknown Campaign';

function cleanText(value) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text || null;
}

function isMeaningfulCampaignName(value) {
  const text = cleanText(value);
  if (!text) return false;
  return text.toLowerCase() !== UNKNOWN_CAMPAIGN.toLowerCase() && text.toLowerCase() !== 'unknown';
}

function getField(fields, names) {
  for (const name of names) {
    const value = fields?.[name] ?? fields?.custom?.[name];
    if (isMeaningfulCampaignName(value)) return cleanText(value);
  }
  return null;
}

function resolveCampaignName({ payload = {}, fields = {}, form = {}, campaign = {}, existing = null } = {}) {
  const candidates = [
    payload.campaign_name,
    payload.campaign?.name,
    getField(fields, ['campaign_name', 'campaign', 'campaignname']),
    getField(fields, ['utm_campaign', 'utm_campaign_name', 'utm']),
    campaign.campaign_name,
    campaign.name,
    form.campaign_name,
    form.campaign_label,
    form.form_name,
    existing,
  ];

  for (const candidate of candidates) {
    if (isMeaningfulCampaignName(candidate)) return cleanText(candidate);
  }
  return UNKNOWN_CAMPAIGN;
}

module.exports = {
  UNKNOWN_CAMPAIGN,
  isMeaningfulCampaignName,
  resolveCampaignName,
};
