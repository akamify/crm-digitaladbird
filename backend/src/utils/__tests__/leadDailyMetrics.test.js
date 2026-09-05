const {
  normalizeLeadDailyDate,
  normalizeLeadDailyMetric,
  buildLeadDailyMetricConditions,
  leadDailySummarySelectSql,
} = require('../leadDailyMetrics');

describe('lead daily metrics', () => {
  test('accepts valid non-future business dates and known metrics', () => {
    const now = new Date('2026-09-03T06:00:00.000Z');

    expect(normalizeLeadDailyDate('2026-09-03', now)).toBe('2026-09-03');
    expect(normalizeLeadDailyDate('2026-09-02', now)).toBe('2026-09-02');
    expect(normalizeLeadDailyMetric('call_issues')).toBe('call_issues');
    expect(normalizeLeadDailyMetric('')).toBe('received');
  });

  test('rejects invalid, future, and unknown selections', () => {
    const now = new Date('2026-09-03T06:00:00.000Z');

    expect(() => normalizeLeadDailyDate('2026-02-30', now)).toThrow(expect.objectContaining({ code: 'INVALID_DATE' }));
    expect(() => normalizeLeadDailyDate('2026-09-04', now)).toThrow(expect.objectContaining({ code: 'INVALID_DATE' }));
    expect(() => normalizeLeadDailyMetric('unknown')).toThrow(expect.objectContaining({ code: 'INVALID_DAILY_METRIC' }));
  });

  test('builds one shared date-scoped definition for summary and drill-down rows', () => {
    const conditions = buildLeadDailyMetricConditions('$3::date', 'l');
    const summarySql = leadDailySummarySelectSql(conditions);

    expect(conditions.received).toContain("AT TIME ZONE 'Asia/Kolkata'");
    expect(conditions.received).toContain('l.created_at >=');
    expect(conditions.received).toContain('l.created_at <');
    expect(conditions.pending).toContain('daily_due.attempt_number > 1');
    expect(conditions.session_9pm).toContain("'session_730_attend'");
    expect(conditions.call_issues).toContain("seq.status = 'active'");
    expect(conditions.call_issues).toContain("issue_received.outcome = 'call_received'");
    expect(summarySql).toContain('AS received');
    expect(summarySql).toContain('AS call_issues');
  });
});
