const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config/env');

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.full_name },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessTtl, issuer: 'digitaladbird-crm' }
  );
}

function signRefreshToken(user) {
  // raw token returned to client; the *hash* is stored in DB so a DB leak doesn't give us live tokens
  const raw = crypto.randomBytes(48).toString('base64url');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return {
    raw,
    hash,
    expiresAt: new Date(Date.now() + config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000),
  };
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.accessSecret, { issuer: 'digitaladbird-crm' });
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, hashToken };
