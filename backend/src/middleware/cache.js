/**
 * Lightweight in-memory response cache for expensive read endpoints.
 * Caches by URL + user role (so admin/rm/member get separate caches).
 * NOT used for mutations or user-specific data — only aggregate stats.
 */
const cache = new Map();

function responseCache(ttlMs = 10_000) {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();

    const role = req.user?.role || 'anon';
    const key = `${role}:${req.originalUrl}`;
    const entry = cache.get(key);

    if (entry && Date.now() - entry.ts < ttlMs) {
      res.set('X-Cache', 'HIT');
      return res.json(entry.body);
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cache.set(key, { body, ts: Date.now() });
        if (cache.size > 200) {
          const oldest = cache.keys().next().value;
          cache.delete(oldest);
        }
      }
      res.set('X-Cache', 'MISS');
      return originalJson(body);
    };
    next();
  };
}

function invalidateCache(pattern) {
  for (const key of cache.keys()) {
    if (key.includes(pattern)) cache.delete(key);
  }
}

function clearAllCache() { cache.clear(); }

module.exports = { responseCache, invalidateCache, clearAllCache };
