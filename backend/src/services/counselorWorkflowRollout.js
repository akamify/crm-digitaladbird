const { AppError } = require('../utils/errors');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Read on demand so tests and controlled restarts can exercise disable/resume.
// Configuration errors fail closed; no environment value is logged.
function configuration(options = {}) {
  const mode = options.rolloutMode ?? process.env.COUNSELOR_WORKFLOW_MODE ?? 'off';
  const invalid = () => { throw new AppError(503,'WORKFLOW_CONFIG_INVALID','Invalid counselor workflow rollout configuration.'); };
  const timestamp = value => {
    if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) invalid();
    return new Date(value).toISOString();
  };
  if (mode === 'off') return {mode,cutoff:null,pilots:{}};
  if (!['pilot','all'].includes(mode)) invalid();
  const value = options.rolloutAt === undefined ? process.env.COUNSELOR_WORKFLOW_ROLLOUT_AT : options.rolloutAt;
  if (!value) return {mode,cutoff:null,pilots:{}};
  const cutoff = timestamp(value);
  let pilots;
  try { pilots = options.pilotStarts ?? JSON.parse(process.env.COUNSELOR_WORKFLOW_PILOTS || '{}'); } catch { invalid(); }
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

module.exports = {configuration,cutoffFor};
