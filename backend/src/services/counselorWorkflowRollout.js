const { AppError } = require('../utils/errors');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stable release boundary: restarts must not move the New-assignment cutoff.
const DEFAULT_ACTIVATION = '2026-09-26T18:30:00.000Z'; // 27 September, midnight IST.
// Counselor functionality is active in the original UI; environment flags do not gate it.
// Explicit service options are retained only for isolated tests.
function configuration(options = {}) {
  const mode = options.rolloutMode ?? 'all';
  const invalid = () => { throw new AppError(503,'WORKFLOW_CONFIG_INVALID','Invalid counselor workflow rollout configuration.'); };
  const timestamp = value => {
    if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) invalid();
    return new Date(value).toISOString();
  };
  if (mode === 'off') return {mode,cutoff:null,pilots:{}};
  if (!['pilot','all'].includes(mode)) invalid();
  const value = options.rolloutAt === undefined ? DEFAULT_ACTIVATION : options.rolloutAt;
  if (!value) return {mode,cutoff:null,pilots:{}};
  const cutoff = timestamp(value);
  let pilots;
  pilots = options.pilotStarts ?? {};
  if (!pilots || Array.isArray(pilots) || typeof pilots !== 'object') invalid();
  pilots = Object.fromEntries(Object.entries(pilots).map(([id,start]) => {
    if (!UUID.test(id)) invalid();
    return [id.toLowerCase(),timestamp(start)];
  }));
  return {mode,cutoff:Date.parse(cutoff)<=Date.now()?cutoff:null,pilots};
}

function cutoffFor(config,user) {
  if (!config.cutoff || !['member','partner'].includes(user?.role)) return null;
  const pilot = config.pilots[user.id?.toLowerCase()];
  if (config.mode === 'pilot' && !pilot) return null;
  // Existing pilot activation dates survive expansion to all. New counselors
  // use the all-mode cutoff, avoiding retroactive New enrollment on expansion.
  const start = pilot || config.cutoff;
  return Date.parse(start)<=Date.now()?start:null;
}

module.exports = {configuration,cutoffFor,DEFAULT_ACTIVATION};
