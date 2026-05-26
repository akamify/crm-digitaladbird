const { verifyAccessToken } = require('../utils/jwt');
const { query } = require('../config/database');
const { AppError } = require('../utils/errors');

// In-memory user cache — avoids a DB query on every single API request.
// Entries expire after 60s so role/status changes propagate quickly.
const USER_CACHE = new Map();
const CACHE_TTL = 60_000;

function getCachedUser(id) {
  const entry = USER_CACHE.get(id);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.user;
  if (entry) USER_CACHE.delete(id);
  return null;
}

function setCachedUser(id, user) {
  USER_CACHE.set(id, { user, ts: Date.now() });
  if (USER_CACHE.size > 500) {
    const oldest = USER_CACHE.keys().next().value;
    USER_CACHE.delete(oldest);
  }
}

function invalidateUser(id) { USER_CACHE.delete(id); }

async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError(401, 'NO_TOKEN', 'Authentication required');

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (e) {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired token');
    }

    let user = getCachedUser(payload.sub);
    if (!user) {
      const { rows } = await query(
        `SELECT id, role, member_type, full_name, email, phone, report_to_id, status
           FROM users
          WHERE id = $1 AND deleted_at IS NULL`,
        [payload.sub]
      );
      if (!rows[0]) throw new AppError(401, 'USER_NOT_FOUND', 'User no longer exists');
      user = rows[0];
      setCachedUser(payload.sub, user);
    }

    if (user.status !== 'active') throw new AppError(403, 'USER_INACTIVE', 'Account is not active');

    req.user = user;
    next();
  } catch (e) { next(e); }
}

module.exports = { authenticate, invalidateUser };
