const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    const body = {
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    };
    if (
      err.code === 'INVALID_LEAD_ASSIGNEE_ROLE'
      || err.code === 'LEAD_COMMUNICATION_FORBIDDEN'
      || err.code === 'DIRECT_CHAT_DISABLED_FOR_ROLE'
      || err.code === 'CP_ID_ALREADY_EXISTS'
      || err.code === 'CP_ID_NOT_EDITABLE'
      || err.code === 'EMAIL_ALREADY_EXISTS'
      || err.code === 'PHONE_ALREADY_EXISTS'
      || err.code === 'PARTNER_ROLE_DEPRECATED'
      || err.code === 'TEAM_NAME_REQUIRED'
      || err.code === 'REPORTING_RM_REQUIRED'
      || err.code === 'INVALID_REPORTING_RM'
      || err.code === 'USER_BLOCKED'
      || err.code === 'USER_DELETED'
      || err.code === 'RESET_TOKEN_INVALID'
      || err.code === 'EMAIL_PROVIDER_NOT_CONFIGURED'
      || err.code === 'PASSWORD_WEAK'
      || err.code === 'PASSWORD_MISMATCH'
      || err.code === 'RESET_RATE_LIMITED'
      || err.code === 'META_PAGE_TOKEN_MISSING'
      || err.code === 'META_PAGE_TOKEN_INVALID'
      || err.code === 'META_USER_TOKEN_PERMISSIONS_MISSING'
    ) {
      body.code = err.code;
      body.message = err.message;
    }
    return res.status(err.status).json(body);
  }

  // Postgres unique-violation
  if (err.code === '23505') {
    if (String(err.constraint || '').includes('cp_id') || String(err.detail || '').toLowerCase().includes('cp_id')) {
      return res.status(409).json({
        success: false,
        code: 'CP_ID_ALREADY_EXISTS',
        message: 'This CP ID is already assigned to another user.',
        error: { code: 'CP_ID_ALREADY_EXISTS', message: 'This CP ID is already assigned to another user.' },
      });
    }
    return res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: 'Duplicate value', details: err.detail },
    });
  }

  // Postgres foreign-key violation
  if (err.code === '23503') {
    return res.status(400).json({
      success: false,
      error: { code: 'FK_VIOLATION', message: 'Referenced record does not exist', details: err.detail },
    });
  }

  // Postgres schema drift: deployed code is using a column/table not present in DB.
  if (err.code === '42703' || err.code === '42P01') {
    logger.error({
      path: req.path,
      method: req.method,
      code: err.code,
      message: err.message,
      table: err.table || null,
      column: err.column || null,
      constraint: err.constraint || null,
      detail: err.detail || null,
      stack: err.stack,
    }, 'Database schema mismatch');
    return res.status(500).json({
      success: false,
      error: {
        code: 'DB_SCHEMA_MISSING',
        message: 'Database schema is not ready for this action. Run latest migrations and retry.',
      },
    });
  }

  // Postgres invalid enum/input syntax, usually a missing enum migration or bad status value.
  if (err.code === '22P02') {
    logger.error({
      path: req.path,
      method: req.method,
      code: err.code,
      message: err.message,
      detail: err.detail || null,
      stack: err.stack,
    }, 'Database rejected an unsupported enum/input value');
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_DB_VALUE',
        message: 'One submitted value is not supported by the current database schema.',
      },
    });
  }

  // Postgres statement timeout
  if (err.code === '57014') {
    logger.warn({ path: req.path, method: req.method }, 'Query timeout');
    return res.status(504).json({
      success: false,
      error: { code: 'TIMEOUT', message: 'Query took too long. Try narrowing your filters.' },
    });
  }

  // Connection errors
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    logger.error({ err: err.message, path: req.path }, 'Database connection error');
    return res.status(503).json({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Database temporarily unavailable. Please retry.' },
    });
  }

  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL', message: 'Internal server error' },
  });
}

module.exports = errorHandler;
