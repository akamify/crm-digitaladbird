const { query } = require('../config/database');
const { asyncHandler } = require('../utils/errors');
const { getVisibleUserIds } = require('../middleware/rbac');

function buildScope(visible, offset = 0) {
  if (visible === null) return { sql: '', params: [] };
  return { sql: ` AND l.assigned_to_user_id = ANY($${offset + 1}::uuid[])`, params: [visible] };
}

/** GET /api/reports/summary -> headline KPIs for the dashboard. */
exports.summary = asyncHandler(async (req, res) => {
  const visible = await getVisibleUserIds(req.user);
  const scope   = buildScope(visible);
  const from    = req.query.from || null;
  const to      = req.query.to   || null;

  const params = [...scope.params];
  let dateClause = '';
  if (from) { params.push(from); dateClause += ` AND l.created_at >= $${params.length}`; }
  if (to)   { params.push(to);   dateClause += ` AND l.created_at <= $${params.length}`; }

  // "Today" is calendar-day-in-IST regardless of the DB session timezone —
  // see /admin/leads/fresh for rationale.
  // Use Meta-side created_time when present (so backfilled historic leads
  // don't pollute today_leads), DB created_at as fallback for manual/import.
  const TODAY_IST_CREATED  = `(COALESCE(l.meta_created_time, l.created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date`;
  const TODAY_IST_ASSIGNED = `(l.assigned_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date`;

  const { rows: [k] } = await query(
    `SELECT
        COUNT(*)                                                              AS total_leads,
        COUNT(*) FILTER (WHERE l.is_pending)                                  AS pending,
        COUNT(*) FILTER (WHERE l.call_status = 'converted')                   AS converted,
        COUNT(*) FILTER (WHERE l.call_status = 'follow_up' OR l.next_followup_at IS NOT NULL) AS followups,
        COUNT(*) FILTER (WHERE l.stage = 'lost' OR l.call_status = 'not_interested') AS lost,
        COUNT(*) FILTER (WHERE ${TODAY_IST_CREATED})                          AS today_leads,
        COUNT(*) FILTER (WHERE ${TODAY_IST_ASSIGNED})                         AS today_assigned
       FROM leads l WHERE l.deleted_at IS NULL ${scope.sql}${dateClause}`,
    params
  );

  res.json({ success: true, data: k });
});

/** GET /api/reports/daily?days=14 -> { day, leads, conversions, pending }[] */
exports.daily = asyncHandler(async (req, res) => {
  const visible = await getVisibleUserIds(req.user);
  const days    = Math.min(90, Math.max(1, parseInt(req.query.days || '14', 10)));
  const scope   = buildScope(visible, 1); // $1 is already `days`

  const { rows } = await query(
    `WITH series AS (
       SELECT generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, INTERVAL '1 day')::date AS day
     )
     SELECT s.day,
            COUNT(l.id)                                                AS leads,
            COUNT(l.id) FILTER (WHERE l.call_status = 'converted')     AS conversions,
            COUNT(l.id) FILTER (WHERE l.is_pending)                    AS pending
       FROM series s
       LEFT JOIN leads l ON l.created_at::date = s.day AND l.deleted_at IS NULL ${scope.sql}
      GROUP BY s.day ORDER BY s.day`,
    [days, ...scope.params]
  );
  res.json({ success: true, data: rows });
});

/** GET /api/reports/by-user -> per-member breakdown (admin + rm scoped). */
exports.byUser = asyncHandler(async (req, res) => {
  const visible = await getVisibleUserIds(req.user);
  const scope   = buildScope(visible);
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.role, u.team_name,
            COUNT(l.id)                                                AS leads,
            COUNT(l.id) FILTER (WHERE l.is_pending)                    AS pending,
            COUNT(l.id) FILTER (WHERE l.call_status = 'converted')     AS conversions,
            COUNT(l.id) FILTER (WHERE l.call_status = 'rnr')           AS rnr,
            COUNT(l.id) FILTER (WHERE l.call_status = 'not_interested')AS not_interested,
            ROUND(100.0 * COUNT(l.id) FILTER (WHERE l.call_status = 'converted')
                  / NULLIF(COUNT(l.id), 0), 2)                          AS conv_rate
       FROM users u
       LEFT JOIN leads l
              ON l.assigned_to_user_id = u.id
             AND l.deleted_at IS NULL ${scope.sql}
      WHERE u.deleted_at IS NULL AND u.role IN ('member','rm')
      GROUP BY u.id ORDER BY conversions DESC NULLS LAST, leads DESC`,
    scope.params
  );
  res.json({ success: true, data: rows });
});

/** GET /api/reports/funnel */
exports.funnel = asyncHandler(async (req, res) => {
  const visible = await getVisibleUserIds(req.user);
  const scope   = buildScope(visible);
  const { rows } = await query(
    `SELECT stage, COUNT(*) AS count
       FROM leads l WHERE l.deleted_at IS NULL ${scope.sql}
      GROUP BY stage`,
    scope.params
  );
  res.json({ success: true, data: rows });
});

/** GET /api/reports/sources */
exports.sources = asyncHandler(async (req, res) => {
  const visible = await getVisibleUserIds(req.user);
  const scope   = buildScope(visible);
  const { rows } = await query(
    `SELECT source, COUNT(*) AS count,
            COUNT(*) FILTER (WHERE call_status = 'converted') AS conversions
       FROM leads l WHERE l.deleted_at IS NULL ${scope.sql}
      GROUP BY source ORDER BY count DESC`,
    scope.params
  );
  res.json({ success: true, data: rows });
});
