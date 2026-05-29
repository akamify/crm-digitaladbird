/**
 * Symmetric encryption for credential blobs stored in the database.
 *
 * Uses AES-256-GCM. The key is derived from JWT_ACCESS_SECRET via PBKDF2 so
 * we don't introduce a new env var; rotating JWT_ACCESS_SECRET would invalidate
 * the encrypted blobs, which is the correct security boundary anyway.
 *
 * Output format (base64): `{iv}.{tag}.{ciphertext}` — three URL-safe base64
 * fields joined by '.', so the whole thing is a single TEXT column.
 */
const crypto = require('crypto');
const config = require('../config/env');

const ALGO = 'aes-256-gcm';
const SALT = Buffer.from('digitaladbird-crm/integration-secrets/v1');
const KEY_LEN = 32;
const IV_LEN = 12;       // 96-bit IV recommended for GCM
const TAG_LEN = 16;

let _cachedKey = null;

function key() {
  if (_cachedKey) return _cachedKey;
  const seed = config.jwt?.accessSecret || process.env.JWT_ACCESS_SECRET;
  if (!seed) throw new Error('JWT_ACCESS_SECRET is required to derive the integration-secrets encryption key');
  _cachedKey = crypto.pbkdf2Sync(seed, SALT, 200_000, KEY_LEN, 'sha256');
  return _cachedKey;
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  s = (s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

/** Encrypt any JSON-serialisable value. Returns null for null/undefined. */
function encrypt(plain) {
  if (plain === null || plain === undefined) return null;
  const json = Buffer.from(JSON.stringify(plain), 'utf8');
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(json), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${b64url(iv)}.${b64url(tag)}.${b64url(ct)}`;
}

/** Decrypt and JSON.parse. Throws if tampered / wrong key. */
function decrypt(blob) {
  if (!blob) return null;
  const parts = String(blob).split('.');
  if (parts.length !== 3) throw new Error('Malformed encrypted blob');
  const [iv, tag, ct] = parts.map(fromB64url);
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) throw new Error('Bad IV/tag length');
  const decipher = crypto.createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

/** Returns true if the supplied object looks like a Google service-account JSON. */
function isGoogleServiceAccount(obj) {
  return obj
    && typeof obj === 'object'
    && obj.type === 'service_account'
    && typeof obj.client_email === 'string'
    && /^.+@.+\.iam\.gserviceaccount\.com$/.test(obj.client_email)
    && typeof obj.private_key === 'string'
    && obj.private_key.includes('PRIVATE KEY');
}

module.exports = { encrypt, decrypt, isGoogleServiceAccount };
