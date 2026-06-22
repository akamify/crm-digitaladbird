const { verifyAccessToken } = require('../utils/jwt');
const { query } = require('../config/database');
const { AppError } = require('../utils/errors');

// In-memory user cache — avoids a DB query on every single API request.
// Entries expire after 60s so role/status changes propagate quickly.
const USER_CACHE = new Map();
const CACHE_TTL = 60_000;

function normalizeRole(role) {
  return role === 'partner' ? 'member' : role;
}

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
    if (!payload.sid) {
      throw new AppError(401, 'SESSION_REQUIRED', 'Session has expired. Please login again.');
    }

    const { rows: [session] } = await query(
      `SELECT id, user_id, expires_at, revoked_at
         FROM auth_sessions
        WHERE id = $1 AND user_id = $2
        LIMIT 1`,
      [payload.sid, payload.sub],
    );
    if (!session || session.revoked_at) {
      throw new AppError(401, 'SESSION_REVOKED', 'Session revoked');
    }
    if (new Date(session.expires_at) <= new Date()) {
      throw new AppError(401, 'SESSION_EXPIRED', 'Session expired. Please login again.');
    }

    let user = getCachedUser(payload.sub);
    if (!user) {
      const { rows } = await query(
        `SELECT id, role, member_type, full_name, email, phone, cp_id, report_to_id, status
           FROM users
          WHERE id = $1 AND deleted_at IS NULL`,
        [payload.sub]
      );
      if (!rows[0]) throw new AppError(401, 'USER_NOT_FOUND', 'User no longer exists');
      user = rows[0];
      user.role = normalizeRole(user.role);
      setCachedUser(payload.sub, user);
    }

    if (user.status !== 'active') throw new AppError(403, 'USER_INACTIVE', 'Account is not active');

    req.user = user;
    req.sessionId = session.id;
    req.sessionExpiresAt = session.expires_at;

    // Bump last_activity_at on the user's most recent active session so
    // Activity Logs can show "Last Activity Time" without a per-route hook.
    // Throttled via an in-memory map to avoid hammering the DB on every
    // React Query poll: we only write once per user per ACTIVITY_BUMP_MS.
    // Fire-and-forget — never blocks the request and never throws back.
    bumpSessionActivity(user.id, session.id, req.ip).catch(() => {});

    next();
  } catch (e) { next(e); }
}

const ACTIVITY_BUMP_MS = 30_000;   // write at most once per 30s per user
const LAST_BUMPED = new Map();

async function bumpSessionActivity(userId, sessionId, ip) {
  const now = Date.now();
  const cacheKey = sessionId || userId;
  const last = LAST_BUMPED.get(cacheKey) || 0;
  if (now - last < ACTIVITY_BUMP_MS) return;
  LAST_BUMPED.set(cacheKey, now);
  // Cap the map size so it can't grow unbounded.
  if (LAST_BUMPED.size > 1000) {
    const oldest = LAST_BUMPED.keys().next().value;
    LAST_BUMPED.delete(oldest);
  }
  try {
    await query(
      `UPDATE auth_sessions
          SET last_activity_at = NOW(),
              last_activity_ip = $2
        WHERE user_id = $1
          AND id = $3
          AND revoked_at IS NULL
          AND expires_at > NOW()`,
      [userId, ip || null, sessionId]
    );
  } catch { /* never block request on activity bump */ }
}

module.exports = { authenticate, invalidateUser };
