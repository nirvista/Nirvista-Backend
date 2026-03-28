const express = require('express');
const router = express.Router();
const {
  getWalletSummary,
  listWalletTransactions,
  initiateWalletTopup,
  requestWalletWithdrawal,
  getReferralWithdrawalSummary,
  requestReferralWithdrawal,
  listReferralWithdrawals,
  redeemReferralEarnings,
  swapMainToToken,
  stakeTokens,
  listStakes,
  requestStakeWithdrawal,
  claimStake,
  getWalletAnalytics,
  adminListWalletTransactions,
  adminUpdateWalletTransaction,
} = require('../controllers/walletController');
const { protect, requireAdmin } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/summary', getWalletSummary);
router.get('/analytics', getWalletAnalytics);
router.get('/transactions', listWalletTransactions);
router.post('/topup', initiateWalletTopup);
router.post('/withdraw', requestWalletWithdrawal);
router.get('/referral/withdrawal-summary', getReferralWithdrawalSummary);
router.get('/referral/withdrawals', listReferralWithdrawals);
router.post('/referral/withdraw', requestReferralWithdrawal);
router.post('/swap', swapMainToToken);
router.post('/stake', stakeTokens);
router.get('/stakes', listStakes);
router.post('/stakes/:stakeId/withdraw', requestStakeWithdrawal);
router.post('/stakes/:stakeId/claim', claimStake);
router.post('/referral/redeem', redeemReferralEarnings);

router.get('/admin/transactions', requireAdmin, adminListWalletTransactions);
router.patch('/admin/transactions/:transactionId', requireAdmin, adminUpdateWalletTransaction);

module.exports = router;
