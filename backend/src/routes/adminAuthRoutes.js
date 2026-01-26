const express = require('express');
const router = express.Router();
const {
  adminSignupInit,
  adminLoginOtpInit,
  adminLoginOtpVerify,
} = require('../controllers/adminAuthController');

router.post('/signup', adminSignupInit);
router.post('/login/otp-init', adminLoginOtpInit);
router.post('/login/otp-verify', adminLoginOtpVerify);

module.exports = router;
