const { classifyContactState, calculateQuality } = require('../counselorReportOptions');
jest.mock('../../config/database', () => ({ query: jest.fn() }));
const { _buildQuery } = require('../../services/counselorReportService');

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

  test('date-scoped aggregate query filters the ownership CTE alias, not lead_assignments alias', () => {
    const { sql } = _buildQuery({ from: '2026-08-01', to: '2026-08-30' });
    expect(sql).toContain('o.ownership_start >= $1::timestamptz');
    expect(sql).toContain("o.ownership_start < ($2::date + INTERVAL '1 day')");
    expect(sql).not.toContain('WHERE a.assigned_at >=');
  });
});
