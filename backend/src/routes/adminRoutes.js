const express = require('express');
const router = express.Router();
const {
  createCategory,
  updateCategory,
  deleteCategory,
  listCategories,
  listProductsAdmin,
  createProduct,
  updateProduct,
  deleteProduct,
} = require('../controllers/adminController');
const {
  createUserByAdmin,
  listUsers,
  listUsersWithDetails,
  getLatestSignups,
  countUsers,
  setUserManualActivation,
  getUserDetail,
  getUserFinancialDetails,
  listKycApplications,
  getAdminStats,
  getTokenPriceAdmin,
  setTokenPriceAdmin,
  listIcoTransactions,
  listRecentTransactions,
  listReferralEarningsAdmin,
  searchReferralTree,
  updateUserStatus,
  updateUserEmail,
  updateUserPin,
  updateReferralEarningStatus,
  listBankChangeRequests,
  reviewBankChangeRequest,
  listMobileChangeRequests,
  reviewMobileChangeRequest,
  getReferralTreeAdminV2,
  getReferralTreeAdmin,
} = require('../controllers/adminUserController');
const {
  listAdminUsers,
  getAdminUserDashboard,
  getAdminUserTransactions,
  getAdminUserDirectReferrals,
  getAdminUserReferralTreeSummary,
  adminAddTokens,
  adminResetPassword,
  adminVerifyUserEmail,
  adminEditUserProfile,
  listCommissionWithdrawalRequests,
  getCommissionWithdrawalRequestDetail,
  approveCommissionWithdrawalRequest,
  rejectCommissionWithdrawalRequest,
  markCommissionWithdrawalRequestPaid,
  listStakingClosures,
  closeStakingPosition,
  triggerStakingPayout,
  listVestingSchedule,
  markVestingPaymentPaid,
  listStakingAccountsUnified,
  listPreIcoStages,
  createPreIcoStage,
  updatePreIcoStage,
  togglePreIcoStageActivation,
  getPreIcoStageMetrics,
  listCommissionIssues,
  createCommissionIssue,
  updateCommissionIssue,
  adjustCommissionIssueAmount,
  listFiatTransactions,
  verifyFiatTransaction,
  listTokenPurchases,
  getWalletManagementView,
  listAdminAuditLogs,
  getAdminReminderSummary,
} = require('../controllers/adminPanelController');
const {
  adminReviewKyc,
  getKycDetailAdmin,
  adminSearchUsersForManualKyc,
  adminManualVerifyKyc,
} = require('../controllers/kycController');
const {
  listNotificationsAdmin,
  createNotificationAdmin,
} = require('../controllers/notificationController');
const {
  adminListWalletTransactions,
  adminUpdateWalletTransaction,
  adminManualWalletCredit,
} = require('../controllers/walletController');
const { protect, requireAdmin, requirePrivileged, requireSuperAdmin } = require('../middleware/authMiddleware');

router.use(protect, requirePrivileged);

// Admin overview
router.get('/stats', getAdminStats);
router.get('/users/count', countUsers);
router.get('/users/latest', getLatestSignups);
router.get('/ico/price', getTokenPriceAdmin);
router.post('/ico/price', requireSuperAdmin, setTokenPriceAdmin);

// Users & KYC
router.post('/usercreate', requireSuperAdmin, createUserByAdmin);
router.post('/users', requireSuperAdmin, createUserByAdmin);
router.get('/users', listUsers);
router.get('/users/details', listUsersWithDetails);
router.get('/users/:id', getUserDetail);
router.get('/users/:id/financials', getUserFinancialDetails);
router.patch('/users/:id/status', requireAdmin, updateUserStatus);
router.patch('/users/:id/activation/manual', requireSuperAdmin, setUserManualActivation);
router.patch('/users/:id/email', requireSuperAdmin, updateUserEmail);
router.patch('/users/:id/pin', requireSuperAdmin, updateUserPin);
router.get('/kyc', listKycApplications);
router.get('/kyc/manual/users', adminSearchUsersForManualKyc);
router.patch('/kyc/manual/users/:userId/verify', requireSuperAdmin, adminManualVerifyKyc);
router.get('/kyc/:kycId', getKycDetailAdmin);
router.patch('/kyc/:kycId/status', requireSuperAdmin, adminReviewKyc);
router.get('/ico/transactions', listIcoTransactions);
router.get('/transactions/recent', listRecentTransactions);
router.get('/referrals/earnings', listReferralEarningsAdmin);
router.patch('/referrals/earnings/:id', requireSuperAdmin, updateReferralEarningStatus);
router.get('/referrals/tree', getReferralTreeAdminV2);
router.get('/referrals/tree/:userId', getReferralTreeAdmin);
router.get('/referrals/search', searchReferralTree);

router.get('/bank/requests', listBankChangeRequests);
router.patch('/bank/requests/:id', requireSuperAdmin, reviewBankChangeRequest);
router.get('/mobile/requests', listMobileChangeRequests);
router.patch('/mobile/requests/:id', requireSuperAdmin, reviewMobileChangeRequest);

router.get('/wallet/transactions', adminListWalletTransactions);
router.patch('/wallet/transactions/:transactionId', requireSuperAdmin, adminUpdateWalletTransaction);
router.post('/wallet/manual-credit', requireSuperAdmin, adminManualWalletCredit);

router.get('/notifications', listNotificationsAdmin);
router.post('/notifications', requireAdmin, createNotificationAdmin);

router.get('/categories', listCategories);
router.post('/categories', requireAdmin, createCategory);
router.put('/categories/:id', requireAdmin, updateCategory);
router.delete('/categories/:id', requireAdmin, deleteCategory);

router.get('/products', listProductsAdmin);
router.post('/products', requireAdmin, createProduct);
router.put('/products/:id', requireAdmin, updateProduct);
router.delete('/products/:id', requireAdmin, deleteProduct);

// Admin panel v2 APIs
router.get('/panel/users', listAdminUsers);
router.get('/panel/users/:id', getAdminUserDashboard);
router.get('/panel/users/:id/transactions', getAdminUserTransactions);
router.get('/panel/users/:id/referrals/direct', getAdminUserDirectReferrals);
router.get('/panel/users/:id/referrals/tree', getAdminUserReferralTreeSummary);
router.get('/panel/users/:id/wallet', getWalletManagementView);

router.post('/panel/users/:id/tokens', requireSuperAdmin, adminAddTokens);
router.post('/panel/users/:id/password/reset', requireSuperAdmin, adminResetPassword);
router.post('/panel/users/:id/email/verify', requireSuperAdmin, adminVerifyUserEmail);
router.patch('/panel/users/:id/profile', requireSuperAdmin, adminEditUserProfile);
router.patch('/panel/users/:id/status', requireAdmin, updateUserStatus);

router.get('/panel/commission-withdrawals', listCommissionWithdrawalRequests);
router.get('/panel/commission-withdrawals/:requestId', getCommissionWithdrawalRequestDetail);
router.post('/panel/commission-withdrawals/:requestId/approve', requireAdmin, approveCommissionWithdrawalRequest);
router.post('/panel/commission-withdrawals/:requestId/reject', requireAdmin, rejectCommissionWithdrawalRequest);
router.post('/panel/commission-withdrawals/:requestId/mark-paid', requireAdmin, markCommissionWithdrawalRequestPaid);

router.get('/panel/staking/closures', listStakingClosures);
router.post('/panel/staking/:stakeId/close', requireAdmin, closeStakingPosition);
router.post('/panel/staking/:stakeId/payout', requireAdmin, triggerStakingPayout);
router.get('/panel/staking/accounts', listStakingAccountsUnified);

router.get('/panel/vesting/schedule', listVestingSchedule);
router.post('/panel/vesting/:stakeId/payments/:paymentNo/paid', requireAdmin, markVestingPaymentPaid);

router.get('/panel/stages', listPreIcoStages);
router.get('/panel/stages/metrics', getPreIcoStageMetrics);
router.post('/panel/stages', requireSuperAdmin, createPreIcoStage);
router.patch('/panel/stages/:stageId', requireSuperAdmin, updatePreIcoStage);
router.post('/panel/stages/:stageId/activation', requireSuperAdmin, togglePreIcoStageActivation);

router.get('/panel/commission-issues', listCommissionIssues);
router.post('/panel/commission-issues', requireAdmin, createCommissionIssue);
router.patch('/panel/commission-issues/:issueId', requireAdmin, updateCommissionIssue);
router.post('/panel/commission-issues/:issueId/adjust', requireAdmin, adjustCommissionIssueAmount);

router.get('/panel/fiat-transactions', listFiatTransactions);
router.patch('/panel/fiat-transactions/:transactionId/verify', requireAdmin, verifyFiatTransaction);
router.get('/panel/token-purchases', listTokenPurchases);

router.get('/panel/reminders', getAdminReminderSummary);
router.get('/panel/audit-logs', requireAdmin, listAdminAuditLogs);

module.exports = router;
