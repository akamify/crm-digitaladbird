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

/**
 * Bust every cached response that contributes to a lead-count number
 * on any dashboard tile. Called from leadEventService.onLeadCreated()
 * the moment a lead lands in the DB, so the next API request that the
 * frontend makes (triggered by the lead:new socket event invalidating
 * React Query) hits a MISS and re-runs the SQL — instead of getting
 * the old cached body back for another 10-15 seconds.
 *
 * The patterns cover all known lead-counter endpoints. Adding a new
 * lead-counter endpoint? Make sure its URL substring is matched here.
 */
const LEAD_COUNT_CACHE_PATTERNS = [
  'reports/summary',
  'reports/daily',
  'reports/by-user',
  'reports/funnel',
  'reports/sources',
  'admin/live-stats',
  'admin/leads/fresh',
  'admin/lead-sources',
  'admin/meta/overview',
  'admin/meta/pages-enriched',
  'admin/meta/forms-enriched',
  'admin/meta/campaigns-enriched',
  'admin/analytics/overview',
  'admin/analytics/conversions',
  'admin/sheets/stats',
  'distribution/stats',
  'integrations/status',
];

function bustLeadCountersCache() {
  let dropped = 0;
  for (const key of [...cache.keys()]) {
    for (const pat of LEAD_COUNT_CACHE_PATTERNS) {
      if (key.includes(pat)) {
        cache.delete(key);
        dropped++;
        break;
      }
    }
  }
  return dropped;
}

module.exports = { responseCache, invalidateCache, clearAllCache, bustLeadCountersCache };
