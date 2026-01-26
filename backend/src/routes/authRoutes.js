const express = require('express');
const router = express.Router();
const {
  signupEmailInit,
  signupMobileInit,
  signupCombinedInit,
  verifyOTP,
  setupPIN,
  loginEmail,
  loginMobile,
  loginMobileInit,
  loginMobileVerify,
  loginOtpInit,
  loginOtpVerify,
  loginPIN,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// Signup
router.post('/signup/combined-init', signupCombinedInit);
router.post('/signup/email-init', signupEmailInit);
router.post('/signup/mobile-init', signupMobileInit);
router.post('/signup/verify', verifyOTP);

// PIN Setup
router.post('/pin/setup', protect, setupPIN);

// Login
router.post('/login/email', loginEmail);
router.post('/login/mobile', loginMobile);
router.post('/login/otp-init', loginOtpInit);
router.post('/login/otp-verify', loginOtpVerify);
router.post('/login/mobile-init', loginMobileInit);
router.post('/login/mobile-verify', loginMobileVerify);
router.post('/login/pin', loginPIN);

module.exports = router;
