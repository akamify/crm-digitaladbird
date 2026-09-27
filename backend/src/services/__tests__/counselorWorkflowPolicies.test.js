const { journeyDeadlines, POLICY_VERSION } = require('../counselorWorkflowPolicies');
const { newAssignmentDeadlines, RETRYABLE_ISSUES, NR_STATUSES } = require('../counselorWorkflowPolicies');

describe('main journey policy deadlines', () => {
  test.each([
    ['communication_completed', 1, 20], ['common_meeting', 15, 20],
    ['dim', 15, 20], ['personal_meeting', 1, 5], ['quotation', 1, 5],
    ['follow_up', 18, 6], ['hot', 6, 18], ['warm', 6, 18], ['process_incomplete', 6, 18],
  ])('%s uses %ih then %ih more in Old', (status, first, second) => {
    const start = new Date('2030-01-31T23:59:59.123Z');
    const result = journeyDeadlines(status, start);
    expect(result.policy_version).toBe(POLICY_VERSION);
    expect(result.move_to_old_at.getTime() - start.getTime()).toBe(first * 3600000);
    expect(result.move_to_pending_at.getTime() - result.move_to_old_at.getTime()).toBe(second * 3600000);
  });

  test.each([
    ['2030-09-26T15:00:00+05:30', '2030-09-26T16:00:00.000Z'],
    ['2030-09-26T21:29:00+05:30', '2030-09-26T16:00:00.000Z'],
    ['2030-09-26T21:30:00+05:30', '2030-09-26T16:00:00.000Z'],
    ['2030-09-26T21:30:00.001+05:30', '2030-09-27T16:00:00.000Z'],
    ['2030-09-26T21:32:00+05:30', '2030-09-27T16:00:00.000Z'],
    ['2030-12-31T21:32:00+05:30', '2031-01-01T16:00:00.000Z'],
    ['2028-02-28T21:32:00+05:30', '2028-02-29T16:00:00.000Z'],
    ['2030-09-26T20:00:00Z', '2030-09-27T16:00:00.000Z'],
  ])('Responded at %s uses Kolkata cutoff %s', (start, expected) => {
    const result = journeyDeadlines('respond_hi', start);
    expect(result.move_to_old_at.toISOString()).toBe(expected);
    expect(result.move_to_pending_at.getTime()).toBe(Date.parse(expected) + 20 * 3600000);
  });

  test.each(['UTC', 'America/Los_Angeles', 'Asia/Kolkata'])('ignores server timezone %s', zone => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = zone;
      expect(journeyDeadlines('respond_hi', '2030-09-26T21:32:00+05:30').move_to_old_at.toISOString())
        .toBe('2030-09-27T16:00:00.000Z');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  test.each([
    'new', 'ccb', 'in', 'invalid_number', 'ni', 'wrong_number', 'language_barrier',
    'special_category', 'call_reminder', 'handover_rm', 'not_attended', 'converted', 'cold', 'not_interested',
    'interested', 'unknown', 'constructor', '__proto__',
  ])('%s receives no fallback timer', status => {
    expect(journeyDeadlines(status, new Date())).toBeNull();
  });
  test('rejects an invalid workflow timestamp', () => {
    expect(() => journeyDeadlines('hot', 'invalid')).toThrow('valid workflow start');
  });
});

describe('Stage 4 New and call-issue deadline policies', () => {
  const hour = 3600000;
  const cases = [
    ['2030-09-26T09:00:00+05:30','2030-09-26T11:00:00+05:30'],
    ['2030-09-26T15:30:00+05:30','2030-09-26T17:30:00+05:30'],
    ['2030-09-26T17:00:00+05:30','2030-09-26T19:00:00+05:30'],
    ['2030-09-26T17:00:00.001+05:30','2030-09-27T10:00:00+05:30'],
    ['2030-09-26T18:00:00+05:30','2030-09-27T10:00:00+05:30'],
    ['2030-09-26T23:30:00+05:30','2030-09-27T10:00:00+05:30'],
    ['2030-09-26T07:30:00+05:30','2030-09-26T10:00:00+05:30'],
    ['2030-09-26T08:59:59.999+05:30','2030-09-26T10:00:00+05:30'],
    ['2030-09-26T00:00:00+05:30','2030-09-26T10:00:00+05:30'],
    ['2030-12-31T23:30:00+05:30','2031-01-01T10:00:00+05:30'],
    ['2028-02-28T18:00:00+05:30','2028-02-29T10:00:00+05:30'],
  ];
  test.each(cases)('New assigned at %s goes directly to Pending at %s', (at,expected) => {
    expect(newAssignmentDeadlines(at)).toEqual({policy_version:'new_assignment_v1',move_to_old_at:null,move_to_pending_at:new Date(expected)});
  });
  describe.each(['nrac','nracm','nrapm','nraf','nraq'])('%s boundaries', primary => {
    test.each(cases)('saved at %s goes to Old at %s then Pending +14h', (at,expected) => {
      const deadlines = journeyDeadlines(primary,at);
      expect(deadlines.policy_version).toBe('nr_family_v1');
      expect(deadlines.move_to_old_at).toEqual(new Date(expected));
      expect(deadlines.move_to_pending_at.getTime()).toBe(Date.parse(expected)+14*hour);
    });
  });
  test('retry mapping contains only inspected CRM codes and keeps NR distinct', () => {
    expect(RETRYABLE_ISSUES).toEqual(['cnr','recall','busy','cb','rnr','cw','nn','so','nc','call_cut_busy','switched_off']);
    expect(NR_STATUSES).toEqual(['nrac','nracm','nrapm','nraf','nraq']);
  });
  test.each(['cnr','recall','busy','cb','rnr','cw','nn','so','nc','call_cut_busy','switched_off'])('%s always uses 2h plus 22h, even after office hours', primary => {
    const at = new Date('2030-09-26T23:30:00+05:30');
    const deadlines = journeyDeadlines(primary,at);
    expect(deadlines.policy_version).toBe('call_issue_v1');
    expect(deadlines.move_to_old_at.getTime()).toBe(at.getTime()+2*hour);
    expect(deadlines.move_to_pending_at.getTime()).toBe(at.getTime()+24*hour);
  });
  test.each(['UTC','America/New_York','Asia/Kolkata'])('New and NR are independent of server timezone %s', zone => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = zone;
      const at = '2030-09-26T18:00:00+05:30';
      expect(newAssignmentDeadlines(at).move_to_pending_at.toISOString()).toBe('2030-09-27T04:30:00.000Z');
      expect(journeyDeadlines('nrac',at).move_to_old_at.toISOString()).toBe('2030-09-27T04:30:00.000Z');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
  test('invalid assignment timestamps are rejected', () => {
    expect(() => newAssignmentDeadlines('invalid')).toThrow('valid workflow start');
  });
});
