/**
 * AppError - thrown anywhere; caught by errorHandler middleware -> JSON response.
 * asyncHandler(fn) - wraps async route handlers so thrown errors hit Express's next().
 */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status  = status;
    this.code    = code;
    this.details = details;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { AppError, asyncHandler };
