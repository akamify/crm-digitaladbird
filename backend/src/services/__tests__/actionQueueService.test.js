jest.mock('../../config/database', () => ({ query: jest.fn() }));
jest.mock('../../middleware/rbac', () => ({ getVisibleUserIds: jest.fn() }));

const { query } = require('../../config/database');
const { getVisibleUserIds } = require('../../middleware/rbac');
const service = require('../actionQueueService');

describe('action queue service', () => {
  beforeEach(() => {
    query.mockReset();
    getVisibleUserIds.mockReset();
  });

  test('validates queue filters and bounds pagination', () => {
    expect(service.normalizeInput({ type: 'meeting', page: '-2', page_size: '500', q: '  lead  ' }))
      .toEqual({ type: 'meeting', page: 1, pageSize: 100, search: 'lead', offset: 0 });
    expect(() => service.normalizeInput({ type: 'unknown' }))
      .toThrow(expect.objectContaining({ code: 'INVALID_ACTION_QUEUE_TYPE' }));
  });

  test('builds one prioritized query with IST bounds and all four task sources', () => {
    const built = service._buildQueueQuery({
      visibleIds: null, type: 'all', pageSize: 25, search: '', offset: 0,
    });

    expect(built.sql).toContain("AT TIME ZONE 'Asia/Kolkata'");
    expect(built.sql).toContain('overdue_retry_source AS MATERIALIZED');
    expect(built.sql).toContain('unworked_source AS MATERIALIZED');
    expect(built.sql).toContain('followup_source AS MATERIALIZED');
    expect(built.sql).toContain('meeting_source AS MATERIALIZED');
    expect(built.sql).toContain('ORDER BY priority_rank ASC, due_at ASC');
    expect(built.params).toEqual(['all', 25, 0]);
  });

  test('applies team visibility to leads and meetings for an RM', async () => {
    const visibleIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    getVisibleUserIds.mockResolvedValueOnce(visibleIds);
    query.mockResolvedValueOnce({ rows: [{
      summary: { total: 2, overdue_retry: 1, unworked: 1, followup: 0, meeting: 0 },
      total: 2,
      rows: [{ task_id: 'retry:a', task_type: 'overdue_retry', age_minutes: '15', attempt_number: '2', priority_rank: '1' }],
    }] });

    const result = await service.listActionQueue({ id: visibleIds[0], role: 'rm' }, { type: 'all' });

    expect(result.scope).toBe('team');
    expect(result.rows[0]).toMatchObject({ age_minutes: 15, attempt_number: 2, priority_rank: 1 });
    expect(query.mock.calls[0][0]).toContain('l.assigned_to_user_id = ANY($1::uuid[])');
    expect(query.mock.calls[0][0]).toContain('n.meeting_counselor_user_ids && $1::uuid[]');
    expect(query.mock.calls[0][1]).toEqual([visibleIds, 'all', 25, 0]);
  });

  test('returns an empty queue without querying when no users are visible', async () => {
    getVisibleUserIds.mockResolvedValueOnce([]);

    await expect(service.listActionQueue({ id: 'client', role: 'member' }, {}))
      .resolves.toMatchObject({ scope: 'self', total: 0, rows: [] });
    expect(query).not.toHaveBeenCalled();
  });

  test('rejects roles outside the operational CRM scope', async () => {
    await expect(service.listActionQueue({ id: 'client', role: 'client' }, {}))
      .rejects.toMatchObject({ code: 'ACTION_QUEUE_FORBIDDEN' });
    expect(getVisibleUserIds).not.toHaveBeenCalled();
  });
});
