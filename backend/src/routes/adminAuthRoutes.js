const express = require('express');
const router = express.Router();
const {
  adminSignupInit,
  adminLoginEmail,
  adminLoginOtpInit,
  adminLoginOtpVerify,
} = require('../controllers/adminAuthController');

router.post('/signup', adminSignupInit);
// Legacy compatibility for clients using email/password admin login routes.
router.post('/login', adminLoginEmail);
router.post('/login/email', adminLoginEmail);
router.post('/login/otp-init', adminLoginOtpInit);
router.post('/login/otp-verify', adminLoginOtpVerify);

module.exports = router;
