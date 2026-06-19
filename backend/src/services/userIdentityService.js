const { AppError } = require('../utils/errors');
const userIdentityRepository = require('../repositories/userIdentityRepository');

function normalizeCpId(value) {
  return String(value || '').trim().toUpperCase();
}

async function validateUniqueCpId(value, excludeUserId = null) {
  const cpId = normalizeCpId(value);
  if (!cpId) throw new AppError(400, 'CP_ID_REQUIRED', 'CP ID is required.');
  if (cpId.length > 40) throw new AppError(400, 'CP_ID_INVALID', 'CP ID must be 40 characters or fewer.');
  const existing = await userIdentityRepository.findByCpId(cpId, excludeUserId);
  if (existing) {
    throw new AppError(409, 'CP_ID_ALREADY_EXISTS', 'This CP ID is already assigned to another user.');
  }
  return cpId;
}

module.exports = { normalizeCpId, validateUniqueCpId };
