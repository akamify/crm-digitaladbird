jest.mock('../../config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
const {guide}=require('../counselorGuideService');
const {STATUS_VALUES}=require('../counselorWorkflowService');
const {journeyDeadlines,NR_STATUSES,RETRYABLE_ISSUES,CLOCKS}=require('../counselorWorkflowPolicies');
const cards=guide().cards;
test('every supported status appears once, plus New',()=>{
  expect(new Set(cards.map(c=>c.status))).toEqual(new Set([...STATUS_VALUES,'new']));
  expect(cards).toHaveLength(STATUS_VALUES.size+1);
});
test.each([...STATUS_VALUES])('%s guide timing matches authoritative calculation',status=>{
  const start=new Date(`2030-09-26T${CLOCKS.opening}:00+05:30`);
  const policy=journeyDeadlines(status,start);const card=cards.find(c=>c.status===status);
  expect(card.automaticAging).toBe(Boolean(policy));
  if(policy){expect(card.secondHours).toBe((policy.move_to_pending_at-policy.move_to_old_at)/3600000);
    if(status!=='respond_hi')expect(card.firstHours).toBe((policy.move_to_old_at-start)/3600000);}
  else expect(card.first).toBe('No automatic Old/Pending timer');
});
test('special boundaries and direct Pending are explained',()=>{
  expect(cards.find(c=>c.status==='respond_hi').first).toContain('exactly');
  expect(cards.find(c=>c.status==='respond_hi').first).toContain('9:30 PM');
  for(const status of [...NR_STATUSES,'new']){
    const card=cards.find(c=>c.status===status);
    expect(card.first).toContain('including both exact boundaries');
    expect(card.first).toContain('10:00 AM the same day');
    expect(card.first).toContain('10:00 AM the next day');
  }
  expect(cards.find(c=>c.status==='new').steps).toEqual(['New','No work','Pending']);
});
test('all retryable issues appear and no internal details are exposed',()=>{
  for(const status of RETRYABLE_ISSUES)expect(cards.find(c=>c.status===status)).toMatchObject({category:'Call Issues',firstHours:2,secondHours:22});
  expect(JSON.stringify(guide())).not.toMatch(/idempotency|generation|assignment_id|policy_version|lock_/);
});
