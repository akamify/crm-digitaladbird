jest.mock('../../config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(async callback => callback({ query: jest.fn() })),
}));
jest.mock('../../middleware/rbac', () => ({ getVisibleUserIds: jest.fn() }));
jest.mock('../leadCommunicationAccess', () => ({ assertLeadCommunicationAccess: jest.fn() }));

const database = require('../../config/database');
const { getVisibleUserIds } = require('../../middleware/rbac');
const lifecycle = require('../lifecycleService');
const deadlineJob = require('../../jobs/lifecycleDeadlineJob');

const SETTINGS = {
  enabled: false,
  pilotUserIds: [],
  firstContactSlaMinutes: 15,
  respondedSlaMinutes: 15,
  callWindowStart: '09:00',
  callWindowEnd: '20:00',
  workingDays: [1, 2, 3, 4, 5, 6],
  commonMeetingStart: '21:00',
  commonMeetingEnd: '21:30',
  commonMeetingOutcomeDeadline: '11:00',
  stageFollowupMaxAttempts: 4,
};

const SETTINGS_ROWS = [
  ['lifecycle_v2_enabled', false],
  ['lifecycle_v2_pilot_user_ids', []],
  ['first_contact_sla_minutes', 15],
  ['responded_sla_minutes', 15],
  ['call_window_start', '09:00'],
  ['call_window_end', '20:00'],
  ['working_days', [1, 2, 3, 4, 5, 6]],
  ['common_meeting_start', '21:00'],
  ['common_meeting_end', '21:30'],
  ['common_meeting_outcome_deadline', '11:00'],
  ['stage_followup_max_attempts', 4],
].map(([key, value]) => ({ key, value }));

describe('Counselor Lifecycle V2', () => {
  beforeEach(() => jest.clearAllMocks());

  test('feature flag supports global and counselor pilot rollout', () => {
    expect(lifecycle.isEnabledFor({ ...SETTINGS, enabled: true }, { id: 'any' })).toBe(true);
    expect(lifecycle.isEnabledFor({ ...SETTINGS, pilotUserIds: ['pilot-id'] }, { id: 'pilot-id' })).toBe(true);
    expect(lifecycle.isEnabledFor(SETTINGS, { id: 'other-id' })).toBe(false);
  });

  test('moves calls before the calling window to 9 AM IST', () => {
    const value = lifecycle.clampToCallWindow(new Date('2026-09-11T01:30:00.000Z'), SETTINGS);
    expect(value.toISOString()).toBe('2026-09-11T03:30:00.000Z');
  });

  test('moves calls after the window and Sunday calls to next working slot', () => {
    const afterWindow = lifecycle.clampToCallWindow(new Date('2026-09-11T15:30:00.000Z'), SETTINGS);
    expect(afterWindow.toISOString()).toBe('2026-09-12T03:30:00.000Z');
    const sunday = lifecycle.clampToCallWindow(new Date('2026-09-13T05:30:00.000Z'), SETTINGS);
    expect(sunday.toISOString()).toBe('2026-09-14T03:30:00.000Z');
  });

  test('uses next working day 11 AM IST for meeting outcome deadline', () => {
    const value = lifecycle.nextWorkingDeadline(new Date('2026-09-12T16:00:00.000Z'), SETTINGS);
    expect(value.toISOString()).toBe('2026-09-14T05:30:00.000Z');
  });

  test('rejects malformed and reversed reporting periods', () => {
    expect(() => lifecycle.normalizePeriod({ from: '11-09-2026' })).toThrow('valid date range');
    expect(() => lifecycle.normalizePeriod({ from: '2026-09-12', to: '2026-09-11' })).toThrow('valid date range');
    expect(lifecycle.normalizePeriod({ from: '2026-09-11', to: '2026-09-12' })).toEqual({ from: '2026-09-11', to: '2026-09-12' });
  });

  test('workspace summary and drill-down reuse the same classified conditions', async () => {
    getVisibleUserIds.mockResolvedValue(['11111111-1111-4111-8111-111111111111']);
    const sql = [];
    database.query.mockImplementation(async statement => {
      sql.push(statement);
      if (statement.includes('FROM workflow_settings')) return { rows: SETTINGS_ROWS };
      if (statement.includes('FROM classified') && !statement.includes('filtered AS MATERIALIZED')) {
        return { rows: [{ received: 2, pending: 1 }] };
      }
      return { rows: [{ total: 1, rows: [{ id: 'lead-1' }] }] };
    });

    const result = await lifecycle.workspace({ id: 'member-1', role: 'member' }, {
      from: '2026-09-11', to: '2026-09-11', view: 'pending', page: 1,
    }, true);

    expect(result.total).toBe(1);
    const summarySql = sql.find(value => value.includes('FROM classified') && !value.includes('filtered AS MATERIALIZED'));
    const rowsSql = sql.find(value => value.includes('filtered AS MATERIALIZED'));
    expect(summarySql).toContain('WITH bounds AS MATERIALIZED');
    expect(rowsSql).toContain('WITH bounds AS MATERIALIZED');
    expect(rowsSql).toContain('terminal_state IS NULL AND is_pending');
    expect(summarySql).toContain('COUNT(*) FILTER (WHERE terminal_state IS NULL AND is_pending)');
  });

  test('legacy dual-write is a no-op while feature is disabled', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: SETTINGS_ROWS }) };
    const result = await lifecycle.syncLegacyRemark({ client, user: { id: 'member-1' }, leadId: 'lead-1', statuses: ['cnr'] });
    expect(result).toEqual({ enabled: false });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  test('reassignment realigns active action ownership in bounded batches', async () => {
    database.query.mockResolvedValue({ rowCount: 2, rows: [] });

    await expect(deadlineJob.realignActionOwners({ ...SETTINGS, enabled: true })).resolves.toBe(2);

    const [sql, params] = database.query.mock.calls[0];
    expect(sql).toContain("a.status IN ('scheduled','in_progress','paused','overdue')");
    expect(sql).toContain("a.action_type='manager_escalation'");
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual([null, 200]);
  });

  test('legacy dual-write tolerates migration not yet present during rolling deploy', async () => {
    const missing = Object.assign(new Error('missing relation'), { code: '42P01' });
    const client = { query: jest.fn().mockRejectedValue(missing) };
    await expect(lifecycle.syncLegacyRemark({ client, user: { id: 'member-1' }, leadId: 'lead-1', statuses: ['cnr'] }))
      .resolves.toEqual({ enabled: false, migration_pending: true });
  });

  test('stage follow-ups increment independently and 4/4 creates manager escalation', () => {
    const next = { actionType: 'follow_up', reason: 'post_personal_meeting', parentStage: 'personal_meeting', dueAt: new Date() };
    const second = lifecycle.applyStageFollowupPolicy({ action_type: 'follow_up', stage_followup_attempt: 1, stage_followup_max: 4 }, next, SETTINGS);
    expect(second.stageFollowupAttempt).toBe(2);
    expect(second.stageFollowupMax).toBe(4);

    const escalation = lifecycle.applyStageFollowupPolicy({ action_type: 'follow_up', stage_followup_attempt: 4, stage_followup_max: 4, parent_stage: 'personal_meeting' }, next, SETTINGS);
    expect(escalation).toEqual(expect.objectContaining({ actionType: 'manager_escalation', reason: 'stage_followup_exhausted', parentStage: 'personal_meeting' }));
  });

  test('CNR retry keeps Personal Meeting follow-up as its originating action', async () => {
    const enabledRows = SETTINGS_ROWS.map(row => row.key === 'lifecycle_v2_enabled' ? { ...row, value: true } : row);
    const statements = [];
    const client = {
      query: jest.fn(async (sql, params) => {
        statements.push({ sql, params });
        if (sql.includes('FROM workflow_settings')) return { rows: enabledRows };
        if (sql.includes('SELECT * FROM lead_lifecycle_state')) return { rows: [{
          lead_id: 'lead-1', journey_stage: 'personal_meeting', terminal_state: null,
          current_primary_action_id: 'action-followup-2', version: 3,
        }] };
        if (sql.includes('SELECT id,originating_action_id FROM lead_call_attempt_sequences')) return { rows: [{ id: 'sequence-1', originating_action_id: null }] };
        if (sql.includes("metadata->>'idempotency_key'")) return { rows: [] };
        return { rows: [], rowCount: 1 };
      }),
    };

    const result = await lifecycle.syncLegacyRemark({
      client,
      user: { id: 'member-1' },
      leadId: 'lead-1',
      statuses: ['cnr'],
      remarkId: 'remark-1',
    });

    expect(result.synced).toBe(true);
    const stateUpdate = statements.find(entry => entry.sql.includes('UPDATE lead_lifecycle_state SET journey_stage'));
    expect(stateUpdate.params[1]).toBe('personal_meeting');
    const retryLink = statements.find(entry => entry.sql.includes('UPDATE lead_call_attempt_sequences SET originating_action_id'));
    expect(retryLink.params).toEqual(['sequence-1', 'action-followup-2']);
  });

  test('non-retryable Invalid Number creates an explicit resolution action', async () => {
    const enabledRows = SETTINGS_ROWS.map(row => row.key === 'lifecycle_v2_enabled' ? { ...row, value: true } : row);
    const statements = [];
    const client = {
      query: jest.fn(async (sql, params) => {
        statements.push({ sql, params });
        if (sql.includes('FROM workflow_settings')) return { rows: enabledRows };
        if (sql.includes('SELECT * FROM lead_lifecycle_state')) return { rows: [{
          lead_id: 'lead-2', journey_stage: 'response', terminal_state: null,
          current_primary_action_id: null, version: 1,
        }] };
        if (sql.includes("metadata->>'idempotency_key'")) return { rows: [] };
        if (sql.includes('INSERT INTO lead_actions')) return { rows: [{ id: 'resolution-action' }] };
        return { rows: [], rowCount: 1 };
      }),
    };

    await lifecycle.syncLegacyRemark({
      client,
      user: { id: 'member-1' },
      leadId: 'lead-2',
      statuses: ['in'],
      remarkId: 'remark-2',
    });

    const actionInsert = statements.find(entry => entry.sql.includes('INSERT INTO lead_actions'));
    expect(actionInsert.params[1]).toBe('lifecycle_review');
    expect(actionInsert.params[2]).toBe('call_issue_requires_resolution');
    expect(statements.some(entry => entry.sql.includes('UPDATE lead_call_attempt_sequences SET originating_action_id'))).toBe(false);
  });
});
