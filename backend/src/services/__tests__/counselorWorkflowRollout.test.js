const {configuration,cutoffFor} = require('../counselorWorkflowRollout');
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const past = '2020-01-01T00:00:00Z';
const user = {id,role:'member'};
test('explicit isolated service option can disable activation',()=>{
  expect(cutoffFor(configuration({rolloutMode:'off',rolloutAt:past}),user)).toBeNull();
});

test.each(['member','partner'])('original UI workflow is active for %s without environment flags',role=>{
  const keys=['COUNSELOR_WORKFLOW_MODE','COUNSELOR_WORKFLOW_ROLLOUT_AT','COUNSELOR_WORKFLOW_PILOTS'];
  const before=keys.map(key=>process.env[key]);
  try {
    process.env.COUNSELOR_WORKFLOW_MODE='off';
    process.env.COUNSELOR_WORKFLOW_ROLLOUT_AT='';
    process.env.COUNSELOR_WORKFLOW_PILOTS='invalid legacy setting';
    const config=configuration();
    expect(config).toEqual({mode:'all',cutoff:'2026-09-26T18:30:00.000Z',pilots:{}});
    expect(cutoffFor(config,{...user,role})).toBe(config.cutoff);
    expect(configuration()).toEqual(config);
  } finally { keys.forEach((key,index)=>{if(before[index]===undefined)delete process.env[key];else process.env[key]=before[index];}); }
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
