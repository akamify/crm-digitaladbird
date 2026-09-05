const {
  normalizeLeadAllTimeMetric,
  buildLeadAllTimeMetricConditions,
  leadAllTimeSummarySelectSql,
} = require('../leadAllTimeMetrics');

describe('lead all-time metrics', () => {
  test('accepts supported metrics and defaults to all leads', () => {
    expect(normalizeLeadAllTimeMetric('')).toBe('all');
    expect(normalizeLeadAllTimeMetric('pending')).toBe('pending');
    expect(normalizeLeadAllTimeMetric('call_issues')).toBe('call_issues');
  });

  test('rejects unknown metrics', () => {
    expect(() => normalizeLeadAllTimeMetric('unknown')).toThrow(expect.objectContaining({
      code: 'INVALID_ALL_TIME_METRIC',
    }));
  });

  test('shares portfolio conditions between summary counts and filtered rows', () => {
    const conditions = buildLeadAllTimeMetricConditions('l');
    const summarySql = leadAllTimeSummarySelectSql(conditions);

    expect(conditions.all).toBe('TRUE');
    expect(conditions.worked).toContain('lead_remarks worked_lr');
    expect(conditions.pending).toContain('assigned_to_user_id IS NOT NULL');
    expect(conditions.pending).toContain('scheduled_at <= NOW()');
    expect(conditions.pending).toContain('next_followup_at <= NOW()');
    expect(conditions.call_issues).toContain("seq.status = 'active'");
    expect(conditions.session_9pm).toContain("'session_730_attend'");
    expect(summarySql).toContain('AS "all"');
    expect(summarySql).toContain('AS "pending"');
    expect(summarySql).toContain('AS "call_issues"');
  });
});
