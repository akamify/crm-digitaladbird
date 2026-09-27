jest.mock('../../config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
jest.mock('../counselorWorkspaceService',()=>({workspace:jest.fn(async()=>({enabled:true,rows:[{id:'assigned-lead'}],total:1,summary:{received:1}}))}));
const {createService}=require('../counselorWorkflowService');
const {workspace}=require('../counselorWorkspaceService');

beforeEach(()=>jest.clearAllMocks());
test.each(['member','partner'])('%s can read the new workspace with rollout off',async role=>{
  const db={query:jest.fn()};
  const service=createService(db,{rolloutMode:'off'});
  const user={id:'counselor',role};
  const input={view:'received',page:2};
  expect(await service.workspace(user,input)).toMatchObject({enabled:true,remarks_enabled:false,rows:[{id:'assigned-lead'}],total:1});
  expect(workspace).toHaveBeenCalledWith(db,user,input,expect.any(Function));
  expect(service.configuration(user)).toEqual({enabled:false});
});
test.each(['admin','rm','super_admin','client'])('%s still cannot read counselor workspace',async role=>{
  await expect(createService({}, {rolloutMode:'off'}).workspace({id:'other',role})).rejects.toMatchObject({code:'WORKFLOW_FORBIDDEN'});
  expect(workspace).not.toHaveBeenCalled();
});
test('workspace errors remain errors instead of empty lists',async()=>{
  workspace.mockRejectedValueOnce(new Error('Database unavailable'));
  await expect(createService({}, {rolloutMode:'off'}).workspace({id:'counselor',role:'member'})).rejects.toThrow('Database unavailable');
});
