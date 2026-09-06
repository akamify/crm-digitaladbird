const { query } = require('../config/database');
const { AppError } = require('../utils/errors');
const {
  callStatuses,
  leadRemarkNoteTypes,
  leadRemarkCategories,
  leadRemarkPriorities,
  leadRemarkCustomerInterests,
} = require('../constants/leadStatusOptions');

const MAX_VIEWS_PER_USER = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ENUM_FILTERS = {
  category: new Set(['partner', 'trader', 'unknown']),
  stage: new Set(['new', 'contacted', 'qualified', 'follow_up', 'won', 'lost']),
  followup: new Set(['today', 'overdue', 'upcoming', 'no_followup']),
  followup_strict: new Set(['true']),
  reassignment: new Set(['to_me', 'to_others']),
  assignment: new Set(['assigned', 'unassigned']),
  assigned_today: new Set(['true']),
  pending: new Set(['true', 'false']),
  unworked: new Set(['true', 'false']),
  no_remark: new Set(['true']),
  created_preset: new Set(['today', 'yesterday', 'day_before']),
  workflow_status: new Set(['step_1_pending', 'step_1_completed', 'step_2_unlocked', 'completed_response']),
  latest_activity: new Set(['today', 'yesterday', 'last_7_days', 'last_30_days']),
  has_rm_update: new Set(['true', 'false']),
  session_attendance: new Set(['has_session', 'no_session']),
  lead_view: new Set(['all_time', 'daily']),
  daily_metric: new Set(['received', 'worked', 'pending', 'personal_meeting', 'session_9pm', 'call_issues']),
  all_time_metric: new Set(['all', 'worked', 'pending', 'personal_meeting', 'session_9pm', 'call_issues']),
  call_issues: new Set(['true']),
  call_status: new Set(callStatuses),
  remark_status: new Set(callStatuses),
  note_type: new Set(leadRemarkNoteTypes),
  note_category: new Set(leadRemarkCategories),
  priority: new Set(leadRemarkPriorities),
  customer_interest: new Set(leadRemarkCustomerInterests),
};

const TEXT_FILTER_LIMITS = {
  source: 120,
  campaign: 240,
  label_id: 36,
  updated_by_rm: 120,
};

const DATE_FILTERS = new Set(['from', 'to', 'selected_date']);

function normalizeName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 80) {
    throw new AppError(400, 'INVALID_SAVED_VIEW_NAME', 'View name must be between 1 and 80 characters.');
  }
  return name;
}

function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function normalizeFilters(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'INVALID_SAVED_VIEW_FILTERS', 'Saved view filters must be an object.');
  }

  const normalized = {};
  for (const [key, rawValue] of Object.entries(input)) {
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    if (typeof rawValue !== 'string' && typeof rawValue !== 'number' && typeof rawValue !== 'boolean') {
      throw new AppError(400, 'INVALID_SAVED_VIEW_FILTERS', `Unsupported value for filter: ${key}.`);
    }
    const value = String(rawValue).trim();

    if (ENUM_FILTERS[key]) {
      if (!ENUM_FILTERS[key].has(value)) {
        throw new AppError(400, 'INVALID_SAVED_VIEW_FILTER', `Unsupported value for filter: ${key}.`);
      }
      normalized[key] = value;
      continue;
    }

    if (DATE_FILTERS.has(key)) {
      if (!isValidDate(value)) {
        throw new AppError(400, 'INVALID_SAVED_VIEW_FILTER', `Invalid date for filter: ${key}.`);
      }
      normalized[key] = value;
      continue;
    }

    const maxLength = TEXT_FILTER_LIMITS[key];
    if (maxLength) {
      if (value.length > maxLength || (key === 'label_id' && !UUID_RE.test(value))) {
        throw new AppError(400, 'INVALID_SAVED_VIEW_FILTER', `Invalid value for filter: ${key}.`);
      }
      normalized[key] = value;
    }
  }

  if (JSON.stringify(normalized).length > 10000) {
    throw new AppError(400, 'SAVED_VIEW_TOO_LARGE', 'Saved view contains too many filter values.');
  }
  return normalized;
}

function validateViewId(viewId) {
  const id = String(viewId || '').trim();
  if (!UUID_RE.test(id)) throw new AppError(400, 'INVALID_SAVED_VIEW_ID', 'Invalid saved view identifier.');
  return id;
}

function mapRow(row) {
  return { ...row, filters: row.filters || {} };
}

async function listViews(actor) {
  const { rows } = await query(`
    SELECT id, name, filters, created_at, updated_at
      FROM lead_saved_views
     WHERE user_id = $1
     ORDER BY updated_at DESC, LOWER(name), id
  `, [actor.id]);
  return rows.map(mapRow);
}

async function createView(actor, input = {}) {
  const name = normalizeName(input.name);
  const filters = normalizeFilters(input.filters || {});
  try {
    const { rows: [view] } = await query(`
      INSERT INTO lead_saved_views(user_id, name, filters)
      SELECT $1, $2, $3::jsonb
       WHERE (SELECT COUNT(*) FROM lead_saved_views WHERE user_id = $1) < $4
      RETURNING id, name, filters, created_at, updated_at
    `, [actor.id, name, JSON.stringify(filters), MAX_VIEWS_PER_USER]);
    if (!view) throw new AppError(409, 'SAVED_VIEW_LIMIT_REACHED', `You can save up to ${MAX_VIEWS_PER_USER} lead views.`);
    return mapRow(view);
  } catch (error) {
    if (error?.code === '23505') throw new AppError(409, 'SAVED_VIEW_NAME_EXISTS', 'A saved view with this name already exists.');
    throw error;
  }
}

async function updateView(actor, viewId, input = {}) {
  const id = validateViewId(viewId);
  const hasName = Object.prototype.hasOwnProperty.call(input, 'name');
  const hasFilters = Object.prototype.hasOwnProperty.call(input, 'filters');
  if (!hasName && !hasFilters) throw new AppError(400, 'SAVED_VIEW_UPDATE_REQUIRED', 'Provide a name or filters to update.');

  const name = hasName ? normalizeName(input.name) : null;
  const filters = hasFilters ? normalizeFilters(input.filters) : null;
  try {
    const { rows: [view] } = await query(`
      UPDATE lead_saved_views
         SET name = CASE WHEN $3::boolean THEN $4 ELSE name END,
             filters = CASE WHEN $5::boolean THEN $6::jsonb ELSE filters END,
             updated_at = NOW()
       WHERE id = $1 AND user_id = $2
      RETURNING id, name, filters, created_at, updated_at
    `, [id, actor.id, hasName, name, hasFilters, JSON.stringify(filters || {})]);
    if (!view) throw new AppError(404, 'SAVED_VIEW_NOT_FOUND', 'Saved view not found.');
    return mapRow(view);
  } catch (error) {
    if (error?.code === '23505') throw new AppError(409, 'SAVED_VIEW_NAME_EXISTS', 'A saved view with this name already exists.');
    throw error;
  }
}

async function deleteView(actor, viewId) {
  const id = validateViewId(viewId);
  const { rows: [view] } = await query(`
    DELETE FROM lead_saved_views
     WHERE id = $1 AND user_id = $2
    RETURNING id, name
  `, [id, actor.id]);
  if (!view) throw new AppError(404, 'SAVED_VIEW_NOT_FOUND', 'Saved view not found.');
  return view;
}

module.exports = {
  MAX_VIEWS_PER_USER,
  normalizeName,
  normalizeFilters,
  listViews,
  createView,
  updateView,
  deleteView,
};
