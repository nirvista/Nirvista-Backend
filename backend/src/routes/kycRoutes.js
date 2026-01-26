const express = require('express');
const {
  submitKyc,
  getKycStatus,
  uploadKycDocument,
  adminReviewKyc,
} = require('../controllers/kycController');
const { protect, requireAdmin } = require('../middleware/authMiddleware');
const { singleImageUpload } = require('../middleware/uploadMiddleware');

const router = express.Router();

router.use(protect);

router.get('/status', getKycStatus);
router.post('/submit', submitKyc);
router.post('/upload', singleImageUpload('document'), uploadKycDocument);

// Admin review endpoints
router.patch('/:kycId/status', requireAdmin, adminReviewKyc);

module.exports = router;
