const { AppError } = require('../utils/errors');
const userIdentityRepository = require('../repositories/userIdentityRepository');
const crypto = require('crypto');

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

async function generateUniqueCpId() {
  for (let attempt = 0; attempt < 25; attempt++) {
    const n = crypto.randomInt(0, 100000000);
    const cpId = `MSA${String(n).padStart(8, '0')}`;
    const existing = await userIdentityRepository.findByCpId(cpId);
    if (!existing) return cpId;
  }
  throw new AppError(500, 'CP_ID_GENERATION_FAILED', 'Could not generate a unique CP ID. Please retry.');
}

function assertCpIdNotEditable(body) {
  if (Object.prototype.hasOwnProperty.call(body || {}, 'cp_id') || Object.prototype.hasOwnProperty.call(body || {}, 'cpId')) {
    throw new AppError(400, 'CP_ID_NOT_EDITABLE', 'CP ID is system generated and cannot be edited.');
  }
}

function normalizeRole(role) {
  return role === 'partner' ? 'member' : role;
}

module.exports = { normalizeCpId, validateUniqueCpId, generateUniqueCpId, assertCpIdNotEditable, normalizeRole };
