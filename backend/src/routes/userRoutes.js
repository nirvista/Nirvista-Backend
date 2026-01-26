const express = require('express');
const {
  getAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  getProfile,
  updateProfileName,
  uploadProfileImage,
  getOnboardingStatus,
  requestActionOtp,
  verifyActionOtp,
  confirmEmailChange,
  changePin,
  requestMobileChange,
  addBankDetails,
  addUpiDetails,
  listBankChangeRequests,
  listMobileChangeRequests,
  getReferralTree,
  listCountries,
  updateCountry,
  getReferralSummary,
  listReferralEarnings,
  getReferralCode,
  listReferralDownline,
} = require('../controllers/userController');
const {
  listNotificationsUser,
  markNotificationRead,
} = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');
const { singleImageUpload } = require('../middleware/uploadMiddleware');

const router = express.Router();

router.use(protect);

router.get('/profile', getProfile);
router.patch('/profile/name', updateProfileName);
router.post('/profile/image', singleImageUpload('document'), uploadProfileImage);
router.get('/onboarding-status', getOnboardingStatus);
router.get('/countries', listCountries);
router.patch('/country', updateCountry);
router.post('/otp/init', requestActionOtp);
router.post('/otp/verify', verifyActionOtp);
router.post('/email/change-verify', confirmEmailChange);
router.post('/pin/change', changePin);
router.post('/mobile/change-request', requestMobileChange);
router.get('/mobile/change-requests', listMobileChangeRequests);
router.post('/bank', addBankDetails);
router.post('/upi', addUpiDetails);
router.get('/bank/requests', listBankChangeRequests);

router.get('/addresses', getAddresses);
router.post('/addresses', addAddress);
router.put('/addresses/:addressId', updateAddress);
router.delete('/addresses/:addressId', deleteAddress);
router.patch('/addresses/:addressId/default', setDefaultAddress);
router.get('/referral/summary', getReferralSummary);
router.get('/referral/earnings', listReferralEarnings);
router.get('/referral/activities', listReferralEarnings);
router.get('/referral/code', getReferralCode);
router.get('/referral/downline', listReferralDownline);
router.get('/referral/tree', getReferralTree);
router.get('/notifications', listNotificationsUser);
router.patch('/notifications/:id/read', markNotificationRead);

module.exports = router;
