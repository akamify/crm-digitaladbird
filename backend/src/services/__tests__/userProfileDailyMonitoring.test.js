jest.mock('../../config/database', () => ({ query: jest.fn(), withTransaction: jest.fn() }));

const db = require('../../config/database');
const { getDailyLeadMonitoringSummary, getUserLeads } = require('../userProfileService');

const actor = { id: 'admin-1', role: 'super_admin' };
const member = { id: 'user-1', full_name: 'Counselor', role: 'member', status: 'active' };

function rows(values = []) {
  return Promise.resolve({ rows: values, rowCount: values.length });
}

describe('User Profile daily monitoring queries', () => {
  beforeEach(() => jest.clearAllMocks());

  test('uses the 30-minute grace state and excludes the initial issue from retry counts', async () => {
    db.query
      .mockImplementationOnce(() => rows([member]))
      .mockImplementationOnce(() => rows([{ assigned: 1, worked: 1, pending: 0, call_issues: 1, attempts_completed: 2, attempts_missed: 1, personal_meeting_leads: 0, converted: 0 }]));

    const result = await getDailyLeadMonitoringSummary(actor, member.id, { selected_date: '2026-08-30' });
    const summarySql = db.query.mock.calls[1][0];

    expect(result.attempts_completed).toBe(2);
    expect(summarySql).toContain('ca.attempt_number > 1');
    expect(summarySql).toContain("ca.status = 'scheduled' AND ca.scheduled_at <= NOW() - make_interval(mins => 30)");
    expect(summarySql).toContain('COUNT(*)::int');
  });

  test('assigned drill-down is based on assignment history, not current ownership', async () => {
    db.query
      .mockImplementationOnce(() => rows([member]))
      .mockImplementationOnce(() => rows([{ total: 1 }]))
      .mockImplementationOnce(() => rows([{ all_count: 1 }]))
      .mockImplementationOnce(() => rows([]))
      .mockImplementationOnce(() => rows([{ id: '00000000-0000-0000-0000-000000000001' }]))
      .mockImplementationOnce(() => rows([]));

    const result = await getUserLeads(actor, member.id, {
      monitoring: 'true',
      monitoring_scope: 'assigned',
      selected_date: '2026-08-30',
    });

    const countSql = db.query.mock.calls[1][0];
    expect(countSql).toContain('FROM lead_assignments la');
    expect(countSql).not.toContain('l.assigned_to_user_id = $1');
    expect(result.rows[0].attempt_tracking).toBe('none');
  });

  test('attempt rows expose server-derived state and counselor attribution', async () => {
    db.query
      .mockImplementationOnce(() => rows([member]))
      .mockImplementationOnce(() => rows([{ total: 1 }]))
      .mockImplementationOnce(() => rows([{ all_count: 1 }]))
      .mockImplementationOnce(() => rows([]))
      .mockImplementationOnce(() => rows([{ id: '00000000-0000-0000-0000-000000000001' }]))
      .mockImplementationOnce(() => rows([{ lead_id: '00000000-0000-0000-0000-000000000001', attempt_number: 1, attempt_state: 'initial_issue', completed_by_name: 'Previous Counselor' }]));

    const result = await getUserLeads(actor, member.id, { monitoring: 'true', selected_date: '2026-08-30' });
    const attemptsSql = db.query.mock.calls[5][0];

    expect(attemptsSql).toContain("THEN 'initial_issue'");
    expect(attemptsSql).toContain('completed_by.full_name AS completed_by_name');
    expect(result.rows[0].attempts[0].attempt_state).toBe('initial_issue');
  });
});
