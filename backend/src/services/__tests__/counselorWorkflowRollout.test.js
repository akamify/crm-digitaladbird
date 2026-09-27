const {configuration,cutoffFor} = require('../counselorWorkflowRollout');
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const past = '2020-01-01T00:00:00Z';
const user = {id,role:'member'};
test('off is the default even with an activation timestamp',()=>{
  expect(cutoffFor(configuration({rolloutMode:'off',rolloutAt:past}),user)).toBeNull();
});
test.each(['member','partner'])('pilot accepts only explicitly activated %s',role=>{
  const config=configuration({rolloutMode:'pilot',rolloutAt:past,pilotStarts:{[id]:past}});
  expect(cutoffFor(config,{...user,role})).toBeTruthy();
  expect(cutoffFor(config,{id:other,role})).toBeNull();
});
test.each(['admin','rm','super_admin','client'])('never enables %s',role=>{
  expect(cutoffFor(configuration({rolloutMode:'all',rolloutAt:past}),{...user,role})).toBeNull();
});
test('future pilot activation remains disabled',()=>{
  expect(cutoffFor(configuration({rolloutMode:'pilot',rolloutAt:past,pilotStarts:{[id]:'2999-01-01T00:00:00Z'}}),user)).toBeNull();
});
test('all expansion preserves pilot start and gives new counselors the new cutoff',()=>{
  const config=configuration({rolloutMode:'all',rolloutAt:'2021-01-01T00:00:00Z',pilotStarts:{[id]:past}});
  expect(cutoffFor(config,user)).toBe('2020-01-01T00:00:00.000Z');
  expect(cutoffFor(config,{id:other,role:'partner'})).toBe('2021-01-01T00:00:00.000Z');
});
test.each([{rolloutMode:'typo'},{rolloutMode:'pilot',rolloutAt:'bad'},
  {rolloutMode:'pilot',rolloutAt:past,pilotStarts:[]},
  {rolloutMode:'pilot',rolloutAt:past,pilotStarts:{bad:past}},
  {rolloutMode:'pilot',rolloutAt:past,pilotStarts:{[id]:'2020-01-01'}}])('malformed flags fail closed',input=>{
  expect(()=>configuration(input)).toThrow('Invalid counselor workflow rollout');
});
