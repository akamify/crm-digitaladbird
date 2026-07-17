const { query } = require('../config/database');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

const REQUIRED_COLUMNS = {
  client_create: [
    ['users', 'emp_code'],
    ['users', 'cp_id'],
    ['users', 'full_name'],
    ['users', 'email'],
    ['users', 'phone'],
    ['users', 'role'],
    ['users', 'status'],
    ['users', 'password_hash'],
    ['users', 'is_available'],
    ['users', 'lead_assignment_enabled'],
    ['users', 'lead_assignment_status'],
  ],
  manual_lead_create: [
    ['leads', 'full_name'],
    ['leads', 'phone'],
    ['leads', 'email'],
    ['leads', 'city'],
    ['leads', 'state'],
    ['leads', 'source'],
    ['leads', 'category'],
    ['leads', 'category_source'],
    ['leads', 'category_resolved_at'],
    ['leads', 'stage'],
    ['leads', 'call_status'],
    ['leads', 'next_followup_at'],
    ['leads', 'assigned_to_user_id'],
    ['leads', 'assigned_at'],
    ['leads', 'raw_payload'],
    ['leads', 'source_meta'],
    ['leads', 'manual_added_by_user_id'],
    ['leads', 'manual_added_at'],
    ['leads', 'created_by_user_id'],
    ['lead_assignments', 'lead_id'],
    ['lead_assignments', 'user_id'],
    ['lead_assignments', 'assigned_to_user_id'],
    ['lead_assignments', 'assigned_by'],
    ['lead_assignments', 'assigned_at'],
    ['lead_assignments', 'reason'],
    ['lead_remarks', 'lead_id'],
    ['lead_remarks', 'user_id'],
    ['lead_remarks', 'remark'],
    ['lead_remarks', 'call_status'],
    ['lead_remarks', 'stage'],
    ['lead_remarks', 'next_followup_at'],
    ['lead_remarks', 'source'],
    ['lead_remarks', 'is_completed_response'],
    ['lead_remarks', 'call_statuses'],
    ['lead_label_assignments', 'lead_id'],
    ['lead_label_assignments', 'label_id'],
    ['lead_label_assignments', 'assigned_by_user_id'],
  ],
};

const REQUIRED_ENUMS = {
  client_create: [['user_role', 'client']],
  manual_lead_create: [
    ['lead_source', 'manual'],
    ['lead_stage', 'new'],
    ['call_status', 'not_called'],
  ],
};

let cached;
let cachedAt = 0;
const CACHE_MS = 30_000;

function key(table, column) {
  return `${table}.${column}`;
}

async function loadReadiness() {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_MS) return cached;

  const allColumns = [...REQUIRED_COLUMNS.client_create, ...REQUIRED_COLUMNS.manual_lead_create];
  const tableNames = [...new Set(allColumns.map(([table]) => table))];
  const { rows: columnRows } = await query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ANY($1::text[])`,
    [tableNames],
  );
  const columns = new Set(columnRows.map(row => key(row.table_name, row.column_name)));

  const allEnums = [...REQUIRED_ENUMS.client_create, ...REQUIRED_ENUMS.manual_lead_create];
  const enumTypes = [...new Set(allEnums.map(([type]) => type))];
  const { rows: enumRows } = await query(
    `SELECT typ.typname AS enum_type, enum.enumlabel
       FROM pg_type typ
       JOIN pg_enum enum ON enum.enumtypid = typ.oid
      WHERE typ.typname = ANY($1::text[])`,
    [enumTypes],
  );
  const enums = new Set(enumRows.map(row => key(row.enum_type, row.enumlabel)));

  const { rows: nullableRows } = await query(
    `SELECT table_name, column_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (table_name, column_name) IN (('users', 'cp_id'))`,
  );
  const nullable = new Map(nullableRows.map(row => [key(row.table_name, row.column_name), row.is_nullable === 'YES']));

  const { rows: constraintRows } = await query(
    `SELECT conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE conrelid = 'leads'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%category%'`,
  );
  const leadCategoryAllowsUnknown = constraintRows.length === 0
    || constraintRows.some(row => String(row.definition || '').includes("'unknown'"));

  cached = {
    columns,
    enums,
    nullable,
    leadCategoryAllowsUnknown,
    checked_at: new Date().toISOString(),
  };
  cachedAt = now;
  return cached;
}

async function getCreateReadiness() {
  const state = await loadReadiness();
  const result = {};
  for (const [scope, required] of Object.entries(REQUIRED_COLUMNS)) {
    const missingColumns = required
      .filter(([table, column]) => !state.columns.has(key(table, column)))
      .map(([table, column]) => `${table}.${column}`);
    const missingEnums = (REQUIRED_ENUMS[scope] || [])
      .filter(([type, value]) => !state.enums.has(key(type, value)))
      .map(([type, value]) => `${type}.${value}`);
    const blockers = [];
    if (scope === 'client_create' && state.nullable.get(key('users', 'cp_id')) !== true) {
      blockers.push('users.cp_id must allow NULL for client users');
    }
    if (scope === 'manual_lead_create' && !state.leadCategoryAllowsUnknown) {
      blockers.push('leads.category check constraint must allow unknown');
    }
    result[scope] = {
      ready: missingColumns.length === 0 && missingEnums.length === 0 && blockers.length === 0,
      missing_columns: missingColumns,
      missing_enums: missingEnums,
      blockers,
    };
  }
  return { checked_at: state.checked_at, ...result };
}

async function assertCreateReady(scope) {
  const readiness = await getCreateReadiness();
  const state = readiness[scope];
  if (state?.ready) return readiness;

  logger.error({
    scope,
    missing_columns: state?.missing_columns || [],
    missing_enums: state?.missing_enums || [],
    blockers: state?.blockers || [],
  }, 'Create endpoint schema readiness failed');

  throw new AppError(
    500,
    scope === 'client_create' ? 'CLIENT_SCHEMA_MIGRATION_REQUIRED' : 'MANUAL_LEAD_SCHEMA_MIGRATION_REQUIRED',
    scope === 'client_create'
      ? 'Client creation database schema is not ready. Run latest migrations and retry.'
      : 'Manual lead database schema is not ready. Run latest migrations and retry.',
    state,
  );
}

module.exports = {
  getCreateReadiness,
  assertCreateReady,
};
