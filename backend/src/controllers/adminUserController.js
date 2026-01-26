const mongoose = require('mongoose');
const User = require('../models/User');
const KycApplication = require('../models/KycApplication');
const IcoHolding = require('../models/IcoHolding');
const IcoTransaction = require('../models/IcoTransaction');
const WalletAccount = require('../models/WalletAccount');
const WalletTransaction = require('../models/WalletTransaction');
const ReferralEarning = require('../models/ReferralEarning');
const BankChangeRequest = require('../models/BankChangeRequest');
const MobileChangeRequest = require('../models/MobileChangeRequest');
const bcrypt = require('bcryptjs');
const { buildReferralTree } = require('../utils/referralTree');
const { createUserNotification } = require('../utils/notificationService');
const { getTokenPrice, setTokenPrice, getTokenSymbol } = require('../utils/tokenPrice');

const pruneReferralTree = (node, maxDepth) => {
  if (!node || !node.children) return;
  node.children = node.children.filter((child) => child.depth <= maxDepth);
  node.children.forEach((child) => pruneReferralTree(child, maxDepth));
};

const buildKycStatusMap = async (userIds, statusFilter) => {
  if (!userIds.length) return new Map();
  const query = { user: { $in: userIds } };
  if (statusFilter) {
    query.status = statusFilter;
  }
  const kycs = await KycApplication.find(query).select('user status');
  return new Map(kycs.map((k) => [k.user.toString(), k.status]));
};

const attachKycStatus = (users, kycMap, statusFilter) => {
  const mapped = users.map((user) => {
    const doc = user.toObject ? user.toObject() : { ...user };
    return {
      ...doc,
      kycStatus: kycMap.get(user._id.toString()) || 'not_submitted',
    };
  });
  if (!statusFilter) return mapped;
  return mapped.filter((user) => user.kycStatus === statusFilter);
};

const buildReferralTreePayload = async (userId, maxDepth) => {
  const users = await User.find({
    $or: [{ _id: userId }, { referralPath: userId }],
  })
    .select('name email mobile referralCode referredBy referralPath referralLevel createdAt')
    .lean();

  const tree = buildReferralTree(users, userId);
  pruneReferralTree(tree, maxDepth);
  return tree || null;
};

// Admin: paginated user list with KYC badge
const listUsers = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const search = (req.query.search || '').trim();
    const role = (req.query.role || '').trim();
    const kycStatus = (req.query.kycStatus || '').trim();

    const filter = {};
    if (role) filter.role = role;
    if (search) {
      const regex = new RegExp(search, 'i');
      filter.$or = [
        { name: regex },
        { email: regex },
        { mobile: regex },
        { referralCode: regex },
      ];
    }

    // Fetch user list
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('name email mobile role referralCode referralLevel referralTotalEarned referralWalletBalance isEmailVerified isMobileVerified isActive disabledAt createdAt'),
      User.countDocuments(filter),
    ]);

    const userIds = users.map((u) => u._id);
    const kycMap = await buildKycStatusMap(userIds, kycStatus);
    const data = attachKycStatus(users, kycMap, kycStatus);
    const totalForResponse = kycStatus ? data.length : total;
    res.json({
      data,
      pagination: {
        total: totalForResponse,
        page,
        limit,
        hasMore: !kycStatus && skip + data.length < total,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const countUsers = async (_req, res) => {
  try {
    const total = await User.countDocuments();
    res.json({ total });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getLatestSignups = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 100);
    const users = await User.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('-password -pin')
      .lean();

    const userIds = users.map((u) => u._id);
    const kycMap = await buildKycStatusMap(userIds);
    const data = attachKycStatus(users, kycMap);

    res.json({ data });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const listUsersWithDetails = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 1000);
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-password -pin')
        .lean(),
      User.countDocuments(),
    ]);

    const userIds = users.map((u) => u._id);
    const kycMap = await buildKycStatusMap(userIds);
    const data = attachKycStatus(users, kycMap);

    res.json({
      data,
      pagination: {
        total,
        page,
        limit,
        hasMore: skip + users.length < total,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Admin: single user detail with KYC + balances
const getUserDetail = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const user = await User.findById(req.params.id).select('-password -pin');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const [kyc, wallet, holding] = await Promise.all([
      KycApplication.findOne({ user: user._id }),
      WalletAccount.findOne({ user: user._id }),
      IcoHolding.findOne({ user: user._id }),
    ]);

    const price = getTokenPrice();
    const tokenSymbol = getTokenSymbol();
    res.json({
      user,
      kyc: kyc || { status: 'not_submitted' },
      wallet: wallet
        ? {
            balance: wallet.balance,
            totalCredited: wallet.totalCredited,
            totalDebited: wallet.totalDebited,
            currency: wallet.currency,
          }
        : { balance: 0, totalCredited: 0, totalDebited: 0, currency: 'INR' },
      holdings: holding
        ? {
            balance: holding.balance,
            valuation: holding.balance * price,
            tokenSymbol,
          }
        : { balance: 0, valuation: 0, tokenSymbol },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateUserStatus = async (req, res) => {
  try {
    const { isActive, reason } = req.body || {};
    if (isActive === undefined) {
      return res.status(400).json({ message: 'isActive is required' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.isActive = Boolean(isActive);
    if (user.isActive) {
      user.activatedAt = new Date();
      user.disabledAt = undefined;
      user.disabledReason = undefined;
    } else {
      user.disabledAt = new Date();
      user.disabledReason = reason || 'Disabled by admin';
    }

    await user.save();

    await createUserNotification({
      userId: user._id,
      title: user.isActive ? 'Account activated' : 'Account disabled',
      message: user.isActive
        ? 'Your account has been activated by admin.'
        : `Your account has been disabled. ${user.disabledReason || ''}`.trim(),
      type: 'admin',
      metadata: { isActive: user.isActive },
    });
    res.json({
      id: user._id,
      isActive: user.isActive,
      disabledAt: user.disabledAt,
      disabledReason: user.disabledReason,
      activatedAt: user.activatedAt,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateUserEmail = async (req, res) => {
  try {
    const { email, isVerified } = req.body || {};
    if (!email) {
      return res.status(400).json({ message: 'email is required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await User.findOne({
      email: normalizedEmail,
      _id: { $ne: req.params.id },
    });
    if (existing) {
      return res.status(400).json({ message: 'Email already in use' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.email = normalizedEmail;
    if (isVerified !== undefined) {
      user.isEmailVerified = Boolean(isVerified);
    }
    await user.save();

    res.json({
      id: user._id,
      email: user.email,
      isEmailVerified: user.isEmailVerified,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateUserPin = async (req, res) => {
  try {
    const { pin } = req.body || {};
    if (!pin) {
      return res.status(400).json({ message: 'pin is required' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const salt = await bcrypt.genSalt(10);
    user.pin = await bcrypt.hash(String(pin), salt);
    await user.save();

    res.json({ id: user._id, message: 'PIN updated' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Admin: KYC queue list
const listKycApplications = async (req, res) => {
  try {
    const status = (req.query.status || '').trim();
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const filter = {};
    if (status) filter.status = status;

    const skip = (page - 1) * limit;
    const [kycs, total] = await Promise.all([
      KycApplication.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email mobile referralCode role'),
      KycApplication.countDocuments(filter),
    ]);

    res.json({
      data: kycs,
      pagination: {
        total,
        page,
        limit,
        hasMore: skip + kycs.length < total,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Admin: global stats snapshot
const getAdminStats = async (_req, res) => {
  try {
    const tokenSymbol = getTokenSymbol();
    const price = getTokenPrice();

    const [totalUsers, kycVerified, kycPending, holdingsAgg, icoAgg, walletAgg, walletTxAgg] =
      await Promise.all([
        User.countDocuments(),
        KycApplication.countDocuments({ status: 'verified' }),
        KycApplication.countDocuments({ status: 'pending' }),
        IcoHolding.aggregate([{ $group: { _id: null, balance: { $sum: '$balance' } } }]),
        IcoTransaction.aggregate([
          { $match: { type: 'buy', status: 'completed' } },
          { $group: { _id: null, fiatAmount: { $sum: '$fiatAmount' } } },
        ]),
        WalletAccount.aggregate([{ $group: { _id: null, balance: { $sum: '$balance' } } }]),
        WalletTransaction.aggregate([
          { $group: { _id: '$type', amount: { $sum: '$amount' } } },
        ]),
      ]);

    const tokenCirculation = holdingsAgg[0]?.balance || 0;
    const icoVolumeInr = icoAgg[0]?.fiatAmount || 0;
    const walletBalance = walletAgg[0]?.balance || 0;
    const walletVolumes = walletTxAgg.reduce(
      (acc, curr) => {
        acc[curr._id] = curr.amount;
        return acc;
      },
      {},
    );

    res.json({
      users: {
        total: totalUsers,
        kycVerified,
        kycPending,
      },
      ico: {
        tokenSymbol,
        priceInr: price,
        circulation: tokenCirculation,
        circulationValueInr: tokenCirculation * price,
        buyVolumeInr: icoVolumeInr,
      },
      wallet: {
        totalBalanceInr: walletBalance,
        volume: walletVolumes,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getTokenPriceAdmin = (_req, res) => {
  try {
    res.json({
      tokenSymbol: getTokenSymbol(),
      price: getTokenPrice(),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const setTokenPriceAdmin = async (req, res) => {
  try {
    const { price } = req.body || {};
    if (price === undefined || price === null) {
      return res.status(400).json({ message: 'price is required' });
    }
    const numericPrice = Number(price);
    if (Number.isNaN(numericPrice) || numericPrice <= 0) {
      return res.status(400).json({ message: 'price must be a positive number' });
    }
    const updatedPrice = await setTokenPrice(numericPrice);
    res.json({
      tokenSymbol: getTokenSymbol(),
      price: updatedPrice,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Admin: global ICO transactions list
const listIcoTransactions = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.userId && mongoose.Types.ObjectId.isValid(req.query.userId)) {
      filter.user = req.query.userId;
    }
    if (req.query.type) {
      filter.type = req.query.type;
    }
    if (req.query.status) {
      filter.status = req.query.status;
    }
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) {
        filter.createdAt.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        filter.createdAt.$lte = new Date(req.query.endDate);
      }
    }

    const [transactions, total] = await Promise.all([
      IcoTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email mobile'),
      IcoTransaction.countDocuments(filter),
    ]);

    res.json({
      data: transactions,
      pagination: {
        total,
        page,
        limit,
        hasMore: skip + transactions.length < total,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const listRecentTransactions = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const [walletTxs, icoTxs] = await Promise.all([
      WalletTransaction.find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('user', 'name email mobile referralCode'),
      IcoTransaction.find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('user', 'name email mobile referralCode'),
    ]);

    const combined = [
      ...walletTxs.map((tx) => ({
        id: tx._id,
        kind: 'wallet',
        user: tx.user,
        type: tx.type,
        category: tx.category,
        amount: tx.amount,
        currency: tx.currency,
        status: tx.status,
        description: tx.description,
        metadata: tx.metadata,
        createdAt: tx.createdAt,
      })),
      ...icoTxs.map((tx) => ({
        id: tx._id,
        kind: 'ico',
        user: tx.user,
        type: tx.type,
        status: tx.status,
        tokenAmount: tx.tokenAmount,
        fiatAmount: tx.fiatAmount,
        pricePerToken: tx.pricePerToken,
        metadata: tx.metadata,
        createdAt: tx.createdAt,
      })),
    ]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);

    res.json({ data: combined });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Admin: referral earnings list
const listReferralEarningsAdmin = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.earner && mongoose.Types.ObjectId.isValid(req.query.earner)) {
      filter.earner = req.query.earner;
    }
    if (req.query.sourceUser && mongoose.Types.ObjectId.isValid(req.query.sourceUser)) {
      filter.sourceUser = req.query.sourceUser;
    }
    if (req.query.status) {
      filter.status = req.query.status;
    }
    if (req.query.sourceType) {
      filter.sourceType = req.query.sourceType;
    }
    if (req.query.depth !== undefined) {
      const depth = Number(req.query.depth);
      if (!Number.isNaN(depth)) {
        filter.depth = depth;
      }
    }

    const [earnings, total] = await Promise.all([
      ReferralEarning.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('earner', 'name email mobile referralCode')
        .populate('sourceUser', 'name email mobile referralCode'),
      ReferralEarning.countDocuments(filter),
    ]);

    res.json({
      data: earnings,
      pagination: {
        total,
        page,
        limit,
        hasMore: skip + earnings.length < total,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateReferralEarningStatus = async (req, res) => {
  try {
    const { status, adminNote } = req.body || {};
    if (!['pending', 'released', 'reversed'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const earning = await ReferralEarning.findById(req.params.id);
    if (!earning) {
      return res.status(404).json({ message: 'Referral earning not found' });
    }

    earning.status = status;
    earning.reviewer = req.user._id;
    earning.reviewedAt = new Date();
    if (adminNote !== undefined) {
      earning.adminNote = adminNote;
    }
    await earning.save();

    res.json(earning);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const listBankChangeRequests = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    }
    if (req.query.type) {
      filter.type = req.query.type;
    }
    if (req.query.userId && mongoose.Types.ObjectId.isValid(req.query.userId)) {
      filter.user = req.query.userId;
    }

    const [requests, total] = await Promise.all([
      BankChangeRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email mobile'),
      BankChangeRequest.countDocuments(filter),
    ]);

    res.json({
      data: requests,
      pagination: {
        total,
        page,
        limit,
        hasMore: skip + requests.length < total,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const reviewBankChangeRequest = async (req, res) => {
  try {
    const { decision, note } = req.body || {};
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ message: 'decision must be approved or rejected' });
    }

    const request = await BankChangeRequest.findById(req.params.id).populate('user');
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ message: 'Request already processed' });
    }

    request.status = decision;
    request.reviewer = req.user._id;
    request.reviewedAt = new Date();
    request.reviewNote = note;
    await request.save();

    if (decision === 'approved') {
      if (request.type === 'bank') {
        request.user.bankDetails = {
          ...request.payload,
          verified: true,
          addedAt: new Date(),
          addedBy: 'admin',
        };
      } else {
        request.user.upiDetails = {
          ...request.payload,
          verified: true,
          addedAt: new Date(),
          addedBy: 'admin',
        };
      }
      await request.user.save();
    }

    await createUserNotification({
      userId: request.user._id,
      title: `${request.type.toUpperCase()} request ${decision}`,
      message:
        decision === 'approved'
          ? 'Your details update has been approved.'
          : 'Your details update was rejected.',
      type: 'admin',
      metadata: { requestId: request._id, status: request.status },
    });

    res.json(request);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const listMobileChangeRequests = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    }
    if (req.query.userId && mongoose.Types.ObjectId.isValid(req.query.userId)) {
      filter.user = req.query.userId;
    }

    const [requests, total] = await Promise.all([
      MobileChangeRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email mobile'),
      MobileChangeRequest.countDocuments(filter),
    ]);

    res.json({
      data: requests,
      pagination: {
        total,
        page,
        limit,
        hasMore: skip + requests.length < total,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const reviewMobileChangeRequest = async (req, res) => {
  try {
    const { decision, note } = req.body || {};
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ message: 'decision must be approved or rejected' });
    }

    const request = await MobileChangeRequest.findById(req.params.id).populate('user');
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ message: 'Request already processed' });
    }

    if (decision === 'approved') {
      const existingUser = await User.findOne({ mobile: request.newMobile });
      if (existingUser) {
        return res.status(400).json({ message: 'Mobile number already in use' });
      }
      request.user.mobile = request.newMobile;
      request.user.isMobileVerified = true;
      await request.user.save();
    }

    request.status = decision;
    request.reviewer = req.user._id;
    request.reviewedAt = new Date();
    request.reviewNote = note;
    await request.save();

    await createUserNotification({
      userId: request.user._id,
      title: `Mobile change ${decision}`,
      message:
        decision === 'approved'
          ? 'Your mobile number update was approved.'
          : 'Your mobile number update was rejected.',
      type: 'admin',
      metadata: { requestId: request._id, status: request.status },
    });

    res.json(request);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const searchReferralTree = async (req, res) => {
  try {
    const query = (req.query.q || '').trim();
    if (!query) {
      return res.status(400).json({ message: 'Query is required' });
    }
    const maxDepth = Math.min(Number(req.query.maxDepth) || 8, 8);
    const regex = new RegExp(query, 'i');
    const user = await User.findOne({
      $or: [{ name: regex }, { mobile: regex }, { referralCode: regex }],
    })
      .select('name email mobile referralCode referredBy referralPath referralLevel createdAt')
      .lean();

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const tree = await buildReferralTreePayload(user._id.toString(), maxDepth);
    res.json({
      user,
      tree: tree || {},
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getReferralTreeAdmin = async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }
    const maxDepth = Math.min(Number(req.query.maxDepth) || 8, 8);
    const tree = await buildReferralTreePayload(userId, maxDepth);
    res.json(tree || {});
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  listUsers,
  listUsersWithDetails,
  getLatestSignups,
  countUsers,
  getUserDetail,
  listKycApplications,
  getAdminStats,
  getTokenPriceAdmin,
  setTokenPriceAdmin,
  listIcoTransactions,
  listRecentTransactions,
  listReferralEarningsAdmin,
  updateUserStatus,
  updateUserEmail,
  updateUserPin,
  updateReferralEarningStatus,
  listBankChangeRequests,
  reviewBankChangeRequest,
  listMobileChangeRequests,
  reviewMobileChangeRequest,
  searchReferralTree,
  getReferralTreeAdmin,
};
