const { readCampaignLeadCost, hasVerifiedLeadCost } = require('../metaLeadCost');
const snapshot = (count = '20', cost = '20', spend = '400') => ({
  spend,
  actions: [{action_type:'qualified_lead',value:'1'}, {action_type:'lead',value:count}],
  cost_per_action_type: [{action_type:'qualified_lead',value:spend}, {action_type:'lead',value:cost}],
});

test('selects total lead CPL regardless of action order without summing overlapping actions', () => {
  const row = snapshot();
  expect(readCampaignLeadCost(row)).toMatchObject({leads:20,cpl:20,spend:400});
  row.actions.reverse(); row.cost_per_action_type.reverse();
  expect(readCampaignLeadCost(row).cpl).toBe(20);
});

test.each([
  undefined, {}, snapshot('0'), snapshot('-1'), snapshot('20',''),
  snapshot('20','Infinity'), snapshot('20','-1'), snapshot('20','11454.43'),
  snapshot('20','20',null), snapshot('20','20','-400'),
  {spend:'400',actions:[{action_type:'qualified_lead',value:'1'}],cost_per_action_type:[{action_type:'qualified_lead',value:'400'}]},
])('rejects missing, non-lead, invalid or inconsistent metrics %#', row => {
  expect(readCampaignLeadCost(row)).toBeNull();
});

test('duplicates are ambiguous; valid zero spend remains usable', () => {
  const row = snapshot(); row.actions.push(row.actions[1]);
  expect(readCampaignLeadCost(row)).toBeNull();
  expect(readCampaignLeadCost(snapshot('20','0','0')).cpl).toBe(0);
});

test('requires fresh evidence and tolerates NUMERIC(14,2) storage rounding', () => {
  const evidence = readCampaignLeadCost(snapshot('3','133.333333','400'));
  const row = {cost_per_result:'133.33',spend:'400',cost_evidence:evidence};
  expect(hasVerifiedLeadCost(row)).toBe(true);
  expect(hasVerifiedLeadCost({...row,cost_evidence:undefined})).toBe(false);
  expect(hasVerifiedLeadCost({...row,cost_per_result:'11454.43'})).toBe(false);
  expect(hasVerifiedLeadCost({...row,cost_evidence:{...evidence,action_type:'qualified_lead'}})).toBe(false);
});
