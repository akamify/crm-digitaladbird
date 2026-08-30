const { classifyContactState, calculateQuality } = require('../counselorReportOptions');

describe('counselor report classification', () => {
  test('successful workflow overrides a historical CNR current status', () => {
    expect(classifyContactState({ status: 'cnr', hasSuccessfulWorkflow: true })).toMatchObject({ state: 'contacted', issueType: null });
  });

  test('invalid records are excluded from contactable quality denominator', () => {
    expect(classifyContactState({ status: 'in' })).toMatchObject({ state: 'terminal_lead_quality_issue', contactable: false });
  });

  test('quality normalizes unavailable follow-up data instead of treating it as zero', () => {
    const quality = calculateQuality({ worked: 9, execution_eligible: 10, attributed_contacted: 4, contactable_received: 5, completed_attempts: 0, on_time_attempts: 0, actionable_pending: 1, progressed: 2 });
    expect(quality.components.followup_discipline).toBeNull();
    expect(quality.score).toBeGreaterThan(0);
    expect(quality.components.actionable_contact).toBe(80);
  });

  test('conversion remains a stronger current state than an earlier received call', () => {
    expect(classifyContactState({ status: 'converted', hasReceivedAttempt: true })).toMatchObject({ state: 'converted' });
  });
});
