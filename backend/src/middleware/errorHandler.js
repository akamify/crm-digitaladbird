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
    ) {
      body.code = err.code;
      body.message = err.message;
    }
    return res.status(err.status).json(body);
  }

  // Postgres unique-violation
  if (err.code === '23505') {
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
