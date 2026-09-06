jest.mock('../../config/database', () => ({ query: jest.fn() }));

const { query } = require('../../config/database');
const service = require('../leadSavedViewService');

const actor = { id: '11111111-1111-4111-8111-111111111111', role: 'member' };

describe('lead saved view service', () => {
  beforeEach(() => query.mockReset());

  test('keeps supported filters and drops paging, sorting, and unknown values', () => {
    expect(service.normalizeFilters({
      followup: 'today', followup_strict: 'true', pending: 'true', page: 9,
      from: '2026-09-01', to: '2026-09-05', page_size: 100,
      sort: 'created_at', q: 'private search', unknown: 'value',
    })).toEqual({
      followup: 'today', followup_strict: 'true', pending: 'true',
      from: '2026-09-01', to: '2026-09-05',
    });
  });

  test('rejects malformed filters and validates names', () => {
    expect(() => service.normalizeFilters({ followup: 'someday' })).toThrow(expect.objectContaining({ code: 'INVALID_SAVED_VIEW_FILTER' }));
    expect(() => service.normalizeFilters({ label_id: 'not-a-uuid' })).toThrow(expect.objectContaining({ code: 'INVALID_SAVED_VIEW_FILTER' }));
    expect(() => service.normalizeFilters({ selected_date: '2026-02-30' })).toThrow(expect.objectContaining({ code: 'INVALID_SAVED_VIEW_FILTER' }));
    expect(() => service.normalizeName('   ')).toThrow(expect.objectContaining({ code: 'INVALID_SAVED_VIEW_NAME' }));
  });

  test('creates an owner-scoped view with normalized filters', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'view', name: 'Today Follow-ups', filters: { followup: 'today' } }] });
    await service.createView(actor, { name: '  Today   Follow-ups ', filters: { followup: 'today', page: 3 } });

    expect(query.mock.calls[0][0]).toContain('WHERE user_id = $1');
    expect(query.mock.calls[0][1]).toEqual([actor.id, 'Today Follow-ups', JSON.stringify({ followup: 'today' }), 30]);
  });

  test('never updates or deletes another user view', async () => {
    const viewId = '22222222-2222-4222-8222-222222222222';
    query.mockResolvedValueOnce({ rows: [] });
    await expect(service.updateView(actor, viewId, { name: 'Renamed' })).rejects.toMatchObject({ code: 'SAVED_VIEW_NOT_FOUND' });
    expect(query.mock.calls[0][0]).toContain('id = $1 AND user_id = $2');

    query.mockResolvedValueOnce({ rows: [] });
    await expect(service.deleteView(actor, viewId)).rejects.toMatchObject({ code: 'SAVED_VIEW_NOT_FOUND' });
    expect(query.mock.calls[1][0]).toContain('id = $1 AND user_id = $2');
  });
});
