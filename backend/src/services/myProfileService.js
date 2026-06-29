const { query } = require('../config/database');
const { AppError } = require('../utils/errors');

function normalizeRole(role) {
  return role === 'partner' ? 'member' : role;
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[\s()-]/g, '');
  if (/^\d{10}$/.test(cleaned)) return `+91${cleaned}`;
  if (/^\+\d{10,15}$/.test(cleaned)) return cleaned;
  if (/^\d{11,15}$/.test(cleaned)) return `+${cleaned}`;
  return null;
}

function mapProfile(row) {
  return {
    id: row.id,
    full_name: row.full_name,
    name: row.full_name,
    email: row.email,
    phone: row.phone,
    cp_id: row.cp_id,
    role: normalizeRole(row.role),
    member_type: row.member_type,
    status: row.status,
    account_status: row.status === 'active' && !row.deleted_at ? 'active' : row.status || 'inactive',
    is_available: row.is_available,
    availability_status: row.is_available && row.lead_assignment_status !== 'unavailable' ? 'available' : 'unavailable',
    lead_assignment_enabled: row.lead_assignment_enabled,
    lead_assignment_status: row.lead_assignment_status,
    report_to_id: row.report_to_id,
    team_name: row.team_name,
    reporting_manager: row.rm_id ? {
      id: row.rm_id,
      name: row.rm_name,
      email: row.rm_email,
      phone: row.rm_phone,
    } : null,
    avatar_url: row.avatar_url || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
  };
}

async function getProfileRow(userId) {
  const { rows: [row] } = await query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.cp_id, u.role, u.member_type,
            u.status::text AS status, u.is_available, u.lead_assignment_enabled,
            u.lead_assignment_status, u.report_to_id, u.team_name, u.created_at,
            u.updated_at, u.last_login_at, u.deleted_at, NULL::text AS avatar_url,
            rm.id AS rm_id, rm.full_name AS rm_name, rm.email AS rm_email, rm.phone AS rm_phone
       FROM users u
       LEFT JOIN users rm ON rm.id = u.report_to_id
      WHERE u.id = $1
        AND u.deleted_at IS NULL
        AND COALESCE(u.is_hidden, FALSE) = FALSE`,
    [userId],
  );
  if (!row) throw new AppError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
  return row;
}

async function memberStats(userId) {
  const { rows: [leadStats] } = await query(
    `SELECT
        COUNT(*)::int AS total_assigned_leads,
        COUNT(*) FILTER (WHERE assigned_at::date = CURRENT_DATE)::int AS today_assigned_leads,
        COUNT(*) FILTER (WHERE COALESCE(call_status, 'not_called') <> 'not_called')::int AS contacted_leads,
        COUNT(*) FILTER (WHERE COALESCE(call_status, 'not_called') = 'not_called')::int AS pending_not_called_leads,
        COUNT(*) FILTER (WHERE call_status = 'converted' OR stage = 'won' OR stage = 'converted')::int AS converted_leads,
        COUNT(*) FILTER (WHERE next_followup_at::date = CURRENT_DATE)::int AS followups_today,
        COUNT(*) FILTER (WHERE next_followup_at IS NOT NULL AND next_followup_at <= NOW())::int AS followups_due
       FROM leads
      WHERE assigned_to_user_id = $1
        AND deleted_at IS NULL`,
    [userId],
  );
  const { rows: [support] } = await query(
    `SELECT COUNT(*)::int AS open_support_tickets
       FROM support_tickets
      WHERE created_by_user_id = $1
        AND status = 'open'`,
    [userId],
  ).catch(() => ({ rows: [{ open_support_tickets: 0 }] }));
  return { ...leadStats, ...support };
}

async function rmStats(userId) {
  const { rows: [stats] } = await query(
    `WITH team AS (
       SELECT id, status, is_available, lead_assignment_status
         FROM users
        WHERE report_to_id = $1
          AND deleted_at IS NULL
          AND role IN ('member', 'partner')
     )
     SELECT
       (SELECT COUNT(*)::int FROM team) AS total_team_members,
       (SELECT COUNT(*)::int FROM team WHERE status = 'active' AND COALESCE(is_available, TRUE) = TRUE AND COALESCE(lead_assignment_status, 'available') = 'available') AS available_team_members,
       COUNT(l.id)::int AS total_team_assigned_leads,
       COUNT(l.id) FILTER (WHERE l.assigned_at::date = CURRENT_DATE)::int AS today_team_assigned_leads,
       COUNT(l.id) FILTER (WHERE l.call_status = 'converted' OR l.stage = 'won' OR l.stage = 'converted')::int AS team_converted_leads,
       (SELECT COUNT(*)::int FROM lead_requests lr JOIN team t ON t.id = lr.user_id WHERE lr.status = 'pending') AS pending_lead_requests
      FROM leads l
      JOIN team t ON t.id = l.assigned_to_user_id
     WHERE l.deleted_at IS NULL`,
    [userId],
  );
  const { rows: [support] } = await query(
    `SELECT COUNT(*)::int AS open_support_tickets
       FROM support_tickets
      WHERE created_by_user_id = $1
        AND status = 'open'`,
    [userId],
  ).catch(() => ({ rows: [{ open_support_tickets: 0 }] }));
  return { ...stats, ...support };
}

async function getMyProfile(actor) {
  if (!actor?.id) throw new AppError(401, 'NO_USER', 'Not authenticated.');
  const row = await getProfileRow(actor.id);
  const role = normalizeRole(row.role);
  const stats = role === 'rm' ? await rmStats(actor.id) : await memberStats(actor.id);
  return { profile: mapProfile(row), stats };
}

async function updateMyProfile(actor, body = {}) {
  if (!actor?.id) throw new AppError(401, 'NO_USER', 'Not authenticated.');
  const sets = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(body, 'full_name') || Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = String(body.full_name || body.name || '').trim();
    if (name.length < 2) throw new AppError(400, 'INVALID_PROFILE_NAME', 'Name must be at least 2 characters.');
    if (name.length > 120) throw new AppError(400, 'INVALID_PROFILE_NAME', 'Name must be 120 characters or less.');
    params.push(name);
    sets.push(`full_name = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
    const phone = normalizePhone(body.phone);
    if (!phone) throw new AppError(400, 'INVALID_PROFILE_PHONE', 'Enter a valid phone number.');
    params.push(phone);
    sets.push(`phone = $${params.length}`);
  }

  if (sets.length) {
    params.push(actor.id);
    await query(
      `UPDATE users
          SET ${sets.join(', ')},
              updated_at = NOW()
        WHERE id = $${params.length}
          AND deleted_at IS NULL`,
      params,
    );
  }

  return getMyProfile(actor);
}

module.exports = {
  getMyProfile,
  updateMyProfile,
};
