jest.mock('../../config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
const {COUNSELOR_REMARK_OPTIONS,WORKFLOW_REMARK_OPTIONS,normalizeWorkflowRemarkStatuses}=require('../leadWorkflowRemarkService');
const {validateCallStatus}=require('../../constants/leadStatusOptions');
const {validateStatuses}=require('../counselorWorkflowService');
const {shouldCancelAttemptSequencesForWorkflowStatuses}=require('../leadCallAttemptService');
test.each(COUNSELOR_REMARK_OPTIONS)('%s passes original remark and workflow validation',status=>{
  expect(normalizeWorkflowRemarkStatuses([status])).toContain(status);
  const normalized=validateCallStatus(status);
  expect(normalized).toBeTruthy();
  expect(()=>validateStatuses([normalized],normalized)).not.toThrow();
});
test.each(COUNSELOR_REMARK_OPTIONS.filter(value=>!WORKFLOW_REMARK_OPTIONS.includes(value)))('%s replaces an existing retry plan through the existing confirmation',status=>{
  expect(shouldCancelAttemptSequencesForWorkflowStatuses([status])).toBe(true);
});
