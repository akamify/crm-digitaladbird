const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/passwordResetController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RESET_RATE_LIMITED',
    message: 'Too many reset requests. Please try again later.',
    error: { code: 'RESET_RATE_LIMITED', message: 'Too many reset requests. Please try again later.' },
  },
});

router.post('/auth/forgot-password', forgotPasswordLimiter, controller.forgotPassword);
router.get('/auth/reset-password/verify', controller.verifyToken);
router.post('/auth/reset-password', controller.resetPassword);

router.post(
  '/admin/users/:userId/send-password-reset',
  authenticate,
  requireRole('super_admin', 'admin', 'rm'),
  controller.sendAdminReset,
);
router.post(
  '/admin/users/:userId/send-onboarding-email',
  authenticate,
  requireRole('super_admin', 'admin', 'rm'),
  controller.sendOnboarding,
);
router.get(
  '/admin/email/status',
  authenticate,
  requireRole('super_admin'),
  controller.emailStatus,
);

module.exports = router;
