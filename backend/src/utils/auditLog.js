/**
 * Centralized audit-trail helper. Every meaningful action in the CRM
 * passes through here so the Activity Logs page becomes a complete
 * record of who did what, when, where, and what changed.
 *
 * Usage:
 *
 *   const { logActivity } = require('../utils/auditLog');
 *
 *   await logActivity(req, {
 *     entity: 'lead',
 *     entity_id: leadId,
 *     action: 'reassigned',
 *     old_value: prevAssignee,        // string or null
 *     new_value: newAssignee,         // string or null
 *     metadata: { reason: 'lead_request' },
 *   });
 *
 * Never throws back to the caller — audit failures are logged with the
 * pino logger and swallowed (the user-facing action must not break
 * because logging hiccupped).
 *
 * Pulls automatically from req:
 *   user_id, user_name, user_role   ← req.user
 *   ip_address                      ← req.ip
 *   user_agent                      ← req.headers['user-agent']
 *
 * If you have to log something without a request context (background
 * jobs, webhook ingest, scheduler), pass a synthetic shape:
 *
 *   await logActivity({ user: null, ip: null, headers: {} }, { ... });
 */

const { query } = require('../config/database');
const logger = require('../utils/logger');

function asString(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

async function logActivity(req, opts) {
  if (!opts || !opts.entity || !opts.action) {
    logger.warn({ opts }, '[audit] logActivity called without entity/action — skipping');
    return;
  }

  const u  = (req && req.user) || {};
  const ip = (req && (req.ip || req.headers?.['x-forwarded-for'])) || null;
  const ua = (req && req.headers && req.headers['user-agent']) || null;

  const params = [
    u.id || null,                       // user_id
    u.name || u.full_name || null,      // user_name (JWT carries `name`; auth controller sets full_name)
    u.role || null,                     // user_role
    opts.entity,                        // entity
    opts.entity_id || null,             // entity_id
    opts.action,                        // action
    opts.metadata ? JSON.stringify(opts.metadata) : null,  // metadata jsonb
    ip,                                 // ip_address
    asString(opts.old_value),           // old_value
    asString(opts.new_value),           // new_value
    ua,                                 // user_agent
    opts.session_id || null,            // session_id
  ];

  try {
    await query(
      `INSERT INTO activity_logs(
         user_id, user_name, user_role,
         entity, entity_id, action, metadata, ip_address,
         old_value, new_value, user_agent, session_id
       ) VALUES ($1,$2,$3, $4,$5,$6,$7,$8, $9,$10,$11,$12)`,
      params
    );
  } catch (err) {
    // Audit insert must never break the calling request.
    logger.warn({ err: err.message, entity: opts.entity, action: opts.action }, '[audit] insert failed');
  }
}

module.exports = { logActivity };
