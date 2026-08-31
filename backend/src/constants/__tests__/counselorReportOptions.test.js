const { classifyContactState, calculateQuality } = require('../counselorReportOptions');
jest.mock('../../config/database', () => ({ query: jest.fn() }));
const db = require('../../config/database');
const { _buildQuery, drilldown, getCounselorRows } = require('../../services/counselorReportService');

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

  test('reassigned-out is distinct and derived from a later ownership transfer', () => {
    const { sql } = _buildQuery({ from: '2026-08-01', to: '2026-08-30' });
    expect(sql).toContain('reassigned_out_metrics AS');
    expect(sql).toContain('COUNT(DISTINCT ro.lead_id)::int AS reassigned_out');
    expect(sql).toContain('next_owner.counselor_id <> ro.counselor_id');
    expect(sql).toContain('next_owner.ownership_start >= ro.ownership_end');
    expect(sql).toContain('ro.ownership_start >= $1::timestamptz');
  });

  test('attempt compliance excludes the initial call record and measures retry attempts only', () => {
    const { sql } = _buildQuery({ from: '2026-08-01', to: '2026-08-30' });
    expect(sql).toContain("ca.attempt_number > 1 AND ca.status IN ('scheduled', 'completed', 'missed')");
  });

  test('current call issues include a current lead with a retry scheduled in the selected range', () => {
    const { sql } = _buildQuery({ from: '2026-08-01', to: '2026-08-30' });
    expect(sql).toContain("OR EXISTS (SELECT 1 FROM lead_call_attempts ca WHERE ca.lead_id = l.id AND ca.scheduled_at >= $1::timestamptz");
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

  test('reassigned-out drill-down returns distinct leads from assignment ownership history', async () => {
    db.query.mockReset();
    db.query.mockResolvedValueOnce({ rows: [{ total: 1 }] }).mockResolvedValueOnce({ rows: [] });
    await drilldown({ counselor_id: '00000000-0000-0000-0000-000000000001', metric: 'reassigned_out', from: '2026-08-01', to: '2026-08-30' });
    const countSql = db.query.mock.calls[0][0];
    expect(countSql).toContain('reassigned_out AS');
    expect(countSql).toContain('next_assignment.counselor_id <> ro.counselor_id');
    expect(countSql).toContain('ro.ownership_start >= $2::timestamptz');
    expect(countSql).toContain('COUNT(DISTINCT lead_id)::int AS total');
  });

  test('attempt compliance drill-down excludes initial call records', async () => {
    db.query.mockReset();
    db.query.mockResolvedValueOnce({ rows: [{ due_count: 0, completed_count: 0, missed_count: 0, upcoming_count: 0, attempt_numbers: {} }] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    await drilldown({ counselor_id: '00000000-0000-0000-0000-000000000001', metric: 'attempt_compliance' });
    expect(db.query.mock.calls[0][0]).toContain("ca.attempt_number > 1 AND ca.status IN ('scheduled', 'completed', 'missed')");
  });

  test('attempt drawers expose business retry numbering without changing raw attempt numbers', async () => {
    db.query.mockReset();
    db.query.mockResolvedValueOnce({ rows: [{ total: 1 }] }).mockResolvedValueOnce({ rows: [{ id: 'lead-1' }] }).mockResolvedValueOnce({ rows: [] });
    await drilldown({ counselor_id: '00000000-0000-0000-0000-000000000001', metric: 'call_issue' });
    expect(db.query.mock.calls[2][0]).toContain('GREATEST(ca.attempt_number - 1, 0) AS retry_number');

    db.query.mockReset();
    db.query.mockResolvedValueOnce({ rows: [{ due_count: 0, completed_count: 0, missed_count: 0, upcoming_count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    await drilldown({ counselor_id: '00000000-0000-0000-0000-000000000001', metric: 'attempt_compliance' });
    expect(db.query.mock.calls[0][0]).toContain('ca.attempt_number - 1 AS retry_number');
    expect(db.query.mock.calls[0][0]).toContain('ca.trigger_reason AS issue_at_retry');
  });

  test('issue drill-down uses the current effective issue state and preserves invalid number compatibility', async () => {
    db.query.mockReset();
    db.query.mockResolvedValueOnce({ rows: [{ total: 0 }] }).mockResolvedValueOnce({ rows: [] });
    await drilldown({ counselor_id: '00000000-0000-0000-0000-000000000001', metric: 'call_issue', call_issue_type: 'invalid_number' });
    const countSql = db.query.mock.calls[0][0];
    expect(countSql).toContain("cc.current_status IN ('in', 'invalid_number')");
    expect(countSql).toContain("cc.contact_state IN ('retryable_contact_issue', 'terminal_lead_quality_issue')");
  });

  test('call issue leads without persisted attempts are explicitly returned as untracked', async () => {
    db.query.mockReset();
    db.query.mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'lead-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await drilldown({ counselor_id: '00000000-0000-0000-0000-000000000001', metric: 'call_issue' });
    expect(result.rows[0]).toMatchObject({ id: 'lead-1', attempts: [], attempt_tracking: 'none' });
  });

  test('issue bucket payload separates retryable current issues from terminal lead quality issues', async () => {
    db.query.mockReset();
    db.query.mockResolvedValueOnce({ rows: [{ id: '00000000-0000-0000-0000-000000000001', full_name: 'Counselor', total_received: 0, current_assigned: 0, worked: 0, unworked: 0, attributed_contacted: 0, contactable_received: 0, execution_eligible: 0, progressed: 0, current_contacted: 0, converted: 0, unresolved_call_issues: 2, terminal_lead_quality_issues: 2, actionable_pending: 0, upcoming_calls: 0, new_unworked: 0, needs_action_unworked: 0, delayed_unworked: 0, critical_unworked: 0, completed_attempts: 0, on_time_attempts: 0, overdue_attempts: 0, average_delay_minutes: 0, personal_meetings: 0 }] })
      .mockResolvedValueOnce({ rows: [
        { counselor_id: '00000000-0000-0000-0000-000000000001', issue_type: 'cnr', count: 2 },
        { counselor_id: '00000000-0000-0000-0000-000000000001', issue_type: 'in', count: 1 },
        { counselor_id: '00000000-0000-0000-0000-000000000001', issue_type: 'ni', count: 1 },
      ] });
    const [row] = await getCounselorRows();
    expect(row.call_issues.retryable_buckets).toEqual({ cnr: 2 });
    expect(row.call_issues.terminal_quality_buckets).toEqual({ invalid_number: 1, ni: 1 });
    expect(Object.values(row.call_issues.retryable_buckets).reduce((sum, count) => sum + count, 0)).toBe(row.unresolved_call_issues);
  });
});
