jest.mock('../../config/database', () => ({ query: jest.fn() }));

const { query } = require('../../config/database');
const service = require('../leadDistributionAnalyticsService');

describe('lead distribution analytics service', () => {
  beforeEach(() => query.mockReset());

  test('normalizes single-day and inclusive range scopes in CRM timezone', () => {
    const now = new Date('2026-09-05T06:00:00.000Z');

    expect(service.normalizeScope({ view: 'daily', from: '2026-09-05' }, now)).toEqual({
      view: 'daily', from: '2026-09-05', to: '2026-09-05',
    });
    expect(service.normalizeScope({ view: 'daily', from: '2026-08-22', to: '2026-08-29' }, now)).toEqual({
      view: 'daily', from: '2026-08-22', to: '2026-08-29',
    });
    expect(service.normalizeScope({ view: 'all_time', from: '2026-09-01' }, now)).toEqual({
      view: 'all_time', from: null, to: null,
    });
  });

  test('rejects reversed, future, oversized, and unknown scopes', () => {
    const now = new Date('2026-09-05T06:00:00.000Z');

    expect(() => service.normalizeScope({ view: 'daily', from: '2026-09-05', to: '2026-09-04' }, now))
      .toThrow(expect.objectContaining({ code: 'INVALID_DATE_RANGE' }));
    expect(() => service.normalizeScope({ view: 'daily', from: '2026-09-06' }, now))
      .toThrow(expect.objectContaining({ code: 'INVALID_DATE' }));
    expect(() => service.normalizeScope({ view: 'daily', from: '2025-01-01', to: '2026-09-05' }, now))
      .toThrow(expect.objectContaining({ code: 'DATE_RANGE_TOO_LARGE' }));
    expect(() => service.normalizeScope({ view: 'weekly' }, now))
      .toThrow(expect.objectContaining({ code: 'INVALID_ANALYTICS_VIEW' }));
  });

  test('builds one materialized scope with current RM and counselor attribution', () => {
    const params = [];
    const scope = { view: 'daily', from: '2026-09-01', to: '2026-09-05' };
    const built = service._buildScopeCte({ category: 'trader' }, scope, params);

    expect(params).toEqual(['trader', '2026-09-01', '2026-09-05']);
    expect(built.sql).toContain('lead_candidates AS MATERIALIZED');
    expect(built.sql).toContain('scoped_leads AS MATERIALIZED');
    expect(built.sql).toContain('classified AS MATERIALIZED');
    expect(built.sql).toContain('source_lead.pool_rm_id');
    expect(built.sql).toContain('candidate.assignee_rm_id = rm.id');
    expect(built.sql).toContain('AS metric_received');
    expect(built.sql).toContain('AS metric_call_issues');
    expect(built.sql).toContain("AT TIME ZONE 'Asia/Kolkata'");
  });

  test('returns reconciliable RM rows and a separate unassigned bucket', async () => {
    query.mockResolvedValueOnce({ rows: [{
      summary: { received: 10, worked: 6, pending: 4, personal_meeting: 1, session_9pm: 2, call_issues: 3 },
      rms: [{ id: 'rm-1', full_name: 'RM One', counselor_count: 2, received: 8, worked: 5, pending: 3, personal_meeting: 1, session_9pm: 2, call_issues: 2 }],
      unassigned: { received: 2, worked: 1, pending: 1, personal_meeting: 0, session_9pm: 0, call_issues: 1 },
    }] });

    const result = await service.listRms({ id: 'admin-1', role: 'super_admin' }, { view: 'all_time' });

    expect(result.summary.received).toBe(10);
    expect(result.rms[0]).toMatchObject({ received: 8, counselor_count: 2, distribution_share: 80 });
    expect(result.unassigned).toMatchObject({ full_name: 'Unassigned RM', received: 2 });
    expect(result.rms[0].received + result.unassigned.received).toBe(result.summary.received);
  });

  test('restricts RM overview to the authenticated RM in SQL', async () => {
    query.mockResolvedValueOnce({ rows: [{ summary: {}, rms: [], unassigned: {} }] });

    await service.listRms({ id: '11111111-1111-1111-1111-111111111111', role: 'rm' }, { view: 'all_time' });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('rm.id = $1::uuid');
    expect(query.mock.calls[0][0]).toContain('c.distribution_rm_id = $1::uuid');
    expect(query.mock.calls[0][0]).toContain('c.distribution_rm_id IS NULL AND FALSE');
    expect(query.mock.calls[0][1]).toEqual(['11111111-1111-1111-1111-111111111111']);
  });

  test('does not expose RM-level distribution to counselor roles', async () => {
    await expect(service.listRms({ id: 'member-1', role: 'member' }, { view: 'all_time' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(query).not.toHaveBeenCalled();
  });

  test('rejects malformed hierarchy ids before querying PostgreSQL', async () => {
    await expect(service.listCounselors(
      { id: 'admin-1', role: 'super_admin' },
      'not-a-uuid',
      { view: 'all_time' },
    )).rejects.toMatchObject({ code: 'INVALID_RM_ID', status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  test('blocks a counselor from opening another counselor through a direct API scope', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: '22222222-2222-2222-2222-222222222222', full_name: 'RM', role: 'rm', status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ id: '33333333-3333-3333-3333-333333333333', full_name: 'Other Counselor', role: 'member', status: 'active', report_to_id: '22222222-2222-2222-2222-222222222222' }] });

    await expect(service.getCounselorLeads(
      { id: '44444444-4444-4444-4444-444444444444', role: 'member', report_to_id: '22222222-2222-2222-2222-222222222222' },
      '22222222-2222-2222-2222-222222222222',
      '33333333-3333-3333-3333-333333333333',
      { view: 'all_time' },
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(query).toHaveBeenCalledTimes(2);
  });

  test('allows a partner to open only their own counselor analytics', async () => {
    const rmId = '22222222-2222-4222-8222-222222222222';
    const counselorId = '33333333-3333-4333-8333-333333333333';
    query
      .mockResolvedValueOnce({ rows: [{ id: rmId, full_name: 'RM', role: 'rm', status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ id: counselorId, full_name: 'Partner', role: 'partner', status: 'active', report_to_id: rmId }] })
      .mockResolvedValueOnce({ rows: [{ summary: {}, call_issue_buckets: {} }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(service.getCounselorLeads(
      { id: counselorId, role: 'partner', report_to_id: rmId },
      rmId,
      counselorId,
      { view: 'all_time' },
    )).resolves.toMatchObject({ counselor: { id: counselorId }, total: 0 });
  });
});
