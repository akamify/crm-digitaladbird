const { classifyContactState, calculateQuality } = require('../counselorReportOptions');
jest.mock('../../config/database', () => ({ query: jest.fn() }));
const db = require('../../config/database');
const { _buildQuery, drilldown } = require('../../services/counselorReportService');

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

  test.each([
    ['worked', 'a.worked'],
    ['unworked', 'NOT a.worked'],
    ['contacted', "cc.contact_state IN ('contacted', 'converted')"],
    ['converted', "cc.contact_state = 'converted'"],
    ['personal_meeting_leads', 'a.personal_meeting'],
    ['pending', 'cc.contact_state = \'retryable_contact_issue\''],
    ['overdue', 'cc.due_attempt'],
  ])('drill-down %s uses its report metric domain and distinct leads', async (metric, expectedClause) => {
    db.query.mockReset();
    db.query.mockResolvedValueOnce({ rows: [{ total: 1 }] }).mockResolvedValueOnce({ rows: [] });
    await drilldown({ counselor_id: '00000000-0000-0000-0000-000000000001', metric, from: '2026-08-01', to: '2026-08-30' });
    const countSql = db.query.mock.calls[0][0];
    expect(countSql).toContain(expectedClause);
    expect(countSql).toContain('COUNT(DISTINCT lead_id)::int AS total');
    expect(countSql).toContain('o.ownership_start >= $2::timestamptz');
  });

  test('issue drill-down uses the current effective issue state and preserves invalid number compatibility', async () => {
    db.query.mockReset();
    db.query.mockResolvedValueOnce({ rows: [{ total: 0 }] }).mockResolvedValueOnce({ rows: [] });
    await drilldown({ counselor_id: '00000000-0000-0000-0000-000000000001', metric: 'call_issue', call_issue_type: 'invalid_number' });
    const countSql = db.query.mock.calls[0][0];
    expect(countSql).toContain("cc.current_status IN ('in', 'invalid_number')");
    expect(countSql).toContain("cc.contact_state IN ('retryable_contact_issue', 'terminal_lead_quality_issue')");
  });
});
