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

  test('workspace returns summary and drill-down from one classified query', async () => {
    getVisibleUserIds.mockResolvedValue(['11111111-1111-4111-8111-111111111111']);
    const sql = [];
    database.query.mockImplementation(async statement => {
      sql.push(statement);
      if (statement.includes('FROM workflow_settings')) return { rows: SETTINGS_ROWS };
      return { rows: [{ summary: { received: 2, pending: 1 }, total: 1, rows: [{ id: 'lead-1' }] }] };
    });

    const result = await lifecycle.workspace({ id: 'member-1', role: 'member' }, {
      from: '2026-09-11', to: '2026-09-11', view: 'pending', page: 1,
    }, true);

    expect(result.total).toBe(1);
    expect(result.summary).toEqual(expect.objectContaining({ received: 2, pending: 1 }));
    const workspaceSql = sql.find(value => value.includes('filtered AS MATERIALIZED'));
    expect(workspaceSql).toContain('WITH bounds AS MATERIALIZED');
    expect(workspaceSql).toContain('is_received AND terminal_state IS NULL AND is_pending');
    expect(workspaceSql).toContain('workspace_summary AS MATERIALIZED');
    expect(workspaceSql).toContain('COUNT(*) FILTER (WHERE is_received)::int AS "received"');
    expect(workspaceSql).toContain('COUNT(*) FILTER (WHERE is_received AND terminal_state IS NULL AND is_unworked)::int AS "new"');
    expect(workspaceSql).toContain('COUNT(*) FILTER (WHERE is_received AND is_worked)::int AS "worked"');
    expect(workspaceSql).toContain('COUNT(*) FILTER (WHERE is_received AND terminal_state IS NULL AND is_pending)');
    expect(sql.filter(value => value.includes('WITH bounds AS MATERIALIZED'))).toHaveLength(1);
  });

  test('workspace reuses analytics filters for summary and rows', async () => {
    getVisibleUserIds.mockResolvedValue(['11111111-1111-4111-8111-111111111111']);
    const sql = [];
    database.query.mockImplementation(async statement => {
      sql.push(statement);
      if (statement.includes('FROM workflow_settings')) return { rows: SETTINGS_ROWS };
      if (statement.includes('filtered AS MATERIALIZED')) return { rows: [{ summary: {}, total: 0, rows: [] }] };
      return { rows: [{}] };
    });

    await lifecycle.workspace({ id: 'member-1', role: 'member' }, {
      lead_view: 'daily', from: '2026-09-11', to: '2026-09-11', view: 'worked',
      source: 'meta', remark_status: 'cnr', label_id: '22222222-2222-4222-8222-222222222222',
    }, true);

    const rowsSql = sql.find(value => value.includes('filtered AS MATERIALIZED'));
    expect(rowsSql).toContain('l.source::text = $5');
    expect(rowsSql).toContain('distribution_remark.lead_id = l.id');
    expect(rowsSql).toContain('distribution_label.lead_id = l.id');
    expect(rowsSql).toContain('workspace_summary AS MATERIALIZED');
    expect(rowsSql).toContain("COALESCE(l.assigned_at,l.created_at) >= b.from_at");
    expect(rowsSql).toContain('e.occurred_at>=COALESCE(l.assigned_at,l.created_at)');
    expect(rowsSql).not.toContain('e.occurred_at >= b.from_at');
    expect(rowsSql).toContain("COALESCE(labels.items,'[]'::jsonb) AS labels");
    expect(rowsSql).toContain('latest_retry.scheduled_at AS next_retry_at');
    expect(rowsSql).toContain('GREATEST(latest_remark.created_at,last_call.created_at,last_event.occurred_at) AS latest_interaction_at');
  });

  test('workspace all-time activity removes date predicates but preserves live overlap flags', async () => {
    getVisibleUserIds.mockResolvedValue(['11111111-1111-4111-8111-111111111111']);
    const sql = [];
    database.query.mockImplementation(async statement => {
      sql.push(statement);
      if (statement.includes('FROM workflow_settings')) return { rows: SETTINGS_ROWS };
      return { rows: [{}] };
    });

    const result = await lifecycle.workspace({ id: 'member-1', role: 'member' }, { lead_view: 'all_time' }, false);

    expect(result.period).toEqual({ view: 'all_time', from: null, to: null });
    const summarySql = sql.find(value => value.includes('FROM classified'));
    expect(summarySql).toContain("journey_stage='personal_meeting'");
    expect(summarySql).toContain('is_received AND terminal_state IS NULL AND has_call_issue');
    expect(summarySql).toContain('is_received AND terminal_state IS NULL AND is_pending');
    expect(summarySql).not.toContain('e.occurred_at >= b.from_at');
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

  test('repairs existing immediate response deadlines without deleting lifecycle history', async () => {
    database.query.mockResolvedValue({ rows: [{
      id: 'old-action', lead_id: 'lead-legacy', status: 'overdue', response_at: '2026-09-14T03:30:00.000Z',
    }] });
    const statements = [];
    database.withTransaction.mockImplementationOnce(async callback => callback({
      query: jest.fn(async (sql, params) => {
        statements.push({ sql, params });
        if (sql.includes('SELECT a.id,a.status')) return { rows: [{ id: 'old-action', status: 'overdue' }] };
        return { rows: [], rowCount: 1 };
      }),
    }));

    await expect(deadlineJob.repairLegacyMeetingDeadlines({ ...SETTINGS, enabled: true })).resolves.toBe(1);

    const update = statements.find(entry => entry.sql.includes("action_type='common_meeting_outcome'"));
    expect(update.params[1]).toBe('2026-09-15T05:30:00.000Z');
    expect(update.sql).toContain('scheduled_at=NULL');
    expect(statements.some(entry => entry.sql.includes("event_type,stage_before") && entry.sql.includes("'action_rescheduled'"))).toBe(true);
    expect(statements.some(entry => entry.sql.includes("journey_stage='common_meeting'"))).toBe(true);
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

  test('Invalid Number closes the lifecycle as an invalid lead', async () => {
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

    const stateClose = statements.find(entry => entry.sql.includes('SET terminal_state=$2'));
    expect(stateClose.params).toEqual(['lead-2', 'cold', 'invalid_lead']);
    expect(statements.some(entry => entry.sql.includes('INSERT INTO lead_actions'))).toBe(false);
    expect(statements.some(entry => entry.sql.includes('UPDATE lead_call_attempt_sequences SET originating_action_id'))).toBe(false);
  });

  test.each(['communication_completed', 'respond_hi'])('%s replaces an overdue action with a Common Meeting deadline', async status => {
    const enabledRows = SETTINGS_ROWS.map(row => row.key === 'lifecycle_v2_enabled' ? { ...row, value: true } : row);
    const statements = [];
    const client = {
      query: jest.fn(async (sql, params) => {
        statements.push({ sql, params });
        if (sql.includes('FROM workflow_settings')) return { rows: enabledRows };
        if (sql.includes('SELECT * FROM lead_lifecycle_state')) return { rows: [{
          lead_id: 'lead-3', journey_stage: 'response', terminal_state: null,
          current_primary_action_id: 'overdue-action', version: 2,
        }] };
        if (sql.includes("metadata->>'idempotency_key'")) return { rows: [] };
        if (sql.includes('INSERT INTO lead_actions')) return { rows: [{ id: 'common-meeting-action' }] };
        return { rows: [], rowCount: 1 };
      }),
    };

    await lifecycle.syncLegacyRemark({
      client, user: { id: 'member-1' }, leadId: 'lead-3', statuses: [status], remarkId: `remark-${status}`,
      now: new Date('2026-09-14T03:30:00.000Z'),
    });

    const actionInsert = statements.find(entry => entry.sql.includes('INSERT INTO lead_actions'));
    expect(actionInsert.sql).toContain('VALUES ($1,$2::varchar');
    expect(actionInsert.sql).toContain("WHEN $2::varchar='manager_escalation'");
    expect(actionInsert.params[1]).toBe('common_meeting_outcome');
    expect(actionInsert.params[2]).toBe('common_meeting_outcome_not_updated');
    expect(actionInsert.params[3]).toBe('common_meeting');
    expect(actionInsert.params[7]).toBe('2026-09-15T05:30:00.000Z');
    expect(actionInsert.params[11]).toBeNull();
    expect(JSON.parse(actionInsert.params[9])).not.toHaveProperty('meeting_at');
    expect(statements.some(entry => entry.sql.includes("SET status = 'cancelled'"))).toBe(true);
    const stateUpdate = statements.find(entry => entry.sql.includes('UPDATE lead_lifecycle_state SET journey_stage'));
    expect(stateUpdate.params[1]).toBe('common_meeting');
    expect(stateUpdate.params[3]).toBe('common-meeting-action');
  });

  test('direct Common Meeting attendance creates an outcome deadline without a prior schedule', async () => {
    const enabledRows = SETTINGS_ROWS.map(row => row.key === 'lifecycle_v2_enabled' ? { ...row, value: true } : row);
    const statements = [];
    const client = {
      query: jest.fn(async (sql, params) => {
        statements.push({ sql, params });
        if (sql.includes('FROM workflow_settings')) return { rows: enabledRows };
        if (sql.includes('SELECT * FROM lead_lifecycle_state')) return { rows: [{
          lead_id: 'lead-direct', journey_stage: 'response', terminal_state: null,
          current_primary_action_id: null, version: 1,
        }] };
        if (sql.includes("metadata->>'idempotency_key'")) return { rows: [] };
        if (sql.includes('INSERT INTO lead_actions')) return { rows: [{ id: 'outcome-action' }] };
        return { rows: [], rowCount: 1 };
      }),
    };

    await lifecycle.syncLegacyRemark({
      client, user: { id: 'member-1' }, leadId: 'lead-direct',
      statuses: ['session_730_attend'], remarkId: 'remark-direct',
      now: new Date('2026-09-14T16:00:00.000Z'),
    });

    const actionInsert = statements.find(entry => entry.sql.includes('INSERT INTO lead_actions'));
    expect(actionInsert.params[1]).toBe('common_meeting_outcome');
    expect(actionInsert.params[7]).toBe('2026-09-15T05:30:00.000Z');
  });

  test('missed Common Meeting outcome creates the next re-contact action', async () => {
    const enabledRows = SETTINGS_ROWS.map(row => row.key === 'lifecycle_v2_enabled' ? { ...row, value: true } : row);
    const statements = [];
    const state = {
      lead_id: 'lead-missed', journey_stage: 'common_meeting', terminal_state: null,
      current_primary_action_id: 'outcome-action', version: 2,
    };
    const client = {
      query: jest.fn(async (sql, params) => {
        statements.push({ sql, params });
        if (sql.includes('FROM workflow_settings')) return { rows: enabledRows };
        if (sql.includes('SELECT * FROM lead_lifecycle_state')) return { rows: [state] };
        if (sql.includes("metadata->>'idempotency_key'")) return { rows: [] };
        if (sql.includes('SELECT * FROM lead_actions WHERE id=')) return { rows: [{
          id: 'outcome-action', action_type: 'common_meeting_outcome', status: 'overdue',
          due_at: '2026-09-14T05:30:00.000Z', parent_stage: 'common_meeting',
        }] };
        if (sql.includes('INSERT INTO lead_actions')) return { rows: [{ id: 'recontact-action' }] };
        if (sql.includes('SELECT ls.*')) return { rows: [{ ...state, current_primary_action_id: 'recontact-action' }] };
        return { rows: [] };
      }),
    };
    database.withTransaction.mockImplementationOnce(async callback => callback(client));

    await lifecycle.completeAction({ id: 'member-1', role: 'member' }, 'lead-missed', 'outcome-action', {
      idempotency_key: 'complete-missed', outcome: 'missed', expected_version: 2,
    });

    const actionInsert = statements.find(entry => entry.sql.includes('INSERT INTO lead_actions'));
    expect(actionInsert.params[1]).toBe('recontact');
    expect(actionInsert.params[2]).toBe('common_meeting_no_show');
    expect(actionInsert.params[3]).toBe('common_meeting');
  });

  test('Common Meeting attendance preserves the scheduled meeting outcome deadline', async () => {
    const enabledRows = SETTINGS_ROWS.map(row => row.key === 'lifecycle_v2_enabled' ? { ...row, value: true } : row);
    const statements = [];
    const client = {
      query: jest.fn(async (sql, params) => {
        statements.push({ sql, params });
        if (sql.includes('FROM workflow_settings')) return { rows: enabledRows };
        if (sql.includes('SELECT * FROM lead_lifecycle_state')) return { rows: [{
          lead_id: 'lead-scheduled', journey_stage: 'common_meeting', terminal_state: null,
          current_primary_action_id: 'meeting-action', version: 2,
        }] };
        if (sql.includes("metadata->>'idempotency_key'")) return { rows: [] };
        if (sql.includes('SELECT id,action_type,due_at')) return { rows: [{
          id: 'meeting-action', action_type: 'common_meeting', status: 'scheduled',
          scheduled_at: '2026-09-14T15:30:00.000Z', due_at: '2026-09-15T05:30:00.000Z',
        }] };
        if (sql.includes('INSERT INTO lead_actions')) return { rows: [{ id: 'outcome-action' }] };
        return { rows: [], rowCount: 1 };
      }),
    };

    await lifecycle.syncLegacyRemark({
      client, user: { id: 'member-1' }, leadId: 'lead-scheduled',
      statuses: ['session_730_attend', 'communication_completed'], remarkId: 'remark-attended',
      now: new Date('2026-09-14T16:15:00.000Z'),
    });

    const actionInsert = statements.find(entry => entry.sql.includes('INSERT INTO lead_actions'));
    expect(actionInsert.params[1]).toBe('common_meeting_outcome');
    expect(actionInsert.params[7]).toBe('2026-09-15T05:30:00.000Z');
    expect(statements.some(entry => entry.sql.includes("SET status = 'cancelled'"))).toBe(true);
  });

  test.each([
    ['yes_after_730_session', 'lifecycle_review', 'next_action_not_selected'],
    ['interested', 'lifecycle_review', 'next_action_not_selected'],
    ['follow_up', 'follow_up', 'legacy_follow_up'],
  ])('%s keeps the lead active with a next-working-day action', async (status, actionType, reason) => {
    const enabledRows = SETTINGS_ROWS.map(row => row.key === 'lifecycle_v2_enabled' ? { ...row, value: true } : row);
    const statements = [];
    const client = {
      query: jest.fn(async (sql, params) => {
        statements.push({ sql, params });
        if (sql.includes('FROM workflow_settings')) return { rows: enabledRows };
        if (sql.includes('SELECT * FROM lead_lifecycle_state')) return { rows: [{
          lead_id: 'lead-active', journey_stage: 'common_meeting', terminal_state: null,
          current_primary_action_id: null, version: 2,
        }] };
        if (sql.includes("metadata->>'idempotency_key'")) return { rows: [] };
        if (sql.includes('INSERT INTO lead_actions')) return { rows: [{ id: 'next-action' }] };
        return { rows: [], rowCount: 1 };
      }),
    };

    await lifecycle.syncLegacyRemark({
      client, user: { id: 'member-1' }, leadId: 'lead-active', statuses: [status], remarkId: `remark-${status}`,
      now: new Date('2026-09-14T06:30:00.000Z'),
    });

    const actionInsert = statements.find(entry => entry.sql.includes('INSERT INTO lead_actions'));
    expect(actionInsert.params[1]).toBe(actionType);
    expect(actionInsert.params[2]).toBe(reason);
    expect(actionInsert.params[7]).toBe('2026-09-15T05:30:00.000Z');
  });

  test.each([
    ['hot_trader', 'lifecycle_review'],
    ['interested', 'lifecycle_review'],
    ['follow_up_required', 'follow_up'],
  ])('%s classification renews the active lead deadline', async (status, actionType) => {
    const enabledRows = SETTINGS_ROWS.map(row => row.key === 'lifecycle_v2_enabled' ? { ...row, value: true } : row);
    const statements = [];
    const client = {
      query: jest.fn(async (sql, params) => {
        statements.push({ sql, params });
        if (sql.includes('FROM workflow_settings')) return { rows: enabledRows };
        if (sql.includes('SELECT * FROM lead_lifecycle_state')) return { rows: [{
          lead_id: 'lead-hot', journey_stage: 'common_meeting', terminal_state: null,
          current_primary_action_id: 'old-action', version: 3,
        }] };
        if (sql.includes("metadata->>'idempotency_key'")) return { rows: [] };
        if (sql.includes('SELECT id FROM lead_call_attempt_sequences')) return { rows: [] };
        if (sql.includes('INSERT INTO lead_actions')) return { rows: [{ id: 'hot-action' }] };
        return { rows: [], rowCount: 1 };
      }),
    };

    await lifecycle.syncLegacyLeadLevel({
      client, user: { id: 'member-1' }, leadId: 'lead-hot', statuses: [status], historyId: `history-${status}`,
      now: new Date('2026-09-14T06:30:00.000Z'),
    });

    const actionInsert = statements.find(entry => entry.sql.includes('INSERT INTO lead_actions'));
    expect(actionInsert.params[1]).toBe(actionType);
    expect(actionInsert.params[2]).toBe(`lead_category_${status}`);
    expect(actionInsert.params[7]).toBe('2026-09-15T05:30:00.000Z');
    expect(statements.some(entry => entry.sql.includes("SET status = 'cancelled'"))).toBe(true);
  });

  test('Cold Trader classification closes future action and retry cycles', async () => {
    const enabledRows = SETTINGS_ROWS.map(row => row.key === 'lifecycle_v2_enabled' ? { ...row, value: true } : row);
    const statements = [];
    const client = {
      query: jest.fn(async (sql, params) => {
        statements.push({ sql, params });
        if (sql.includes('FROM workflow_settings')) return { rows: enabledRows };
        if (sql.includes('SELECT * FROM lead_lifecycle_state')) return { rows: [{
          lead_id: 'lead-cold', journey_stage: 'response', terminal_state: null,
          current_primary_action_id: 'old-action', version: 2,
        }] };
        if (sql.includes("metadata->>'idempotency_key'")) return { rows: [] };
        return { rows: [], rowCount: 1 };
      }),
    };

    const result = await lifecycle.syncLegacyLeadLevel({
      client, user: { id: 'member-1' }, leadId: 'lead-cold', statuses: ['cold_trader'], historyId: 'history-cold',
    });

    expect(result.terminal_state).toBe('cold');
    expect(statements.some(entry => entry.sql.includes("UPDATE lead_call_attempt_sequences SET status=$2"))).toBe(true);
    const stateClose = statements.find(entry => entry.sql.includes('SET terminal_state=$2'));
    expect(stateClose.params).toEqual(['lead-cold', 'cold', 'legacy_import']);
  });
});
