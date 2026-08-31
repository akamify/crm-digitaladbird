process.env.PROCESS_TZ = 'Asia/Kolkata';

jest.mock('../../config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../leadInteractionService', () => ({
  createLeadInteraction: jest.fn(),
}));

jest.mock('../leadWorkflowRemarkService', () => ({
  saveWorkflowRemark: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../utils/auditLog', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const { AppError } = require('../../utils/errors');
const { logActivity } = require('../../utils/auditLog');
const { createLeadInteraction } = require('../leadInteractionService');
const { saveWorkflowRemark } = require('../leadWorkflowRemarkService');
const {
  calculateNextCallTime,
  deriveAttemptState,
  normalizeAttemptOutcome,
  completeScheduledAttempt,
  getColdLeadLevelForCategory,
  reconcileWorkflowRemarkWithCallAttempts,
} = require('../leadCallAttemptService');

function response(rows = []) {
  return Promise.resolve({ rows, rowCount: rows.length });
}

describe('leadCallAttemptService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CALL_ATTEMPT_MONITORING_ENABLED;
    delete process.env.CALL_ATTEMPT_MONITORING_UNTIL;
  });

  test('CNR attempt 1 schedules attempt 2 three hours later', () => {
    const attemptedAt = new Date('2026-08-30T08:30:00.000Z');
    const next = calculateNextCallTime({
      issueType: 'cnr',
      attemptNumber: 1,
      attemptedAt,
    });
    expect(next.toISOString()).toBe('2026-08-30T11:30:00.000Z');
  });

  test('CNR attempt 2 schedules next business day at 11:00 AM IST', () => {
    const attemptedAt = new Date('2026-08-30T11:30:00.000Z');
    const next = calculateNextCallTime({
      issueType: 'cnr',
      attemptNumber: 2,
      attemptedAt,
    });
    expect(next.toISOString()).toBe('2026-08-31T05:30:00.000Z');
  });

  test('CNR late-evening retry snaps to next business opening', () => {
    const attemptedAt = new Date('2026-08-30T13:00:00.000Z');
    const next = calculateNextCallTime({
      issueType: 'cnr',
      attemptNumber: 1,
      attemptedAt,
    });
    expect(next.toISOString()).toBe('2026-08-31T03:30:00.000Z');
  });

  test('Busy uses a 30-minute retry policy', () => {
    const attemptedAt = new Date('2026-08-30T08:30:00.000Z');
    const next = calculateNextCallTime({
      issueType: 'busy',
      attemptNumber: 1,
      attemptedAt,
    });
    expect(next.toISOString()).toBe('2026-08-30T09:00:00.000Z');
  });

  test('Final recovery stays ten days later at the prior business-time slot', () => {
    const attemptedAt = new Date('2026-08-31T05:32:00.000Z');
    const next = calculateNextCallTime({
      issueType: 'cnr',
      attemptNumber: 3,
      attemptedAt,
    });
    expect(next.toISOString()).toBe('2026-09-10T05:32:00.000Z');
  });

  test('deriveAttemptState marks future attempts as locked', () => {
    const attempt = deriveAttemptState({
      id: 'a1',
      status: 'scheduled',
      scheduled_at: '2026-08-30T12:00:00.000Z',
    }, new Date('2026-08-30T11:00:00.000Z'));
    expect(attempt.ui_state).toBe('locked');
    expect(attempt.available_in_minutes).toBe(60);
    expect(attempt.can_complete).toBe(false);
  });

  test('deriveAttemptState marks late attempts as overdue but actionable', () => {
    const attempt = deriveAttemptState({
      id: 'a2',
      status: 'scheduled',
      scheduled_at: '2026-08-30T10:00:00.000Z',
    }, new Date('2026-08-30T10:42:00.000Z'));
    expect(attempt.ui_state).toBe('overdue');
    expect(attempt.is_overdue).toBe(true);
    expect(attempt.overdue_by_minutes).toBe(42);
    expect(attempt.can_complete).toBe(true);
  });

  test('normalizeAttemptOutcome accepts CR alias', () => {
    expect(normalizeAttemptOutcome('CR')).toBe('call_received');
  });

  test('getColdLeadLevelForCategory reuses existing cold status model', () => {
    expect(getColdLeadLevelForCategory('partner')).toBe('cold_partner');
    expect(getColdLeadLevelForCategory('trader')).toBe('cold_trader');
    expect(getColdLeadLevelForCategory('unknown')).toBe('cold_lead');
  });

  test('completeScheduledAttempt rejects completion before scheduled time', async () => {
    const client = {
      query: jest.fn()
        .mockImplementationOnce(() => response([{ id: 'lead-1', assigned_to_user_id: 'user-1', category: 'partner' }]))
        .mockImplementationOnce(() => response([{ id: 'seq-1', lead_id: 'lead-1', status: 'active', initial_trigger_reason: 'cnr' }]))
        .mockImplementationOnce(() => response([{
          id: 'attempt-2',
          sequence_id: 'seq-1',
          lead_id: 'lead-1',
          attempt_number: 2,
          status: 'scheduled',
          scheduled_at: '2026-08-30T11:30:00.000Z',
        }])),
    };

    await expect(completeScheduledAttempt({
      client,
      leadId: 'lead-1',
      attemptId: 'attempt-2',
      user: { id: 'user-1', role: 'member', full_name: 'Faizan' },
      outcome: 'cnr',
      now: new Date('2026-08-30T11:00:00.000Z'),
    })).rejects.toMatchObject({ code: 'CALL_ATTEMPT_LOCKED' });

    expect(logActivity).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      entity: 'lead_call_attempt',
      action: 'CALL_ATTEMPT_LOCKED',
    }));
  });

  test('retryable remark path also rejects advancing a locked future attempt', async () => {
    const client = {
      query: jest.fn()
        .mockImplementationOnce(() => response([{ id: 'seq-1', lead_id: 'lead-1', status: 'active', initial_trigger_reason: 'cnr' }]))
        .mockImplementationOnce(() => response([{
          id: 'attempt-2',
          sequence_id: 'seq-1',
          lead_id: 'lead-1',
          attempt_number: 2,
          status: 'scheduled',
          scheduled_at: '2026-08-30T11:30:00.000Z',
        }])),
    };

    const promise = reconcileWorkflowRemarkWithCallAttempts({
      client,
      leadId: 'lead-1',
      user: { id: 'user-1' },
      triggerStatus: 'busy',
      now: new Date('2026-08-30T11:00:00.000Z'),
    });

    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toMatchObject({ code: 'CALL_ATTEMPT_LOCKED' });
  });

  test('temporary monitoring honors CALL_ATTEMPT_MONITORING_ENABLED=false', async () => {
    process.env.CALL_ATTEMPT_MONITORING_ENABLED = 'false';

    const client = {
      query: jest.fn()
        .mockImplementationOnce(() => response([{ id: 'lead-1', assigned_to_user_id: 'user-1', category: 'partner' }]))
        .mockImplementationOnce(() => response([{ id: 'seq-1', lead_id: 'lead-1', status: 'active', initial_trigger_reason: 'cnr' }]))
        .mockImplementationOnce(() => response([{
          id: 'attempt-2',
          sequence_id: 'seq-1',
          lead_id: 'lead-1',
          attempt_number: 2,
          status: 'scheduled',
          scheduled_at: '2026-08-30T11:30:00.000Z',
        }])),
    };

    await expect(completeScheduledAttempt({
      client,
      leadId: 'lead-1',
      attemptId: 'attempt-2',
      user: { id: 'user-1', role: 'member', full_name: 'Faizan' },
      outcome: 'cnr',
      now: new Date('2026-08-30T11:00:00.000Z'),
    })).rejects.toMatchObject({ code: 'CALL_ATTEMPT_LOCKED' });

    expect(logActivity).not.toHaveBeenCalled();
  });

  test('temporary monitoring honors CALL_ATTEMPT_MONITORING_UNTIL expiry', async () => {
    process.env.CALL_ATTEMPT_MONITORING_UNTIL = '2026-08-30T10:59:00.000Z';

    const client = {
      query: jest.fn()
        .mockImplementationOnce(() => response([{ id: 'lead-1', assigned_to_user_id: 'user-1', category: 'partner' }]))
        .mockImplementationOnce(() => response([{ id: 'seq-1', lead_id: 'lead-1', status: 'active', initial_trigger_reason: 'cnr' }]))
        .mockImplementationOnce(() => response([{
          id: 'attempt-2',
          sequence_id: 'seq-1',
          lead_id: 'lead-1',
          attempt_number: 2,
          status: 'scheduled',
          scheduled_at: '2026-08-30T11:30:00.000Z',
        }])),
    };

    await expect(completeScheduledAttempt({
      client,
      leadId: 'lead-1',
      attemptId: 'attempt-2',
      user: { id: 'user-1', role: 'member', full_name: 'Faizan' },
      outcome: 'cnr',
      now: new Date('2026-08-30T11:00:00.000Z'),
    })).rejects.toMatchObject({ code: 'CALL_ATTEMPT_LOCKED' });

    expect(logActivity).not.toHaveBeenCalled();
  });

  test('duplicate attempt completion is logged and does not create another attempt', async () => {
    const client = {
      query: jest.fn()
        .mockImplementationOnce(() => response([{ id: 'lead-1', assigned_to_user_id: 'user-1', category: 'partner' }]))
        .mockImplementationOnce(() => response([{ id: 'seq-1', lead_id: 'lead-1', status: 'active', initial_trigger_reason: 'cnr' }]))
        .mockImplementationOnce(() => response([{
          id: 'attempt-2',
          sequence_id: 'seq-1',
          lead_id: 'lead-1',
          attempt_number: 2,
          status: 'completed',
          scheduled_at: '2026-08-30T11:30:00.000Z',
          attempted_at: '2026-08-30T11:33:00.000Z',
        }])),
    };

    const result = await completeScheduledAttempt({
      client,
      leadId: 'lead-1',
      attemptId: 'attempt-2',
      user: { id: 'user-1', role: 'member', full_name: 'Faizan' },
      outcome: 'busy',
      now: new Date('2026-08-30T11:40:00.000Z'),
    });

    expect(result.alreadyProcessed).toBe(true);
    expect(logActivity).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      entity: 'lead_call_attempt',
      action: 'CALL_ATTEMPT_DUPLICATE_COMPLETION',
    }));
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  test('first retryable remark logs scheduling failures for super admin monitoring', async () => {
    const schedulingError = new Error('attempt insert failed');
    const client = {
      query: jest.fn()
        .mockImplementationOnce(() => response([]))
        .mockImplementationOnce(() => response([{ id: 'lead-1', assigned_to_user_id: 'user-1', category: 'partner' }]))
        .mockImplementationOnce(() => response([]))
        .mockImplementationOnce(() => response([{ id: 'seq-1', lead_id: 'lead-1', status: 'active', initial_trigger_reason: 'cnr' }]))
        .mockImplementationOnce(() => response([]))
        .mockImplementationOnce(() => response([{
          id: 'attempt-1',
          sequence_id: 'seq-1',
          lead_id: 'lead-1',
          attempt_number: 1,
          status: 'completed',
          scheduled_at: '2026-08-30T08:30:00.000Z',
          attempted_at: '2026-08-30T08:30:00.000Z',
        }]))
        .mockImplementationOnce(() => response([]))
        .mockImplementationOnce(() => Promise.reject(schedulingError)),
    };

    await expect(reconcileWorkflowRemarkWithCallAttempts({
      client,
      leadId: 'lead-1',
      user: { id: 'user-1', role: 'member', full_name: 'Faizan' },
      triggerStatus: 'cnr',
      now: new Date('2026-08-30T08:30:00.000Z'),
    })).rejects.toThrow('attempt insert failed');

    expect(logActivity).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      entity: 'lead_call_attempt',
      action: 'CALL_ATTEMPT_NEXT_SCHEDULE_FAILED',
    }));
  });

  test('completeScheduledAttempt with call received closes the sequence and reuses communication completed flow', async () => {
    createLeadInteraction.mockResolvedValue({ workflow: { remark_status: 'communication_completed' } });

    const client = {
      query: jest.fn()
        .mockImplementationOnce(() => response([{ id: 'lead-1', assigned_to_user_id: 'user-1', category: 'partner' }]))
        .mockImplementationOnce(() => response([{ id: 'seq-1', lead_id: 'lead-1', status: 'active', initial_trigger_reason: 'cnr' }]))
        .mockImplementationOnce(() => response([{
          id: 'attempt-2',
          sequence_id: 'seq-1',
          lead_id: 'lead-1',
          attempt_number: 2,
          status: 'scheduled',
          scheduled_at: '2026-08-30T11:30:00.000Z',
          is_final_attempt: false,
        }]))
        .mockImplementationOnce(() => response([{
          id: 'attempt-2',
          sequence_id: 'seq-1',
          lead_id: 'lead-1',
          attempt_number: 2,
          status: 'completed',
          scheduled_at: '2026-08-30T11:30:00.000Z',
          attempted_at: '2026-08-30T11:30:00.000Z',
          is_final_attempt: false,
        }]))
        .mockImplementationOnce(() => response([]))
        .mockImplementationOnce(() => response([{ id: 'future-3', attempt_number: 3 }]))
        .mockImplementationOnce(() => response([{ lead_id: 'lead-1' }]))
        .mockImplementationOnce(() => response([]))
        .mockImplementationOnce(() => response([{ id: 'seq-1', status: 'completed', closed_reason: 'call_received' }]))
        .mockImplementationOnce(() => response([])),
    };

    const result = await completeScheduledAttempt({
      client,
      leadId: 'lead-1',
      attemptId: 'attempt-2',
      user: { id: 'user-1', role: 'member', full_name: 'Faizan' },
      outcome: 'call_received',
      now: new Date('2026-08-30T11:30:00.000Z'),
    });

    expect(result.outcome).toBe('call_received');
    expect(createLeadInteraction).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead-1',
      status: 'communication_completed',
      workflowStep: 1,
      syncWorkflowStep1: true,
    }));
    expect(client.query.mock.calls.some(([sql]) => sql.includes("SET status = 'cancelled'"))).toBe(true);
  });

  test('a retry outcome replaces stale retryable Step 1 selections without removing other statuses', async () => {
    const client = {
      query: jest.fn((sql) => {
        if (sql.includes('SELECT id, assigned_to_user_id, category')) {
          return response([{ id: 'lead-1', assigned_to_user_id: 'user-1', category: 'partner' }]);
        }
        if (sql.includes('FROM lead_call_attempt_sequences')) {
          return response([{ id: 'seq-1', lead_id: 'lead-1', status: 'active', initial_trigger_reason: 'so' }]);
        }
        if (sql.includes('FROM lead_call_attempts') && sql.includes('WHERE id = $1')) {
          return response([{
            id: 'attempt-2', sequence_id: 'seq-1', lead_id: 'lead-1', attempt_number: 2,
            status: 'scheduled', scheduled_at: '2026-08-30T11:30:00.000Z', is_final_attempt: false,
          }]);
        }
        if (sql.includes('UPDATE lead_call_attempts')) {
          return response([{
            id: 'attempt-2', sequence_id: 'seq-1', lead_id: 'lead-1', attempt_number: 2,
            status: 'completed', scheduled_at: '2026-08-30T11:30:00.000Z', attempted_at: '2026-08-30T11:35:00.000Z',
          }]);
        }
        if (sql.includes('INSERT INTO lead_call_attempts')) {
          return response([{
            id: 'attempt-3', sequence_id: 'seq-1', lead_id: 'lead-1', attempt_number: 3,
            status: 'scheduled', scheduled_at: '2026-08-31T05:30:00.000Z',
          }]);
        }
        if (sql.includes('SELECT remark_status, step_1_statuses')) {
          return response([{ remark_status: 'recall', step_1_statuses: ['recall', 'custom_remark'] }]);
        }
        return response([]);
      }),
    };

    await completeScheduledAttempt({
      client,
      leadId: 'lead-1',
      attemptId: 'attempt-2',
      user: { id: 'user-1', role: 'member', full_name: 'Faizan' },
      outcome: 'cnr',
      now: new Date('2026-08-30T11:35:00.000Z'),
    });

    expect(saveWorkflowRemark).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead-1',
      userId: 'user-1',
      remarkStatus: 'cnr',
      remarkStatuses: ['custom_remark', 'cnr'],
      source: 'call_attempt_outcome',
    }));
  });
});
