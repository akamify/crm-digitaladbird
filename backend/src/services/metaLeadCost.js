// Campaign CPL uses Meta's total `lead` action, never an arbitrary action
// containing "lead" (such as a qualified/conversion lead). Overlapping action
// types must not be added together.
function readCampaignLeadCost(row) {
  const actions = (Array.isArray(row?.actions) ? row.actions : []).filter(a => a?.action_type === 'lead');
  const costs = (Array.isArray(row?.cost_per_action_type) ? row.cost_per_action_type : []).filter(a => a?.action_type === 'lead');
  const number = value => value == null || String(value).trim() === '' ? NaN : Number(value);
  const leads = number(actions[0]?.value);
  const cpl = number(costs[0]?.value);
  const spend = number(row?.spend);
  if (actions.length !== 1 || costs.length !== 1 || !Number.isSafeInteger(leads) || leads <= 0 ||
      !Number.isFinite(cpl) || cpl < 0 || !Number.isFinite(spend) || spend < 0) return null;
  // Permit API rounding, but reject mismatched counts/costs/periods.
  if (Math.abs(cpl - spend / leads) > Math.max(0.01, (spend / leads) * 0.001)) return null;
  return { version: 1, action_type: 'lead', leads, cpl, spend, period: 'maximum' };
}

function hasVerifiedLeadCost(row) {
  const evidence = row.cost_evidence;
  return evidence?.version === 1 && evidence.action_type === 'lead' && evidence.period === 'maximum' &&
    Number.isFinite(evidence.leads) && evidence.leads > 0 &&
    Number.isFinite(evidence.cpl) && evidence.cpl >= 0 &&
    Number.isFinite(evidence.spend) && evidence.spend >= 0 &&
    row.cost_per_result != null && row.spend != null &&
    Math.abs(evidence.cpl - Number(row.cost_per_result)) <= 0.005001 &&
    Math.abs(evidence.spend - Number(row.spend)) <= 0.01 &&
    Math.abs(evidence.cpl - evidence.spend / evidence.leads) <= Math.max(0.01, (evidence.spend / evidence.leads) * 0.001);
}

module.exports = { readCampaignLeadCost, hasVerifiedLeadCost };
