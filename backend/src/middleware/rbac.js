const { AppError } = require('../utils/errors');
const { query } = require('../config/database');

/**
 * Role hierarchy: super_admin > rm > member
 *
 * requireRole('super_admin')          -> only super_admin
 * requireRole('super_admin', 'rm')    -> super_admin OR rm
 */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user)                    return next(new AppError(401, 'NO_USER',   'Not authenticated'));
    if (!roles.includes(req.user.role))
                                      return next(new AppError(403, 'FORBIDDEN', 'Insufficient permissions'));
    next();
  };
}

/**
 * requireMemberType('fresher') or requireMemberType('veteran')
 * Only meaningful when the user's role is 'member'.
 */
function requireMemberType(...types) {
  return (req, _res, next) => {
    if (!req.user)                          return next(new AppError(401, 'NO_USER', 'Not authenticated'));
    if (req.user.role !== 'member')         return next(); // non-members pass through
    if (!types.includes(req.user.member_type))
      return next(new AppError(403, 'FORBIDDEN', `Requires member type: ${types.join(' or ')}`));
    next();
  };
}

/**
 * Returns an array of user IDs the current user is allowed to see leads for.
 *   super_admin → null  (no filter — sees everything)
 *   rm          → self + direct reports
 *   client      → client-owned Meta/leads are scoped separately
 *   member/partner → only self
 */
async function getVisibleUserIds(user) {
  if (user.role === 'super_admin' || user.role === 'admin') return null;
  if (user.role === 'client') return [];
  if (user.role === 'rm') {
    const { rows } = await query(
      `SELECT id FROM users
        WHERE deleted_at IS NULL
          AND (id = $1 OR report_to_id = $1)`,
      [user.id]
    );
    return rows.map(r => r.id);
  }
  return [user.id]; // member or partner
}

module.exports = { requireRole, requireMemberType, getVisibleUserIds };
