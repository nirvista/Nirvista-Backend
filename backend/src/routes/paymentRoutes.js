const express = require('express');
const router = express.Router();
const {
  handlePhonePeCallback,
  handleRazorpayVerify,
  createRazorpayWalletOrder,
  handlePayUResponse,
} = require('../controllers/paymentController');
const { protect } = require('../middleware/authMiddleware');

router.post('/phonepe/callback', handlePhonePeCallback);
router.post('/razorpay/order', protect, createRazorpayWalletOrder);
router.post('/razorpay/verify', handleRazorpayVerify);
router.post('/payu/response', handlePayUResponse);
router.get('/payu/response', handlePayUResponse);

module.exports = router;
