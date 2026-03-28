const mongoose = require('mongoose');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const KycApplication = require('../models/KycApplication');
const IcoHolding = require('../models/IcoHolding');
const IcoTransaction = require('../models/IcoTransaction');
const WalletAccount = require('../models/WalletAccount');
const WalletTransaction = require('../models/WalletTransaction');
const StakingPosition = require('../models/StakingPosition');
const ReferralEarning = require('../models/ReferralEarning');
const PreIcoStage = require('../models/PreIcoStage');
const CommissionIssue = require('../models/CommissionIssue');
const TokenAdjustment = require('../models/TokenAdjustment');
const AuditLog = require('../models/AuditLog');
const { getTokenSymbol, getTokenPrice } = require('../utils/tokenPrice');
const { buildReferralTree } = require('../utils/referralTree');
const { createUserNotification } = require('../utils/notificationService');
const { getOrCreateWalletAccount } = require('../utils/walletAccount');
const { uploadImageBuffer, isCloudinaryConfigured } = require('../utils/cloudinary');
const {
  resolveActivationStatusMap,
  resolveUserActivationStatus,
} = require('../utils/activationPolicy');

const ADMIN_BONUS_PERCENT = Number(process.env.ICO_BONUS_PERCENT || 8);

const sanitizeUser = (user) => {
  if (!user) return null;
  const doc = user.toObject ? user.toObject() : { ...user };
  delete doc.password;
  delete doc.pin;
  delete doc.otp;
  return doc;
};

const toDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const ensureObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));

const readStatusDate = (history, targetStatus) => {
  const entry = (history || []).find((item) => item.status === targetStatus);
  return entry ? entry.changedAt : null;
};

const appendStatusHistory = (transaction, status, changedBy, note) => {
  transaction.statusHistory = [
    ...(transaction.statusHistory || []),
    {
      status,
      changedAt: new Date(),
      changedBy,
      note,
    },
  ];
};

const getWithdrawalSource = (transaction) => transaction?.metadata?.withdrawalSource || 'wallet';

const logAudit = async ({ actor, actorRole, action, entityType, entityId, before, after, metadata }) => {
  try {
    await AuditLog.create({
      actor,
      actorRole,
      action,
      entityType,
      entityId: entityId ? String(entityId) : undefined,
      before,
      after,
      metadata,
    });
  } catch (error) {
    console.error('Audit log write failed', error.message);
  }
};

const listAdminUsers = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const search = String(req.query.search || '').trim();

    const filter = { role: 'user' };
    if (search) {
      const regex = new RegExp(search, 'i');
      filter.$or = [{ name: regex }, { email: regex }, { mobile: regex }, { referralCode: regex }];
    }

    const requestedAccountStatus = req.query.accountStatus
      ? String(req.query.accountStatus).toLowerCase()
      : '';
    if (requestedAccountStatus === 'suspended') {
      filter.isActive = false;
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('name email mobile isEmailVerified isMobileVerified isActive createdAt disabledAt disabledReason'),
      User.countDocuments(filter),
    ]);

    const userIds = users.map((item) => item._id);
    const [kycDocs, holdings, activationMap] = await Promise.all([
      KycApplication.find({ user: { $in: userIds } }).select('user status'),
      IcoHolding.find({ user: { $in: userIds } }).select('user balance'),
      resolveActivationStatusMap(userIds),
    ]);

    const kycMap = new Map(kycDocs.map((item) => [item.user.toString(), item.status]));
    const holdingMap = new Map(holdings.map((item) => [item.user.toString(), item.balance]));

    let data = users.map((item) => {
      const activationStatus = activationMap.get(item._id.toString());
      const accountStatus = item.isActive === false
        ? 'suspended'
        : (activationStatus?.binaryStatus || 'inactive');

      return {
        userId: item._id,
        fullName: item.name,
        emailAddress: item.email,
        phoneNumber: item.mobile,
        emailVerificationStatus: item.isEmailVerified ? 'verified' : 'not_verified',
        phoneVerificationStatus: item.isMobileVerified ? 'verified' : 'not_verified',
        kycStatus: kycMap.get(item._id.toString()) || 'pending',
        accountStatus,
        registrationDate: item.createdAt,
        tokenBalance: holdingMap.get(item._id.toString()) || 0,
        actions: {
          viewDetails: true,
          transactions: true,
          referrals: true,
          addTokens: req.user.role === 'super_admin',
          resetPassword: req.user.role === 'super_admin',
          verifyEmail: req.user.role === 'super_admin',
          activateSuspendToggle: req.user.role === 'super_admin',
          editProfile: req.user.role === 'super_admin',
        },
      };
    });

    if (['active', 'inactive', 'suspended'].includes(requestedAccountStatus)) {
      data = data.filter((item) => item.accountStatus === requestedAccountStatus);
    }

    return res.json({
      data,
      pagination: {
        total: ['active', 'inactive', 'suspended'].includes(requestedAccountStatus) ? data.length : total,
        page,
        limit,
        hasMore: ['active', 'inactive', 'suspended'].includes(requestedAccountStatus)
          ? false
          : skip + data.length < total,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getAdminUserDashboard = async (req, res) => {
  try {
    if (!ensureObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const user = await User.findById(req.params.id).select('-password -pin -otp');
    if (!user || user.role !== 'user') {
      return res.status(404).json({ message: 'User not found' });
    }

    const [kyc, wallet, holding, purchasedAgg, lockedAgg, referralAgg, stakingPositions, adjustmentAgg, activationStatus] =
      await Promise.all([
        KycApplication.findOne({ user: user._id }),
        WalletAccount.findOne({ user: user._id }),
        IcoHolding.findOne({ user: user._id }),
        IcoTransaction.aggregate([
          { $match: { user: user._id, type: 'buy', status: 'completed' } },
          { $group: { _id: null, totalPurchased: { $sum: '$tokenAmount' } } },
        ]),
        StakingPosition.aggregate([
          {
            $match: {
              user: user._id,
              status: { $in: ['active', 'withdrawal_requested', 'withdrawal_available', 'matured', 'closed'] },
            },
          },
          { $group: { _id: null, lockedTokens: { $sum: '$tokenAmount' } } },
        ]),
        ReferralEarning.aggregate([
          { $match: { earner: user._id, status: { $in: ['released', 'pending'] } } },
          {
            $group: {
              _id: null,
              totalReferralCommission: { $sum: '$amount' },
            },
          },
        ]),
        StakingPosition.find({ user: user._id }).sort({ createdAt: -1 }),
        TokenAdjustment.aggregate([
          { $match: { user: user._id } },
          { $group: { _id: null, totalAdjusted: { $sum: '$amount' } } },
        ]),
        resolveUserActivationStatus(user._id),
      ]);

    const totalTokensPurchased = purchasedAgg?.[0]?.totalPurchased || 0;
    const bonusTokens = Number((totalTokensPurchased * ADMIN_BONUS_PERCENT) / 100);
    const totalAdjustedTokens = adjustmentAgg?.[0]?.totalAdjusted || 0;
    const availableBalance = (holding?.balance || 0) + totalAdjustedTokens;
    const lockedTokens = lockedAgg?.[0]?.lockedTokens || 0;
    const referralCommissionEarned = referralAgg?.[0]?.totalReferralCommission || 0;

    const kycLogs = [];
    if (kyc?.submittedAt) {
      kycLogs.push({ action: 'submitted', at: kyc.submittedAt, note: 'KYC submitted' });
    }
    if (kyc?.verifiedAt) {
      kycLogs.push({ action: 'verified', at: kyc.verifiedAt, note: 'KYC approved' });
    }
    if (kyc?.rejectedAt) {
      kycLogs.push({ action: 'rejected', at: kyc.rejectedAt, note: kyc.rejectionReason || 'KYC rejected' });
    }

    const rewardsFromVesting = stakingPositions.reduce((sum, stake) => {
      const withdrawn = (stake.interestHistory || [])
        .filter((entry) => entry.status === 'withdrawn')
        .reduce((entrySum, entry) => entrySum + (entry.amount || 0), 0);
      return sum + withdrawn;
    }, 0);

    const referralEligibility = user.isActive && (kyc?.status === 'verified');

    return res.json({
      profile: {
        userId: user._id,
        fullName: user.name,
        referralCode: user.referralCode || 'No data available',
        email: user.email || 'No data available',
        phone: user.mobile || 'No data available',
        lastLogin: user.lastLoginAt || 'No data available',
        accountStatus: user.isActive === false ? 'suspended' : activationStatus.binaryStatus,
        registrationDate: user.createdAt,
      },
      kyc: {
        status: kyc?.status || 'pending',
        uploadedDocuments: kyc
          ? [
              { type: 'aadhaar_front', url: kyc.aadhaarFrontUrl },
              { type: 'aadhaar_back', url: kyc.aadhaarBackUrl },
              { type: 'pan', url: kyc.panUrl },
              { type: 'selfie', url: kyc.selfieUrl },
            ].filter((doc) => doc.url)
          : [],
        logs: kycLogs,
      },
      bankDetails: {
        accountHolderName: user.bankDetails?.accountHolderName || null,
        accountNumber: user.bankDetails?.accountNumber || null,
        ifscCode: user.bankDetails?.ifsc || null,
        bankName: user.bankDetails?.bankName || null,
      },
      tokenFinancialSummary: {
        tokenSymbol: getTokenSymbol(),
        tokenPrice: getTokenPrice(),
        totalTokensPurchased,
        bonusTokens,
        availableBalance,
        lockedTokens,
      },
      stakingVesting: {
        positions: stakingPositions,
      },
      rewardsEarnings: {
        referralCommissionEarned,
        commissionEligibilityStatus: referralEligibility ? 'eligible' : 'not_eligible',
        vestingRewards: rewardsFromVesting,
        levelBonus: 0,
        partnerTokenRewards: 0,
        insuranceBenefitEligibility: referralEligibility,
        rankAchievement: null,
        levelAchievement: user.referralLevel || 0,
      },
      wallets: {
        availableBalance: wallet?.balance || 0,
        lockedBalance: wallet?.pendingWithdrawals || 0,
        totalTokens: availableBalance,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getAdminUserTransactions = async (req, res) => {
  try {
    if (!ensureObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const userId = new mongoose.Types.ObjectId(req.params.id);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

    const [walletTx, icoTx, stakes, referralEarnings] = await Promise.all([
      WalletTransaction.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(limit),
      IcoTransaction.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(limit),
      StakingPosition.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(limit),
      ReferralEarning.find({ earner: userId })
        .sort({ createdAt: -1 })
        .limit(limit),
    ]);

    const walletRows = walletTx.map((tx) => ({
      transactionId: tx._id,
      type:
        tx.category === 'topup'
          ? 'fiat_deposit'
          : tx.category === 'withdrawal'
            ? 'fiat_withdrawal'
            : tx.category,
      amount: tx.amount,
      status: tx.status,
      date: tx.createdAt,
      paymentMethod: tx.paymentGateway || tx.metadata?.payoutMethod || 'manual',
      source: 'wallet',
    }));

    const icoRows = icoTx.map((tx) => ({
      transactionId: tx._id,
      type: tx.type === 'buy' ? 'token_purchase' : 'token_sell',
      amount: tx.fiatAmount,
      tokenAmount: tx.tokenAmount,
      status: tx.status,
      date: tx.createdAt,
      paymentMethod: tx.paymentReference || 'unknown',
      source: 'ico',
    }));

    const stakeRows = stakes.map((stake) => ({
      transactionId: stake._id,
      type: 'staking_action',
      amount: stake.tokenAmount,
      status: stake.status,
      date: stake.createdAt,
      paymentMethod: stake.stackType,
      source: 'staking',
    }));

    const referralRows = referralEarnings.map((earning) => ({
      transactionId: earning._id,
      type: 'referral_commission',
      amount: earning.amount,
      status: earning.status,
      date: earning.createdAt,
      paymentMethod: earning.sourceType,
      source: 'referral',
    }));

    const data = [...walletRows, ...icoRows, ...stakeRows, ...referralRows]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, limit);

    return res.json({ data });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getAdminUserDirectReferrals = async (req, res) => {
  try {
    if (!ensureObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const referrals = await User.find({ referredBy: req.params.id })
      .sort({ createdAt: -1 })
      .select('name email mobile referralLevel isActive createdAt');

    const referralIds = referrals.map((item) => item._id);
    const kycDocs = await KycApplication.find({ user: { $in: referralIds } }).select('user status');
    const kycMap = new Map(kycDocs.map((item) => [item.user.toString(), item.status]));

    const parent = await User.findById(req.params.id).select('name isActive');

    const data = referrals.map((item) => {
      const kycStatus = kycMap.get(item._id.toString()) || 'pending';
      const eligible = item.isActive && kycStatus === 'verified';
      return {
        userId: item._id,
        name: item.name,
        level: item.referralLevel || 1,
        status: eligible ? 'eligible' : item.isActive ? 'active' : 'inactive',
        userStatus: parent?.isActive ? 'active' : 'inactive',
        referralStatus: item.isActive ? 'active' : 'inactive',
        kycStatus,
        joinedAt: item.createdAt,
      };
    });

    return res.json({
      parentUser: {
        userId: parent?._id,
        name: parent?.name,
        status: parent?.isActive ? 'active' : 'inactive',
      },
      data,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getAdminUserReferralTreeSummary = async (req, res) => {
  try {
    if (!ensureObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const maxDepth = Math.min(Math.max(Number(req.query.maxDepth) || 8, 1), 8);
    const users = await User.find({
      $or: [{ _id: req.params.id }, { referralPath: req.params.id }],
    })
      .select('name email mobile referredBy referralPath referralLevel isActive')
      .lean();

    const tree = buildReferralTree(users, req.params.id);
    if (!tree) {
      return res.json({ tree: null, levelCounts: [], totals: { total: 0, active: 0, inactive: 0 } });
    }

    const levelMap = new Map();
    const queue = (tree.children || []).map((node) => ({ node, level: 1 }));
    let active = 0;
    let inactive = 0;

    while (queue.length) {
      const { node, level } = queue.shift();
      if (!node || level > maxDepth) continue;
      if (!levelMap.has(level)) {
        levelMap.set(level, { level, total: 0, active: 0, inactive: 0 });
      }
      const bucket = levelMap.get(level);
      bucket.total += 1;
      if (node.isActive) {
        bucket.active += 1;
        active += 1;
      } else {
        bucket.inactive += 1;
        inactive += 1;
      }

      (node.children || []).forEach((child) => queue.push({ node: child, level: level + 1 }));
    }

    const levelCounts = Array.from(levelMap.values()).sort((a, b) => a.level - b.level);

    return res.json({
      tree,
      levelCounts,
      totals: {
        total: active + inactive,
        active,
        inactive,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const adminAddTokens = async (req, res) => {
  try {
    if (!ensureObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const { tokenAmount, reason, type } = req.body || {};
    const amount = Number(tokenAmount);
    if (Number.isNaN(amount) || amount === 0) {
      return res.status(400).json({ message: 'tokenAmount must be a non-zero number' });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: 'reason is required' });
    }
    const adjustmentType = String(type || '').trim().toLowerCase();
    if (!['bonus', 'adjustment', 'manual_allocation'].includes(adjustmentType)) {
      return res.status(400).json({ message: 'type must be bonus, adjustment, or manual_allocation' });
    }

    const user = await User.findById(req.params.id).select('name email role');
    if (!user || user.role !== 'user') {
      return res.status(404).json({ message: 'User not found' });
    }

    const holdingBefore = await IcoHolding.findOne({ user: user._id });
    const beforeBalance = holdingBefore?.balance || 0;

    const holding = await IcoHolding.findOneAndUpdate(
      { user: user._id },
      { $inc: { balance: amount } },
      { new: true, upsert: true },
    );

    const adjustment = await TokenAdjustment.create({
      user: user._id,
      amount,
      adjustmentType,
      reason: String(reason).trim(),
      performedBy: req.user._id,
      metadata: {
        source: 'admin_panel',
      },
    });

    await createUserNotification({
      userId: user._id,
      title: 'Token balance updated by admin',
      message: `${Math.abs(amount)} ${getTokenSymbol()} tokens ${amount > 0 ? 'added to' : 'deducted from'} your wallet.`,
      type: 'admin',
      metadata: { adjustmentId: adjustment._id },
    });

    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'admin_add_tokens',
      entityType: 'user',
      entityId: user._id,
      before: { tokenBalance: beforeBalance },
      after: { tokenBalance: holding.balance, tokenAmount: amount, adjustmentType },
      metadata: { reason: String(reason).trim() },
    });

    return res.status(201).json({
      message: 'Token adjustment completed',
      adjustment,
      balance: holding.balance,
      tokenSymbol: getTokenSymbol(),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const adminResetPassword = async (req, res) => {
  try {
    if (!ensureObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const { mode, newPassword } = req.body || {};
    const resetMode = String(mode || 'auto_generate').trim().toLowerCase();

    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'user') {
      return res.status(404).json({ message: 'User not found' });
    }

    if (resetMode === 'send_link') {
      await logAudit({
        actor: req.user._id,
        actorRole: req.user.role,
        action: 'admin_password_reset_link',
        entityType: 'user',
        entityId: user._id,
        metadata: { email: user.email },
      });
      return res.json({ message: 'Password reset link trigger registered (integrate email provider to send actual link).' });
    }

    let finalPassword = String(newPassword || '').trim();
    if (!finalPassword) {
      finalPassword = crypto.randomBytes(6).toString('hex');
    }
    if (finalPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(finalPassword, salt);
    await user.save();

    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'admin_password_reset',
      entityType: 'user',
      entityId: user._id,
      metadata: { mode: resetMode },
    });

    return res.json({
      message: 'Password reset successfully',
      generatedPassword: newPassword ? undefined : finalPassword,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const adminVerifyUserEmail = async (req, res) => {
  try {
    if (!ensureObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'user') {
      return res.status(404).json({ message: 'User not found' });
    }

    const before = { isEmailVerified: user.isEmailVerified };
    user.isEmailVerified = true;
    await user.save();

    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'admin_verify_email',
      entityType: 'user',
      entityId: user._id,
      before,
      after: { isEmailVerified: true },
    });

    return res.json({
      userId: user._id,
      isEmailVerified: user.isEmailVerified,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const adminEditUserProfile = async (req, res) => {
  try {
    if (!ensureObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'user') {
      return res.status(404).json({ message: 'User not found' });
    }

    const before = sanitizeUser(user);
    const payload = req.body || {};

    if (payload.name !== undefined) user.name = String(payload.name || '').trim();
    if (payload.email !== undefined) user.email = String(payload.email || '').trim().toLowerCase();
    if (payload.phone !== undefined) user.mobile = String(payload.phone || '').trim();
    if (payload.address !== undefined) {
      user.addresses = [
        {
          ...(payload.address || {}),
          isDefault: true,
        },
      ];
    }
    if (payload.bankDetails !== undefined) {
      user.bankDetails = {
        ...user.bankDetails,
        ...payload.bankDetails,
        verified: true,
        addedBy: 'admin',
        addedAt: new Date(),
      };
    }

    await user.save();

    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'admin_edit_profile',
      entityType: 'user',
      entityId: user._id,
      before,
      after: sanitizeUser(user),
    });

    return res.json({
      message: 'Profile updated',
      user: sanitizeUser(user),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const listCommissionWithdrawalRequests = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { category: 'withdrawal', 'metadata.withdrawalSource': 'referral' };
    if (req.query.status) filter.status = String(req.query.status).trim().toLowerCase();

    const [rows, total] = await Promise.all([
      WalletTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email mobile'),
      WalletTransaction.countDocuments(filter),
    ]);

    const data = rows.map((tx) => ({
      requestId: tx._id,
      userId: tx.user?._id,
      userName: tx.user?.name,
      amount: tx.amount,
      walletBalanceAtRequestTime: tx.metadata?.walletBalanceAtRequestTime ?? null,
      paymentMethod: tx.metadata?.payoutMethod || tx.paymentGateway || 'bank',
      status: tx.status,
      requestedDate: tx.createdAt,
      approvedDate: readStatusDate(tx.statusHistory, 'processed'),
      rejectedDate: readStatusDate(tx.statusHistory, 'failed') || readStatusDate(tx.statusHistory, 'cancelled'),
      paidDate: readStatusDate(tx.statusHistory, 'completed'),
    }));

    return res.json({
      data,
      pagination: {
        total,
        page,
        limit,
        hasMore: skip + data.length < total,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getCommissionWithdrawalRequestDetail = async (req, res) => {
  try {
    if (!ensureObjectId(req.params.requestId)) {
      return res.status(400).json({ message: 'Invalid request id' });
    }

    const transaction = await WalletTransaction.findOne({
      _id: req.params.requestId,
      category: 'withdrawal',
      'metadata.withdrawalSource': 'referral',
    }).populate('user', 'name email mobile bankDetails upiDetails referralWalletBalance referralTotalEarned');

    if (!transaction) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const [commissionBreakdown, historyRef] = await Promise.all([
      ReferralEarning.find({ earner: transaction.user._id })
        .sort({ createdAt: -1 })
        .limit(100),
      WalletTransaction.find({
        user: transaction.user._id,
        category: 'withdrawal',
        'metadata.withdrawalSource': 'referral',
      })
        .sort({ createdAt: -1 })
        .limit(20),
    ]);

    return res.json({
      request: transaction,
      userDetails: transaction.user,
      commissionBreakdown,
      bankOrWalletInfo:
        transaction.metadata?.payoutMethod === 'upi'
          ? transaction.user?.upiDetails
          : transaction.user?.bankDetails,
      transactionHistoryReference: historyRef,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const approveCommissionWithdrawalRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    if (!ensureObjectId(requestId)) {
      return res.status(400).json({ message: 'Invalid request id' });
    }

    const tx = await WalletTransaction.findOne({
      _id: requestId,
      category: 'withdrawal',
      'metadata.withdrawalSource': 'referral',
    });
    if (!tx) return res.status(404).json({ message: 'Request not found' });
    if (!['pending', 'initiated'].includes(tx.status)) {
      return res.status(400).json({ message: 'Only pending requests can be approved' });
    }

    const before = { status: tx.status, metadata: tx.metadata };
    tx.status = 'processed';
    tx.metadata = {
      ...(tx.metadata || {}),
      approvedAt: new Date(),
      approvedBy: req.user._id,
    };
    appendStatusHistory(tx, 'processed', req.user._id, 'Withdrawal approved');
    await tx.save();

    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'approve_withdrawal_request',
      entityType: 'wallet_transaction',
      entityId: tx._id,
      before,
      after: { status: tx.status, metadata: tx.metadata },
    });

    return res.json({ message: 'Withdrawal request approved', request: tx });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const rejectCommissionWithdrawalRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { reason } = req.body || {};
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: 'reason is required' });
    }
    if (!ensureObjectId(requestId)) {
      return res.status(400).json({ message: 'Invalid request id' });
    }

    const tx = await WalletTransaction.findOne({
      _id: requestId,
      category: 'withdrawal',
      'metadata.withdrawalSource': 'referral',
    });
    if (!tx) return res.status(404).json({ message: 'Request not found' });
    if (!['pending', 'initiated', 'processed'].includes(tx.status)) {
      return res.status(400).json({ message: 'Only pending/approved requests can be rejected' });
    }

    const user = await User.findById(tx.user);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.referralWalletBalance = (user.referralWalletBalance || 0) + tx.amount;
    await user.save();

    const before = { status: tx.status, metadata: tx.metadata };
    tx.status = 'failed';
    tx.metadata = {
      ...(tx.metadata || {}),
      rejectedAt: new Date(),
      rejectedBy: req.user._id,
      rejectionReason: String(reason).trim(),
    };
    appendStatusHistory(tx, 'failed', req.user._id, `Rejected: ${String(reason).trim()}`);
    await tx.save();

    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'reject_withdrawal_request',
      entityType: 'wallet_transaction',
      entityId: tx._id,
      before,
      after: { status: tx.status, metadata: tx.metadata },
      metadata: { reason: String(reason).trim() },
    });

    return res.json({
      message: 'Withdrawal request rejected',
      request: tx,
      referralWallet: {
        balance: user.referralWalletBalance,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const markCommissionWithdrawalRequestPaid = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { transactionReference, paymentNote } = req.body || {};

    if (!transactionReference || !String(transactionReference).trim()) {
      return res.status(400).json({ message: 'transactionReference is required' });
    }

    if (!ensureObjectId(requestId)) {
      return res.status(400).json({ message: 'Invalid request id' });
    }

    const tx = await WalletTransaction.findOne({
      _id: requestId,
      category: 'withdrawal',
      'metadata.withdrawalSource': 'referral',
    });
    if (!tx) return res.status(404).json({ message: 'Request not found' });
    if (!['processed', 'pending', 'initiated'].includes(tx.status)) {
      return res.status(400).json({ message: 'Request cannot be marked as paid from current status' });
    }

    let proofUpload = null;
    if (req.file?.buffer) {
      if (!isCloudinaryConfigured()) {
        return res.status(500).json({ message: 'Cloudinary is not configured on the server' });
      }
      proofUpload = await uploadImageBuffer(req.file.buffer, {
        folder: `withdrawal-proofs/${tx.user}`,
        publicId: `referral-withdrawal-${tx._id}-${Date.now()}`,
      });
    }

    const before = { status: tx.status, metadata: tx.metadata };
    tx.status = 'completed';
    tx.metadata = {
      ...(tx.metadata || {}),
      paidAt: new Date(),
      paidBy: req.user._id,
      transactionReference: String(transactionReference).trim(),
      paymentNote: paymentNote ? String(paymentNote).trim() : undefined,
      proofImageUrl: proofUpload?.secure_url || tx.metadata?.proofImageUrl,
      proofImagePublicId: proofUpload?.public_id || tx.metadata?.proofImagePublicId,
    };
    appendStatusHistory(tx, 'completed', req.user._id, 'Marked paid');
    await tx.save();

    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'mark_withdrawal_paid',
      entityType: 'wallet_transaction',
      entityId: tx._id,
      before,
      after: { status: tx.status, metadata: tx.metadata },
    });

    return res.json({
      message: 'Withdrawal request marked as paid',
      request: tx,
      proofImageUrl: tx.metadata?.proofImageUrl || null,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const syncStakingStatuses = async () => {
  const now = new Date();
  await StakingPosition.updateMany(
    {
      status: 'active',
      stackType: 'fixed',
      maturesAt: { $lte: now },
    },
    { $set: { status: 'matured' } },
  );
  await StakingPosition.updateMany(
    {
      status: 'withdrawal_requested',
      'withdrawal.withdrawableAt': { $lte: now },
    },
    { $set: { status: 'withdrawal_available' } },
  );
};

const ACTIVE_STAKING_STATUSES = ['active', 'withdrawal_requested', 'withdrawal_available', 'matured'];

const normalizeAdminStakeType = (value) => (value === 'fluid' ? 'flexible' : value);

const getStakeRewardPaid = (stake) =>
  (stake.interestHistory || [])
    .filter((entry) => entry.status === 'withdrawn')
    .reduce((sum, entry) => sum + (entry.amount || 0), 0);

const getStakeTimeline = (stake) => {
  const timeline = [
    { label: 'created', at: stake.createdAt || stake.startedAt, status: 'completed' },
    { label: 'started', at: stake.startedAt, status: 'completed' },
    { label: 'matures', at: stake.maturesAt, status: stake.maturesAt && stake.maturesAt <= new Date() ? 'completed' : 'upcoming' },
  ];

  if (stake.withdrawal?.requestedAt) {
    timeline.push({
      label: 'withdrawal_requested',
      at: stake.withdrawal.requestedAt,
      status: 'completed',
    });
  }

  if (stake.withdrawal?.withdrawableAt) {
    timeline.push({
      label: 'withdrawal_available',
      at: stake.withdrawal.withdrawableAt,
      status: stake.withdrawal.withdrawableAt <= new Date() ? 'completed' : 'upcoming',
    });
  }

  if (stake.metadata?.closedAt) {
    timeline.push({
      label: 'closed',
      at: stake.metadata.closedAt,
      status: 'completed',
    });
  }

  if (stake.metadata?.payoutTriggeredAt) {
    timeline.push({
      label: 'payout_triggered',
      at: stake.metadata.payoutTriggeredAt,
      status: 'completed',
    });
  }

  if (stake.claimedAt) {
    timeline.push({
      label: 'claimed',
      at: stake.claimedAt,
      status: 'completed',
    });
  }

  return timeline
    .filter((item) => item.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
};

const listAdminStakingUsers = async (req, res) => {
  try {
    await syncStakingStatuses();

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const match = {};
    if (req.query.status) match.status = String(req.query.status).trim().toLowerCase();
    if (req.query.type) {
      const type = req.query.type === 'flexible' ? 'fluid' : req.query.type;
      match.stackType = String(type).trim().toLowerCase();
    }
    if (req.query.durationMonths) {
      const durationMonths = Number(req.query.durationMonths);
      if (!Number.isNaN(durationMonths)) match.durationMonths = durationMonths;
    }

    const search = String(req.query.search || '').trim();
    const userSearchMatch = search
      ? {
          $or: [
            { 'user.name': { $regex: search, $options: 'i' } },
            { 'user.email': { $regex: search, $options: 'i' } },
            { 'user.mobile': { $regex: search, $options: 'i' } },
            { 'user.referralCode': { $regex: search, $options: 'i' } },
          ],
        }
      : null;

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: '$user',
          totalStakes: { $sum: 1 },
          activeStakes: {
            $sum: {
              $cond: [{ $in: ['$status', ACTIVE_STAKING_STATUSES] }, 1, 0],
            },
          },
          closedStakes: {
            $sum: {
              $cond: [{ $in: ['$status', ['closed', 'paid', 'claimed', 'cancelled']] }, 1, 0],
            },
          },
          totalStakedTokens: { $sum: '$tokenAmount' },
          totalRewardTokens: { $sum: '$interestAmount' },
          totalExpectedReturn: { $sum: '$expectedReturn' },
          fixedStakedTokens: {
            $sum: {
              $cond: [{ $eq: ['$stackType', 'fixed'] }, '$tokenAmount', 0],
            },
          },
          flexibleStakedTokens: {
            $sum: {
              $cond: [{ $eq: ['$stackType', 'fluid'] }, '$tokenAmount', 0],
            },
          },
          latestStakeAt: { $max: '$createdAt' },
          statuses: { $addToSet: '$status' },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      { $match: { 'user.role': 'user' } },
    ];

    if (userSearchMatch) {
      pipeline.push({ $match: userSearchMatch });
    }

    const countPipeline = [...pipeline, { $count: 'total' }];
    const dataPipeline = [
      ...pipeline,
      { $sort: { latestStakeAt: -1, _id: 1 } },
      { $skip: skip },
      { $limit: limit },
    ];

    const [rows, countRows] = await Promise.all([
      StakingPosition.aggregate(dataPipeline),
      StakingPosition.aggregate(countPipeline),
    ]);

    const data = rows.map((item) => ({
      userId: item.user._id,
      fullName: item.user.name,
      email: item.user.email || null,
      mobile: item.user.mobile || null,
      referralCode: item.user.referralCode || null,
      totalStakes: item.totalStakes || 0,
      activeStakes: item.activeStakes || 0,
      closedStakes: item.closedStakes || 0,
      totalStakedTokens: item.totalStakedTokens || 0,
      totalRewardTokens: item.totalRewardTokens || 0,
      totalExpectedReturn: item.totalExpectedReturn || 0,
      fixedStakedTokens: item.fixedStakedTokens || 0,
      flexibleStakedTokens: item.flexibleStakedTokens || 0,
      latestStakeAt: item.latestStakeAt || null,
      stakeStatuses: item.statuses || [],
      actions: {
        viewDetails: true,
      },
    }));

    const total = countRows?.[0]?.total || 0;
    return res.json({
      data,
      pagination: {
        total,
        page,
        limit,
        hasMore: skip + data.length < total,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getAdminStakingUserDetail = async (req, res) => {
  try {
    await syncStakingStatuses();

    if (!ensureObjectId(req.params.userId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const user = await User.findById(req.params.userId).select(
      'name email mobile referralCode isActive createdAt lastLoginAt role bankDetails',
    );
    if (!user || user.role !== 'user') {
      return res.status(404).json({ message: 'User not found' });
    }

    const [holding, stakes] = await Promise.all([
      IcoHolding.findOne({ user: user._id }).select('balance'),
      StakingPosition.find({ user: user._id }).sort({ createdAt: -1 }),
    ]);

    const summary = stakes.reduce(
      (acc, stake) => {
        const rewardPaid = getStakeRewardPaid(stake);
        acc.totalStakes += 1;
        acc.totalStakedTokens += stake.tokenAmount || 0;
        acc.totalRewardTokens += stake.interestAmount || 0;
        acc.totalExpectedReturn += stake.expectedReturn || 0;
        acc.totalRewardPaid += rewardPaid;
        if (ACTIVE_STAKING_STATUSES.includes(stake.status)) acc.activeStakes += 1;
        if (['closed', 'paid', 'claimed', 'cancelled'].includes(stake.status)) acc.closedStakes += 1;
        if (stake.stackType === 'fixed') acc.fixedPlans += 1;
        if (stake.stackType === 'fluid') acc.flexiblePlans += 1;
        acc.statuses.add(stake.status);
        acc.durations.add(stake.durationMonths);
        return acc;
      },
      {
        totalStakes: 0,
        activeStakes: 0,
        closedStakes: 0,
        totalStakedTokens: 0,
        totalRewardTokens: 0,
        totalRewardPaid: 0,
        totalExpectedReturn: 0,
        fixedPlans: 0,
        flexiblePlans: 0,
        statuses: new Set(),
        durations: new Set(),
      },
    );

    const positions = stakes.map((stake) => ({
      stakeId: stake._id,
      tokenAmount: stake.tokenAmount,
      stakingType: normalizeAdminStakeType(stake.stackType),
      durationMonths: stake.durationMonths,
      interestRate: stake.interestRate,
      monthlyInterestAmount: stake.monthlyInterestAmount,
      interestAmount: stake.interestAmount,
      expectedReturn: stake.expectedReturn,
      rewardPaid: getStakeRewardPaid(stake),
      rewardPending: Math.max((stake.interestAmount || 0) - getStakeRewardPaid(stake), 0),
      status: stake.status,
      startedAt: stake.startedAt,
      maturesAt: stake.maturesAt,
      claimedAt: stake.claimedAt || null,
      createdAt: stake.createdAt,
      updatedAt: stake.updatedAt,
      withdrawal: stake.withdrawal || null,
      vestingSchedule: (stake.interestHistory || []).map((entry, index) => ({
        paymentNo: index + 1,
        label: entry.label || `Month ${index + 1}`,
        amount: entry.amount || 0,
        status: entry.status,
        dueAt: entry.creditedAt || null,
      })),
      timeline: getStakeTimeline(stake),
      metadata: stake.metadata || {},
    }));

    return res.json({
      user: {
        userId: user._id,
        fullName: user.name,
        email: user.email || null,
        mobile: user.mobile || null,
        referralCode: user.referralCode || null,
        accountStatus: user.isActive ? 'active' : 'suspended',
        joinedAt: user.createdAt,
        lastLoginAt: user.lastLoginAt || null,
        tokenWalletBalance: holding?.balance || 0,
        bankDetails: {
          accountHolderName: user.bankDetails?.accountHolderName || null,
          accountNumber: user.bankDetails?.accountNumber || null,
          ifsc: user.bankDetails?.ifsc || null,
          bankName: user.bankDetails?.bankName || null,
        },
      },
      summary: {
        totalStakes: summary.totalStakes,
        activeStakes: summary.activeStakes,
        closedStakes: summary.closedStakes,
        fixedPlans: summary.fixedPlans,
        flexiblePlans: summary.flexiblePlans,
        totalStakedTokens: summary.totalStakedTokens,
        totalRewardTokens: summary.totalRewardTokens,
        totalRewardPaid: summary.totalRewardPaid,
        totalRewardPending: Math.max(summary.totalRewardTokens - summary.totalRewardPaid, 0),
        totalExpectedReturn: summary.totalExpectedReturn,
        availableDurationsMonths: Array.from(summary.durations).sort((a, b) => a - b),
        statuses: Array.from(summary.statuses),
      },
      positions,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const listStakingClosures = async (req, res) => {
  try {
    await syncStakingStatuses();

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) filter.status = String(req.query.status).trim().toLowerCase();
    if (req.query.stakingType) {
      const mappedType = req.query.stakingType === 'flexible' ? 'fluid' : req.query.stakingType;
      filter.stackType = String(mappedType).trim().toLowerCase();
    }
    if (req.query.userId && ensureObjectId(req.query.userId)) {
      filter.user = req.query.userId;
    }

    const [rows, total] = await Promise.all([
      StakingPosition.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email mobile'),
      StakingPosition.countDocuments(filter),
    ]);

    const data = rows.map((item) => ({
      id: item._id,
      user: item.user,
      stakingType: item.stackType === 'fluid' ? 'flexible' : item.stackType,
      amount: item.tokenAmount,
      startDate: item.startedAt,
      endDate: item.maturesAt,
      expectedReward: item.interestAmount,
      status: item.status,
      readyForClosure: ['matured', 'withdrawal_available'].includes(item.status),
    }));

    return res.json({
      data,
      pagination: {
        total,
        page,
        limit,
        hasMore: skip + data.length < total,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const closeStakingPosition = async (req, res) => {
  try {
    if (!ensureObjectId(req.params.stakeId)) {
      return res.status(400).json({ message: 'Invalid stake id' });
    }

    const stake = await StakingPosition.findById(req.params.stakeId);
    if (!stake) return res.status(404).json({ message: 'Stake not found' });

    if (!['matured', 'withdrawal_available', 'active', 'withdrawal_requested'].includes(stake.status)) {
      return res.status(400).json({ message: 'Stake cannot be closed from current status' });
    }

    const before = { status: stake.status };
    stake.status = 'closed';
    stake.metadata = {
      ...(stake.metadata || {}),
      closedAt: new Date(),
      closedBy: req.user._id,
    };
    await stake.save();

    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'close_staking_position',
      entityType: 'staking_position',
      entityId: stake._id,
      before,
      after: { status: stake.status, metadata: stake.metadata },
    });

    return res.json({ message: 'Stake closed', stake });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const triggerStakingPayout = async (req, res) => {
  try {
    if (!ensureObjectId(req.params.stakeId)) {
      return res.status(400).json({ message: 'Invalid stake id' });
    }

    const stake = await StakingPosition.findById(req.params.stakeId);
    if (!stake) return res.status(404).json({ message: 'Stake not found' });
    if (!['closed', 'matured', 'withdrawal_available'].includes(stake.status)) {
      return res.status(400).json({ message: 'Stake must be closed or matured before payout' });
    }

    const before = { status: stake.status, claimedAt: stake.claimedAt };

    const holding = await IcoHolding.findOneAndUpdate(
      { user: stake.user },
      { $inc: { balance: stake.expectedReturn } },
      { new: true, upsert: true },
    );

    stake.status = 'paid';
    stake.claimedAt = new Date();
    stake.metadata = {
      ...(stake.metadata || {}),
      payoutTriggeredBy: req.user._id,
      payoutTriggeredAt: new Date(),
    };

    stake.interestHistory = (stake.interestHistory || []).map((entry) => ({
      ...entry,
      status: 'withdrawn',
      creditedAt: entry.creditedAt || new Date(),
    }));

    await stake.save();

    await createUserNotification({
      userId: stake.user,
      title: 'Staking payout completed',
      message: `Your staking payout of ${stake.expectedReturn} ${getTokenSymbol()} has been processed.`,
      type: 'transaction',
      metadata: { stakeId: stake._id },
    });

    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'staking_payout',
      entityType: 'staking_position',
      entityId: stake._id,
      before,
      after: { status: stake.status, claimedAt: stake.claimedAt },
      metadata: { expectedReturn: stake.expectedReturn, balanceAfter: holding.balance },
    });

    return res.json({ message: 'Payout completed', stake, holding });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const listVestingSchedule = async (req, res) => {
  try {
    await syncStakingStatuses();

    const now = new Date();
    const dayAhead = new Date(now);
    dayAhead.setDate(dayAhead.getDate() + 1);

    const filter = {};
    if (req.query.userId && ensureObjectId(req.query.userId)) {
      filter.user = req.query.userId;
    }

    const stakes = await StakingPosition.find(filter)
      .sort({ createdAt: -1 })
      .populate('user', 'name email mobile');

    const rows = [];
    stakes.forEach((stake) => {
      (stake.interestHistory || []).forEach((entry, index) => {
        const dueDate = entry.creditedAt;
        const paid = entry.status === 'withdrawn';
        const overdue = !paid && dueDate && dueDate < now;
        const dueTomorrow = !paid && dueDate && dueDate >= now && dueDate <= dayAhead;

        if (req.query.status) {
          const statusFilter = String(req.query.status).trim().toLowerCase();
          const current = paid ? 'paid' : overdue ? 'overdue' : 'pending';
          if (statusFilter !== current) return;
        }

        rows.push({
          id: `${stake._id}_${index + 1}`,
          stakeId: stake._id,
          paymentNo: index + 1,
          user: stake.user,
          totalStakedAmount: stake.tokenAmount,
          durationMonths: stake.durationMonths,
          monthlyReward: entry.amount,
          nextPaymentDate: dueDate,
          remainingPayments: Math.max(stake.durationMonths - (index + 1), 0),
          status: paid ? 'paid' : overdue ? 'overdue' : 'pending',
          dueTomorrow,
        });
      });
    });

    rows.sort((a, b) => new Date(a.nextPaymentDate || 0) - new Date(b.nextPaymentDate || 0));

    return res.json({
      data: rows,
      reminders: rows.filter((item) => item.dueTomorrow || item.status === 'overdue'),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const markVestingPaymentPaid = async (req, res) => {
  try {
    const { stakeId, paymentNo } = req.params;
    if (!ensureObjectId(stakeId)) {
      return res.status(400).json({ message: 'Invalid stake id' });
    }

    const monthNumber = Number(paymentNo);
    if (Number.isNaN(monthNumber) || monthNumber < 1) {
      return res.status(400).json({ message: 'paymentNo must be a positive integer' });
    }

    const stake = await StakingPosition.findById(stakeId);
    if (!stake) return res.status(404).json({ message: 'Stake not found' });

    const index = monthNumber - 1;
    if (!stake.interestHistory || !stake.interestHistory[index]) {
      return res.status(404).json({ message: 'Payment schedule entry not found' });
    }

    const before = { ...stake.interestHistory[index].toObject?.() };
    stake.interestHistory[index].status = 'withdrawn';
    if (!stake.interestHistory[index].creditedAt) {
      stake.interestHistory[index].creditedAt = new Date();
    }

    stake.metadata = {
      ...(stake.metadata || {}),
      vestingPaymentUpdates: [
        ...(stake.metadata?.vestingPaymentUpdates || []),
        {
          paymentNo: monthNumber,
          markedPaidAt: new Date(),
          markedPaidBy: req.user._id,
        },
      ],
    };

    await stake.save();

    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'mark_vesting_payment_paid',
      entityType: 'staking_position',
      entityId: stake._id,
      before,
      after: stake.interestHistory[index],
      metadata: { paymentNo: monthNumber },
    });

    return res.json({ message: 'Vesting payment marked as paid', stakeId: stake._id, paymentNo: monthNumber });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const listStakingAccountsUnified = async (req, res) => {
  try {
    await syncStakingStatuses();

    const filter = {};
    if (req.query.status) filter.status = String(req.query.status).trim().toLowerCase();
    if (req.query.type) {
      const type = req.query.type === 'flexible' ? 'fluid' : req.query.type;
      filter.stackType = String(type).trim().toLowerCase();
    }

    const rows = await StakingPosition.find(filter)
      .sort({ createdAt: -1 })
      .populate('user', 'name email mobile');

    const data = rows.map((stake) => ({
      id: stake._id,
      user: stake.user,
      stakingType: stake.stackType === 'fluid' ? 'flexible' : stake.stackType,
      status: stake.status,
      totalStaked: stake.tokenAmount,
      rewardsGenerated: stake.interestAmount,
      vestingSchedule: stake.interestHistory || [],
      paymentHistory: (stake.interestHistory || []).filter((entry) => entry.status === 'withdrawn'),
      startDate: stake.startedAt,
      endDate: stake.maturesAt,
    }));

    return res.json({ data });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const listPreIcoStages = async (_req, res) => {
  try {
    const stages = await PreIcoStage.find().sort({ startDate: 1 });
    return res.json({ data: stages });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const createPreIcoStage = async (req, res) => {
  try {
    const payload = req.body || {};
    const stage = await PreIcoStage.create({
      stageName: payload.stageName,
      tokenPrice: Number(payload.tokenPrice),
      bonusPercent: Number(payload.bonusPercent || 0),
      startDate: payload.startDate,
      endDate: payload.endDate,
      allocationLimit: Number(payload.allocationLimit || 0),
      isActive: Boolean(payload.isActive),
      autoSwitch: payload.autoSwitch !== undefined ? Boolean(payload.autoSwitch) : true,
    });

    if (stage.isActive) {
      await PreIcoStage.updateMany({ _id: { $ne: stage._id } }, { $set: { isActive: false } });
    }

    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'create_pre_ico_stage',
      entityType: 'pre_ico_stage',
      entityId: stage._id,
      after: stage,
    });

    return res.status(201).json({ stage });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updatePreIcoStage = async (req, res) => {
  try {
    if (!ensureObjectId(req.params.stageId)) {
      return res.status(400).json({ message: 'Invalid stage id' });
    }

    const stage = await PreIcoStage.findById(req.params.stageId);
    if (!stage) return res.status(404).json({ message: 'Stage not found' });

    const before = stage.toObject();
    const payload = req.body || {};

    if (payload.stageName !== undefined) stage.stageName = String(payload.stageName || '').trim();
    if (payload.tokenPrice !== undefined) stage.tokenPrice = Number(payload.tokenPrice);
    if (payload.bonusPercent !== undefined) stage.bonusPercent = Number(payload.bonusPercent);
    if (payload.startDate !== undefined) {
      const start = toDate(payload.startDate);
      if (!start) return res.status(400).json({ message: 'Invalid startDate' });
      stage.startDate = start;
    }
    if (payload.endDate !== undefined) {
      const end = toDate(payload.endDate);
      if (!end) return res.status(400).json({ message: 'Invalid endDate' });
      stage.endDate = end;
    }
    if (payload.allocationLimit !== undefined) stage.allocationLimit = Number(payload.allocationLimit);
    if (payload.autoSwitch !== undefined) stage.autoSwitch = Boolean(payload.autoSwitch);

    if (payload.isActive !== undefined) {
      stage.isActive = Boolean(payload.isActive);
      if (stage.isActive) {
        await PreIcoStage.updateMany({ _id: { $ne: stage._id } }, { $set: { isActive: false } });
      }
    }

    await stage.save();

    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'update_pre_ico_stage',
      entityType: 'pre_ico_stage',
      entityId: stage._id,
      before,
      after: stage,
    });

    return res.json({ stage });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const togglePreIcoStageActivation = async (req, res) => {
  try {
    if (!ensureObjectId(req.params.stageId)) {
      return res.status(400).json({ message: 'Invalid stage id' });
    }

    const stage = await PreIcoStage.findById(req.params.stageId);
    if (!stage) return res.status(404).json({ message: 'Stage not found' });

    const shouldActivate = req.body?.active === undefined ? !stage.isActive : Boolean(req.body.active);
    const before = { isActive: stage.isActive };

    stage.isActive = shouldActivate;
    await stage.save();

    if (shouldActivate) {
      await PreIcoStage.updateMany({ _id: { $ne: stage._id } }, { $set: { isActive: false } });
    }

    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'toggle_pre_ico_stage_activation',
      entityType: 'pre_ico_stage',
      entityId: stage._id,
      before,
      after: { isActive: stage.isActive },
    });

    return res.json({ stage });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getPreIcoStageMetrics = async (_req, res) => {
  try {
    const stages = await PreIcoStage.find().sort({ startDate: 1 });

    const withMetrics = await Promise.all(
      stages.map(async (stage) => {
        const [usersParticipated, txAgg] = await Promise.all([
          IcoTransaction.distinct('user', {
            type: 'buy',
            status: 'completed',
            createdAt: { $gte: stage.startDate, $lte: stage.endDate },
          }),
          IcoTransaction.aggregate([
            {
              $match: {
                type: 'buy',
                status: 'completed',
                createdAt: { $gte: stage.startDate, $lte: stage.endDate },
              },
            },
            {
              $group: {
                _id: null,
                tokensSold: { $sum: '$tokenAmount' },
                fundsRaised: { $sum: '$fiatAmount' },
              },
            },
          ]),
        ]);

        return {
          ...stage.toObject(),
          metrics: {
            totalUsersParticipated: usersParticipated.length,
            totalTokensSold: txAgg?.[0]?.tokensSold || 0,
            revenue: txAgg?.[0]?.fundsRaised || 0,
          },
        };
      }),
    );

    return res.json({ data: withMetrics });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const listCommissionIssues = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status).trim().toLowerCase();
    if (req.query.userId && ensureObjectId(req.query.userId)) filter.user = req.query.userId;

    const rows = await CommissionIssue.find(filter)
      .sort({ createdAt: -1 })
      .populate('user', 'name email mobile')
      .populate('notes.by', 'name email')
      .populate('resolution.resolvedBy', 'name email');

    return res.json({ data: rows });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const createCommissionIssue = async (req, res) => {
  try {
    const { userId, description, relatedTransaction } = req.body || {};
    if (!ensureObjectId(userId)) {
      return res.status(400).json({ message: 'Valid userId is required' });
    }
    if (!description || !String(description).trim()) {
      return res.status(400).json({ message: 'description is required' });
    }

    const issue = await CommissionIssue.create({
      user: userId,
      description: String(description).trim(),
      relatedTransaction: relatedTransaction ? String(relatedTransaction).trim() : undefined,
      status: 'open',
    });

    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'create_commission_issue',
      entityType: 'commission_issue',
      entityId: issue._id,
      after: issue,
    });

    return res.status(201).json({ issue });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updateCommissionIssue = async (req, res) => {
  try {
    if (!ensureObjectId(req.params.issueId)) {
      return res.status(400).json({ message: 'Invalid issue id' });
    }

    const issue = await CommissionIssue.findById(req.params.issueId);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });

    const before = issue.toObject();
    const { status, note } = req.body || {};

    if (status !== undefined) {
      const normalized = String(status).trim().toLowerCase();
      if (!['open', 'in_progress', 'resolved'].includes(normalized)) {
        return res.status(400).json({ message: 'Invalid status' });
      }
      issue.status = normalized;
      if (normalized === 'resolved') {
        issue.resolution = {
          resolvedBy: req.user._id,
          resolvedAt: new Date(),
          note: note ? String(note).trim() : issue.resolution?.note,
        };
      }
    }

    if (note && String(note).trim()) {
      issue.notes.push({ note: String(note).trim(), by: req.user._id, at: new Date() });
    }

    await issue.save();

    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'update_commission_issue',
      entityType: 'commission_issue',
      entityId: issue._id,
      before,
      after: issue,
    });

    return res.json({ issue });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const adjustCommissionIssueAmount = async (req, res) => {
  try {
    if (!ensureObjectId(req.params.issueId)) {
      return res.status(400).json({ message: 'Invalid issue id' });
    }

    const { amount, note } = req.body || {};
    const numericAmount = Number(amount);
    if (Number.isNaN(numericAmount) || numericAmount === 0) {
      return res.status(400).json({ message: 'amount must be a non-zero number' });
    }
    if (!note || !String(note).trim()) {
      return res.status(400).json({ message: 'note is required for manual adjustment' });
    }

    const issue = await CommissionIssue.findById(req.params.issueId);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });

    const user = await User.findById(issue.user);
    if (!user) return res.status(404).json({ message: 'Issue user not found' });

    const before = {
      referralWalletBalance: user.referralWalletBalance,
      referralTotalEarned: user.referralTotalEarned,
    };

    user.referralWalletBalance = Math.max(0, (user.referralWalletBalance || 0) + numericAmount);
    if (numericAmount > 0) {
      user.referralTotalEarned = (user.referralTotalEarned || 0) + numericAmount;
    }
    await user.save();

    issue.notes.push({
      note: `Commission adjusted by ${numericAmount}. ${String(note).trim()}`,
      by: req.user._id,
      at: new Date(),
    });
    issue.status = 'in_progress';
    await issue.save();

    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'adjust_commission_manual_override',
      entityType: 'commission_issue',
      entityId: issue._id,
      before,
      after: {
        referralWalletBalance: user.referralWalletBalance,
        referralTotalEarned: user.referralTotalEarned,
      },
      metadata: { amount: numericAmount, note: String(note).trim() },
    });

    return res.json({
      issue,
      user: {
        _id: user._id,
        referralWalletBalance: user.referralWalletBalance,
        referralTotalEarned: user.referralTotalEarned,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const listFiatTransactions = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const typeFilter = String(req.query.type || '').trim().toLowerCase();
    const filter = {
      category: { $in: ['topup', 'withdrawal', 'refund'] },
    };
    if (req.query.status) filter.status = String(req.query.status).trim().toLowerCase();
    if (req.query.userId && ensureObjectId(req.query.userId)) filter.user = req.query.userId;
    if (typeFilter === 'deposits') filter.category = 'topup';
    if (typeFilter === 'withdrawals') filter.category = 'withdrawal';
    if (typeFilter === 'refunds') filter.category = 'refund';

    const [rows, total] = await Promise.all([
      WalletTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email mobile'),
      WalletTransaction.countDocuments(filter),
    ]);

    const data = rows.map((tx) => ({
      transactionId: tx._id,
      user: tx.user,
      amount: tx.amount,
      paymentGateway: tx.paymentGateway,
      status: tx.status,
      type: tx.category,
      date: tx.createdAt,
    }));

    return res.json({
      data,
      pagination: {
        total,
        page,
        limit,
        hasMore: skip + data.length < total,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const verifyFiatTransaction = async (req, res) => {
  try {
    if (!ensureObjectId(req.params.transactionId)) {
      return res.status(400).json({ message: 'Invalid transaction id' });
    }

    const { status, note } = req.body || {};
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (!['processed', 'completed', 'failed', 'cancelled'].includes(normalizedStatus)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const tx = await WalletTransaction.findById(req.params.transactionId);
    if (!tx) return res.status(404).json({ message: 'Transaction not found' });

    const before = { status: tx.status, adminNote: tx.adminNote };
    tx.status = normalizedStatus;
    tx.adminNote = note ? String(note).trim() : tx.adminNote;
    appendStatusHistory(tx, normalizedStatus, req.user._id, note);
    await tx.save();

    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: 'verify_fiat_transaction',
      entityType: 'wallet_transaction',
      entityId: tx._id,
      before,
      after: { status: tx.status, adminNote: tx.adminNote },
    });

    return res.json({ transaction: tx });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const listTokenPurchases = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { type: 'buy' };
    if (req.query.status) filter.status = String(req.query.status).trim().toLowerCase();
    if (req.query.userId && ensureObjectId(req.query.userId)) filter.user = req.query.userId;

    const [rows, total] = await Promise.all([
      IcoTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email mobile'),
      IcoTransaction.countDocuments(filter),
    ]);

    const data = rows.map((tx) => ({
      transactionId: tx._id,
      user: tx.user,
      tokensPurchased: tx.tokenAmount,
      pricePerToken: tx.pricePerToken,
      totalAmountPaid: tx.fiatAmount,
      bonusTokens: Number((tx.tokenAmount * ADMIN_BONUS_PERCENT) / 100),
      paymentSource: tx.paymentReference || tx.metadata?.paymentSource || 'wallet_or_fiat',
      status: tx.status,
      date: tx.createdAt,
    }));

    return res.json({
      data,
      pagination: {
        total,
        page,
        limit,
        hasMore: skip + data.length < total,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getWalletManagementView = async (req, res) => {
  try {
    if (!ensureObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const [user, wallet, holding, transactions, adjustments] = await Promise.all([
      User.findById(req.params.id).select('name email mobile role referralWalletBalance referralTotalEarned'),
      WalletAccount.findOne({ user: req.params.id }),
      IcoHolding.findOne({ user: req.params.id }),
      WalletTransaction.find({ user: req.params.id }).sort({ createdAt: -1 }).limit(100),
      TokenAdjustment.find({ user: req.params.id }).sort({ createdAt: -1 }).limit(100),
    ]);

    if (!user || user.role !== 'user') {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({
      user,
      walletView: {
        availableBalance: wallet?.balance || 0,
        lockedBalance: wallet?.pendingWithdrawals || 0,
        totalTokens: holding?.balance || 0,
        referralBalance: user.referralWalletBalance || 0,
      },
      tokenAdjustments: adjustments,
      transactionHistory: transactions,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const listAdminAuditLogs = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.entityType) filter.entityType = String(req.query.entityType).trim();
    if (req.query.entityId) filter.entityId = String(req.query.entityId).trim();
    if (req.query.actorId && ensureObjectId(req.query.actorId)) filter.actor = req.query.actorId;

    const [rows, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('actor', 'name email role'),
      AuditLog.countDocuments(filter),
    ]);

    return res.json({
      data: rows,
      pagination: {
        total,
        page,
        limit,
        hasMore: skip + rows.length < total,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getAdminReminderSummary = async (_req, res) => {
  try {
    await syncStakingStatuses();

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [pendingWithdrawals, maturedStakes, vestingDueSoon] = await Promise.all([
      WalletTransaction.countDocuments({ category: 'withdrawal', status: { $in: ['pending', 'processed'] } }),
      StakingPosition.countDocuments({ status: { $in: ['matured', 'withdrawal_available', 'closed'] } }),
      StakingPosition.aggregate([
        { $unwind: { path: '$interestHistory', preserveNullAndEmptyArrays: false } },
        {
          $match: {
            'interestHistory.status': { $ne: 'withdrawn' },
            'interestHistory.creditedAt': { $gte: now, $lte: tomorrow },
          },
        },
        { $count: 'count' },
      ]),
    ]);

    return res.json({
      withdrawalRequestAlerts: pendingWithdrawals,
      stakingMaturityAlerts: maturedStakes,
      vestingPaymentReminders: vestingDueSoon?.[0]?.count || 0,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
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
  listAdminStakingUsers,
  getAdminStakingUserDetail,
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
};
