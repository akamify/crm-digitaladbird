const config = require('../config/env');
const { AppError, asyncHandler } = require('../utils/errors');
const passwordResetService = require('../services/auth/passwordResetService');
const emailService = require('../services/email/emailService');

function requestContext(req) {
  return { ipAddress: req.ip || null, userAgent: req.headers['user-agent'] || null };
}

function normalizeEmailError(error) {
  if (error.code === 'EMAIL_PROVIDER_NOT_CONFIGURED') {
    return new AppError(503, error.code, 'Email provider is not configured.');
  }
  return new AppError(502, 'EMAIL_DELIVERY_FAILED', 'Email could not be sent. Please try again.');
}

exports.forgotPassword = asyncHandler(async (req, res) => {
  await passwordResetService.requestPasswordResetByEmail({
    email: req.body?.email,
    ...requestContext(req),
  });
  res.json({
    success: true,
    message: 'If an account exists for this email, a reset link has been sent.',
  });
});

exports.verifyToken = asyncHandler(async (req, res) => {
  const result = await passwordResetService.verifyResetToken(req.query.token);
  if (!result) throw new AppError(400, 'RESET_TOKEN_INVALID', 'This reset link is invalid or expired.');
  res.json({ success: true, ...result, data: result });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const result = await passwordResetService.resetPasswordWithToken({
    token: req.body?.token,
    newPassword: req.body?.password,
    confirmPassword: req.body?.confirmPassword,
    ...requestContext(req),
  });
  res.json({ success: true, message: result.message });
});

exports.sendAdminReset = asyncHandler(async (req, res) => {
  try {
    const result = await passwordResetService.adminSendResetLink({
      targetUserId: req.params.userId,
      adminUser: req.user,
      ...requestContext(req),
    });
    res.json({ success: true, message: result.message, data: result });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw normalizeEmailError(error);
  }
});

exports.sendOnboarding = asyncHandler(async (req, res) => {
  try {
    const result = await passwordResetService.sendNewUserSetupLink({
      userId: req.params.userId,
      createdByUser: req.user,
      ...requestContext(req),
    });
    res.json({ success: true, message: result.message, data: result });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw normalizeEmailError(error);
  }
});

exports.emailStatus = asyncHandler(async (_req, res) => {
  const data = { provider: config.email.provider, configured: emailService.isConfigured() };
  res.json({ success: true, ...data, data });
});
