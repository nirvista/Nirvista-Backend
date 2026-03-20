const express = require('express');
const router = express.Router();
const {
  signupEmailInit,
  signupMobileInit,
  signupCombinedInit,
  signupEmailPassword,
  verifyOTP,
  setupPIN,
  loginEmail,
  loginMobile,
  loginMobileInit,
  loginMobileVerify,
  loginOtpInit,
  loginOtpVerify,
  forgotPasswordInit,
  forgotPasswordReset,
  loginPIN,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// Debug-friendly route listing to confirm deployed auth routes
router.get('/', (_req, res) => {
  res.json({
    message: 'Auth routes available',
    routes: [
      'POST /api/auth/signup/combined-init',
      'POST /api/auth/signup/email-init',
      'POST /api/auth/signup/email-password',
      'POST /api/auth/signup/mobile-init',
      'POST /api/auth/signup/verify',
      'POST /api/auth/pin/setup',
      'POST /api/auth/login/email',
      'POST /api/auth/login/email-password',
      'POST /api/auth/login/mobile',
      'POST /api/auth/login/otp-init',
      'POST /api/auth/login/otp-verify',
      'POST /api/auth/forgot-password/init',
      'POST /api/auth/forgot-password/reset',
      'POST /api/auth/login/mobile-init',
      'POST /api/auth/login/mobile-verify',
      'POST /api/auth/login/pin',
    ],
  });
});

// Signup
router.post('/signup/combined-init', signupCombinedInit);
router.post('/signup/email-init', signupEmailInit);
router.post('/signup/email-password', signupEmailPassword);
router.post('/signup/mobile-init', signupMobileInit);
router.post('/signup/verify', verifyOTP);

// PIN Setup
router.post('/pin/setup', protect, setupPIN);

// Login
router.post('/login/email', loginEmail);
router.post('/login/email-password', loginEmail);
router.post('/login/mobile', loginMobile);
router.post('/login/otp-init', loginOtpInit);
router.post('/login/otp-verify', loginOtpVerify);
router.post('/forgot-password/init', forgotPasswordInit);
router.post('/forgot-password/reset', forgotPasswordReset);
router.post('/login/mobile-init', loginMobileInit);
router.post('/login/mobile-verify', loginMobileVerify);
router.post('/login/pin', loginPIN);

module.exports = router;
