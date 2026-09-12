const {
  normalizeLeadDailyDate,
  normalizeLeadDailyMetric,
  buildLeadDailyMetricConditions,
  buildLeadPeriodMetricConditions,
  leadDailySummarySelectSql,
} = require('../leadDailyMetrics');

describe('lead daily metrics', () => {
  test('accepts valid non-future business dates and known metrics', () => {
    const now = new Date('2026-09-03T06:00:00.000Z');

    expect(normalizeLeadDailyDate('2026-09-03', now)).toBe('2026-09-03');
    expect(normalizeLeadDailyDate('2026-09-02', now)).toBe('2026-09-02');
    expect(normalizeLeadDailyMetric('call_issues')).toBe('call_issues');
    expect(normalizeLeadDailyMetric('converted')).toBe('converted');
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
    for (const metric of ['worked', 'pending', 'session_9pm', 'personal_meeting', 'converted', 'call_issues']) {
      expect(conditions[metric]).toContain('l.created_at >=');
      expect(conditions[metric]).toContain('l.created_at <');
    }
    expect(conditions.pending).toContain('AND NOT');
    expect(conditions.pending).not.toContain('daily_due');
    expect(conditions.pending).not.toContain('assigned_to_user_id');
    expect(conditions.session_9pm).toContain("'session_730_attend'");
    expect(conditions.converted).toContain("daily_conversion_remark.call_status::text = 'converted'");
    expect(conditions.converted).toContain("daily_conversion_event.event_type = 'lifecycle_closed'");
    expect(conditions.converted).toContain('daily_conversion_event.occurred_at');
    expect(conditions.converted).not.toContain('daily_conversion_event.created_at');
    expect(conditions.call_issues).toContain("seq.status = 'active'");
    expect(conditions.call_issues).toContain('daily_issue_remark.created_at');
    expect(conditions.call_issues).toContain('daily_issue_attempt.attempted_at');
    expect(conditions.call_issues).toContain('daily_issue_sequence.created_at');
    expect(conditions.call_issues).toContain("issue_received.outcome = 'call_received'");
    expect(summarySql).toContain('AS received');
    expect(summarySql).toContain('AS call_issues');
    expect(summarySql).toContain('AS converted');
  });

  test('uses inclusive IST day boundaries for a custom period', () => {
    const conditions = buildLeadPeriodMetricConditions('$1::date', '$2::date', 'l');

    expect(conditions.received).toContain('l.created_at >= ($1::date::timestamp');
    expect(conditions.received).toContain('(($2::date + 1)::date)');
    expect(conditions.worked).toContain('daily_lr.created_at >= ($1::date::timestamp');
    expect(conditions.worked).toContain('(($2::date + 1)::date)');
  });
});
