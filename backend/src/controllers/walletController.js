const mongoose = require('mongoose');
const WalletAccount = require('../models/WalletAccount');
const WalletTransaction = require('../models/WalletTransaction');
const User = require('../models/User');
const IcoHolding = require('../models/IcoHolding');
const IcoTransaction = require('../models/IcoTransaction');
const KycApplication = require('../models/KycApplication');
const StakingPosition = require('../models/StakingPosition');
const { createPhonePePaymentPayload } = require('../utils/phonePe');
const {
  createOrder: createRazorpayOrder,
  RAZORPAY_KEY_ID,
} = require('../utils/razorpay');
const { getOrCreateWalletAccount } = require('../utils/walletAccount');
const { distributeReferralCommission } = require('../utils/referralService');
const { resolveStages } = require('../utils/icoStages');
const { verifyUserOtp } = require('../utils/otpHelpers');
const { createUserNotification } = require('../utils/notificationService');
const { getTokenPrice, getTokenSymbol } = require('../utils/tokenPrice');

const CALLBACK_URL =
  process.env.PHONEPE_CALLBACK_URL ||
  'https://your-domain.com/api/payments/phonepe/callback';
const MIN_TOPUP_AMOUNT = Number(process.env.WALLET_MIN_TOPUP_AMOUNT || 10);
const MAX_TOPUP_AMOUNT = Number(process.env.WALLET_MAX_TOPUP_AMOUNT || 200000);
const MIN_WITHDRAW_AMOUNT = Number(
  process.env.WALLET_MIN_WITHDRAW_AMOUNT || 100,
);
const MIN_REFERRAL_REDEEM = Number(
  process.env.WALLET_MIN_REFERRAL_REDEEM || 10,
);
const MIN_STAKE_TOKENS = Number(process.env.STAKING_MIN_TOKENS || 100);
const STAKE_INTEREST_RATE = Number(process.env.STAKING_INTEREST_RATE || 8);
const STAKE_LOCK_DAYS = Number(process.env.STAKING_LOCK_DAYS || 30);
const WALLET_TRANSACTION_STATUSES = [
  'initiated',
  'pending',
  'processed',
  'completed',
  'failed',
  'cancelled',
];

const sanitizeTransaction = (transaction) => {
  if (!transaction) {
    return transaction;
  }
  const doc = transaction.toObject ? transaction.toObject() : transaction;
  delete doc.phonePePayload;
  delete doc.phonePeResponse;
  return doc;
};

const getTokenMeta = () => ({
  tokenSymbol: getTokenSymbol(),
  tokenPrice: getTokenPrice(),
});

const ensureKycVerified = async (userId) => {
  const kyc = await KycApplication.findOne({ user: userId });
  if (!kyc || kyc.status !== 'verified') {
    const error = new Error('KYC verification required');
    error.statusCode = 403;
    throw error;
  }
  return kyc;
};

const recordStatusChange = (transaction, status, changedBy, note) => {
  if (!transaction) return;
  const entry = {
    status,
    changedAt: new Date(),
    changedBy,
    note,
  };
  transaction.statusHistory = [...(transaction.statusHistory || []), entry];
};

const getWalletSummary = async (req, res) => {
  try {
    const walletPromise = getOrCreateWalletAccount(req.user._id);
    const userPromise = User.findById(req.user._id);
    const holdingPromise = IcoHolding.findOne({ user: req.user._id });
    const stages = resolveStages();

    const [wallet, user, holding] = await Promise.all([
      walletPromise,
      userPromise,
      holdingPromise,
    ]);
    const userObjectId = new mongoose.Types.ObjectId(req.user._id);
    const { tokenPrice, tokenSymbol } = getTokenMeta();

    const [pendingTopups] = await WalletTransaction.aggregate([
      {
        $match: {
          user: userObjectId,
          category: 'topup',
          status: { $in: ['initiated', 'pending'] },
        },
      },
      {
        $group: {
          _id: null,
          amount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    const recentTransactions = await WalletTransaction.find({
      user: req.user._id,
    })
      .sort({ createdAt: -1 })
      .limit(5);

    const recentIcoTransactions = await IcoTransaction.find({
      user: req.user._id,
    })
      .sort({ createdAt: -1 })
      .limit(5);

    const [stakingAgg] = await StakingPosition.aggregate([
      {
        $match: {
          user: userObjectId,
          status: { $in: ['active', 'matured'] },
        },
      },
      {
        $group: {
          _id: null,
          stakedBalance: { $sum: '$tokenAmount' },
          expectedReturn: { $sum: '$expectedReturn' },
        },
      },
    ]);

    const combinedActivity = [
      ...recentTransactions.map((tx) => ({
        id: tx._id,
        kind: 'wallet',
        type: tx.type,
        category: tx.category,
        amount: tx.amount,
        status: tx.status,
        timestamp: tx.createdAt,
      })),
      ...recentIcoTransactions.map((tx) => ({
        id: tx._id,
        kind: 'ico',
        type: tx.type,
        amount: tx.fiatAmount,
        tokenAmount: tx.tokenAmount,
        status: tx.status,
        timestamp: tx.createdAt,
      })),
    ]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);

    res.json({
      wallet: {
        balance: wallet.balance,
        currency: wallet.currency,
        pendingWithdrawals: wallet.pendingWithdrawals,
        totalCredited: wallet.totalCredited,
        totalDebited: wallet.totalDebited,
        updatedAt: wallet.updatedAt,
      },
      referral: user
        ? {
            balance: user.referralWalletBalance || 0,
            totalEarned: user.referralTotalEarned || 0,
            code: user.referralCode,
            level: user.referralLevel || 0,
          }
        : undefined,
      tokenWallet: {
        balance: holding?.balance || 0,
        tokenSymbol,
        price: tokenPrice,
        valuation: (holding?.balance || 0) * tokenPrice,
      },
      rewardsWallet: {
        balance: user?.rewardsWalletBalance || 0,
      },
      stakingWallet: {
        stakedBalance: stakingAgg?.stakedBalance || 0,
        expectedReturn: stakingAgg?.expectedReturn || 0,
        interestRate: STAKE_INTEREST_RATE,
      },
      pendingTopups: pendingTopups?.amount || 0,
      pendingTopupCount: pendingTopups?.count || 0,
      recentTransactions: recentTransactions.map(sanitizeTransaction),
      recentActivity: combinedActivity,
      icoStage: stages.activeStage,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const listWalletTransactions = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = { user: req.user._id };
    if (req.query.status) {
      if (!WALLET_TRANSACTION_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ message: 'Invalid status filter' });
      }
      filter.status = req.query.status;
    }
    if (req.query.type) {
      filter.type = req.query.type;
    }
    if (req.query.category) {
      filter.category = req.query.category;
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
      WalletTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      WalletTransaction.countDocuments(filter),
    ]);

    res.json({
      transactions: transactions.map(sanitizeTransaction),
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

const initiateWalletTopup = async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: 'A valid amount is required' });
    }

    if (amount < MIN_TOPUP_AMOUNT) {
      return res
        .status(400)
        .json({ message: `Minimum top-up amount is INR ${MIN_TOPUP_AMOUNT}` });
    }

    if (amount > MAX_TOPUP_AMOUNT) {
      return res
        .status(400)
        .json({ message: `Maximum top-up amount is INR ${MAX_TOPUP_AMOUNT}` });
    }

    const wallet = await getOrCreateWalletAccount(req.user._id);
    const method = (req.body.paymentMethod || '').toLowerCase();
    const useRazorpay = method === 'razorpay';

    const transaction = await WalletTransaction.create({
      user: req.user._id,
      wallet: wallet._id,
      type: 'credit',
      category: 'topup',
      amount,
      currency: wallet.currency,
      status: 'initiated',
      description: req.body.note?.trim() || `Wallet top-up of INR ${amount}`,
      paymentGateway: useRazorpay ? 'razorpay' : 'phonepe',
      metadata: {
        note: req.body.note?.trim(),
        paymentInstrument: req.body.paymentInstrument,
      },
    });

    if (useRazorpay) {
      const order = await createRazorpayOrder({
        amount,
        currency: wallet.currency || 'INR',
        receipt: transaction._id.toString(),
        notes: {
          userId: req.user._id.toString(),
          category: 'wallet_topup',
        },
      });

      transaction.merchantTransactionId =
        order.id || transaction._id.toString();
      transaction.razorpayOrderId = order.id;
      await transaction.save();

      return res.status(201).json({
        wallet: {
          balance: wallet.balance,
          currency: wallet.currency,
          pendingWithdrawals: wallet.pendingWithdrawals,
        },
        transaction: sanitizeTransaction(transaction),
        paymentGateway: 'razorpay',
        razorpay: {
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          keyId: RAZORPAY_KEY_ID,
          key: RAZORPAY_KEY_ID, // alias used by Razorpay Checkout
          notes: order.notes,
          mock: order.mock || false,
        },
      });
    }

    const session = createPhonePePaymentPayload({
      amount,
      orderId: transaction._id.toString(),
      merchantUserId: req.user._id.toString(),
      callbackUrl: CALLBACK_URL,
      redirectUrl: req.body.redirectUrl,
      paymentInstrument: req.body.paymentInstrument,
    });

    transaction.merchantTransactionId =
      session.payload?.merchantTransactionId || transaction._id.toString();
    transaction.phonePePayload = {
      endpoint: session.endpoint,
      payload: session.payload,
      payloadBase64: session.payloadBase64,
      checksum: session.checksum,
    };
    await transaction.save();

    const transactionJson = sanitizeTransaction(transaction);

    res.status(201).json({
      wallet: {
        balance: wallet.balance,
        currency: wallet.currency,
        pendingWithdrawals: wallet.pendingWithdrawals,
      },
      transaction: transactionJson,
      paymentSession: {
        endpoint: session.endpoint,
        request: session.payloadBase64,
        checksum: session.checksum,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const requestWalletWithdrawal = async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const payoutMethod = (req.body.payoutMethod || '').toLowerCase();
    const otp = req.body.otp;
    if (Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: 'A valid amount is required' });
    }

    if (amount < MIN_WITHDRAW_AMOUNT) {
      return res.status(400).json({
        message: `Minimum withdrawal amount is INR ${MIN_WITHDRAW_AMOUNT}`,
      });
    }

    if (!['bank', 'upi'].includes(payoutMethod)) {
      return res.status(400).json({ message: 'payoutMethod must be bank or upi' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const otpCheck = verifyUserOtp({ user, otp, purpose: 'withdrawal' });
    if (!otpCheck.ok) {
      return res.status(400).json({ message: otpCheck.message });
    }

    await ensureKycVerified(req.user._id);

    const payoutDetails =
      payoutMethod === 'bank' ? user.bankDetails : user.upiDetails;

    if (!payoutDetails || !Object.keys(payoutDetails).length) {
      return res.status(400).json({
        message: `Add ${payoutMethod === 'bank' ? 'bank' : 'UPI'} details before withdrawing`,
      });
    }

    user.otp = undefined;
    await user.save();

    const wallet = await getOrCreateWalletAccount(req.user._id);
    if (wallet.balance < amount) {
      return res.status(400).json({ message: 'Insufficient wallet balance' });
    }

    wallet.balance -= amount;
    wallet.pendingWithdrawals += amount;
    await wallet.save();

    const transaction = await WalletTransaction.create({
      user: req.user._id,
      wallet: wallet._id,
      type: 'debit',
      category: 'withdrawal',
      amount,
      currency: wallet.currency,
      status: 'pending',
      description:
        req.body.note?.trim() || `Withdrawal request of INR ${amount}`,
      metadata: {
        payoutMethod,
        payoutDetails,
        note: req.body.note?.trim(),
      },
    });

    recordStatusChange(transaction, 'pending', req.user._id, 'Withdrawal requested');
    await transaction.save();

    await createUserNotification({
      userId: req.user._id,
      title: 'Withdrawal requested',
      message: `Your withdrawal request of INR ${amount} is pending approval.`,
      type: 'withdrawal',
      metadata: { transactionId: transaction._id },
    });

    res.status(201).json({
      wallet: {
        balance: wallet.balance,
        pendingWithdrawals: wallet.pendingWithdrawals,
        currency: wallet.currency,
      },
      transaction: sanitizeTransaction(transaction),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const redeemReferralEarnings = async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: 'A valid amount is required' });
    }

    if (amount < MIN_REFERRAL_REDEEM) {
      return res.status(400).json({
        message: `Minimum referral redemption is INR ${MIN_REFERRAL_REDEEM}`,
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const available = user.referralWalletBalance || 0;
    if (available < amount) {
      return res.status(400).json({ message: 'Insufficient referral balance' });
    }

    user.referralWalletBalance = available - amount;
    await user.save();

    const wallet = await getOrCreateWalletAccount(user._id);
    wallet.balance += amount;
    wallet.totalCredited += amount;
    await wallet.save();

    const transaction = await WalletTransaction.create({
      user: user._id,
      wallet: wallet._id,
      type: 'credit',
      category: 'referral',
      amount,
      currency: wallet.currency,
      status: 'completed',
      description: 'Referral earnings moved to main wallet',
      metadata: {
        note: req.body.note?.trim(),
      },
    });

    res.json({
      wallet: {
        balance: wallet.balance,
        currency: wallet.currency,
      },
      referralWalletBalance: user.referralWalletBalance,
      transaction: sanitizeTransaction(transaction),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const swapMainToToken = async (req, res) => {
  try {
    const { tokenAmount, fiatAmount } = req.body || {};
    const { tokenPrice, tokenSymbol } = getTokenMeta();
    const tokens = tokenAmount ? Number(tokenAmount) : Number(fiatAmount) / tokenPrice;
    const amount = fiatAmount ? Number(fiatAmount) : tokens * tokenPrice;

    if (Number.isNaN(tokens) || Number.isNaN(amount) || tokens <= 0 || amount <= 0) {
      return res.status(400).json({ message: 'Invalid swap amount' });
    }

    await ensureKycVerified(req.user._id);

    const wallet = await getOrCreateWalletAccount(req.user._id);
    if (wallet.balance < amount) {
      return res.status(400).json({ message: 'Insufficient wallet balance' });
    }

    wallet.balance -= amount;
    wallet.totalDebited += amount;
    await wallet.save();

    const walletTx = await WalletTransaction.create({
      user: req.user._id,
      wallet: wallet._id,
      type: 'debit',
      category: 'swap',
      amount,
      currency: wallet.currency,
      status: 'completed',
      description: `Swap INR ${amount} to ${tokens} ${tokenSymbol}`,
      metadata: {
        tokenAmount: tokens,
        pricePerToken: tokenPrice,
        tokenSymbol,
      },
    });

    const stages = resolveStages();
    const transaction = await IcoTransaction.create({
      user: req.user._id,
      type: 'buy',
      tokenAmount: tokens,
      pricePerToken: tokenPrice,
      fiatAmount: amount,
      status: 'completed',
      paymentReference: walletTx._id.toString(),
      metadata: {
        stageKey: stages.activeStage?.key,
      },
    });

    const holding = await IcoHolding.findOneAndUpdate(
      { user: req.user._id },
      { $inc: { balance: tokens } },
      { new: true, upsert: true },
    );

    await distributeReferralCommission({
      buyerId: req.user._id,
      amount,
      sourceType: 'ico',
      sourceId: transaction._id.toString(),
    });

    await createUserNotification({
      userId: req.user._id,
      title: 'Token swap completed',
      message: `Swapped INR ${amount} to ${tokens} ${tokenSymbol}.`,
      type: 'transaction',
      metadata: { transactionId: transaction._id },
    });

    res.status(201).json({
      transaction,
      wallet: {
        balance: wallet.balance,
        currency: wallet.currency,
      },
      holding: {
        balance: holding.balance,
        tokenSymbol,
        valuation: holding.balance * tokenPrice,
      },
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

const stakeTokens = async (req, res) => {
  try {
    const tokenAmount = Number(req.body.tokenAmount);
    if (Number.isNaN(tokenAmount) || tokenAmount <= 0) {
      return res.status(400).json({ message: 'tokenAmount is required' });
    }
    if (tokenAmount < MIN_STAKE_TOKENS) {
      return res.status(400).json({
        message: `Minimum staking amount is ${MIN_STAKE_TOKENS} tokens`,
      });
    }

    await ensureKycVerified(req.user._id);

    const holding = await IcoHolding.findOne({ user: req.user._id });
    if (!holding || holding.balance < tokenAmount) {
      return res.status(400).json({ message: 'Insufficient token balance' });
    }

    holding.balance -= tokenAmount;
    await holding.save();

    const interestAmount = Number(((tokenAmount * STAKE_INTEREST_RATE) / 100).toFixed(4));
    const expectedReturn = Number((tokenAmount + interestAmount).toFixed(4));
    const now = new Date();
    const maturesAt = new Date(now);
    maturesAt.setDate(maturesAt.getDate() + STAKE_LOCK_DAYS);

    const stake = await StakingPosition.create({
      user: req.user._id,
      tokenAmount,
      interestRate: STAKE_INTEREST_RATE,
      interestAmount,
      expectedReturn,
      startedAt: now,
      maturesAt,
      metadata: {
        lockDays: STAKE_LOCK_DAYS,
      },
    });

    await createUserNotification({
      userId: req.user._id,
      title: 'Staking started',
      message: `Staked ${tokenAmount} tokens. Expected return ${expectedReturn} tokens.`,
      type: 'transaction',
      metadata: { stakeId: stake._id },
    });

    res.status(201).json({
      stake,
      holding: {
        balance: holding.balance,
      },
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

const listStakes = async (req, res) => {
  try {
    const now = new Date();
    await StakingPosition.updateMany(
      { user: req.user._id, status: 'active', maturesAt: { $lte: now } },
      { $set: { status: 'matured' } },
    );

    const stakes = await StakingPosition.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(req.query.limit) || 100, 200));

    res.json(stakes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const claimStake = async (req, res) => {
  try {
    const { stakeId } = req.params;
    const stake = await StakingPosition.findOne({
      _id: stakeId,
      user: req.user._id,
    });

    if (!stake) {
      return res.status(404).json({ message: 'Stake not found' });
    }

    const now = new Date();
    if (stake.maturesAt > now) {
      return res.status(400).json({ message: 'Stake not yet matured' });
    }

    if (stake.status === 'claimed') {
      return res.status(400).json({ message: 'Stake already claimed' });
    }

    stake.status = 'claimed';
    stake.claimedAt = now;
    await stake.save();

    const holding = await IcoHolding.findOneAndUpdate(
      { user: req.user._id },
      { $inc: { balance: stake.expectedReturn } },
      { new: true, upsert: true },
    );

    await createUserNotification({
      userId: req.user._id,
      title: 'Staking completed',
      message: `Claimed ${stake.expectedReturn} tokens from staking.`,
      type: 'transaction',
      metadata: { stakeId: stake._id },
    });

    res.json({
      stake,
      holding: {
        balance: holding.balance,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getWalletAnalytics = async (req, res) => {
  try {
    const userId = req.user._id;
    const wallet = await getOrCreateWalletAccount(userId);
    const user = await User.findById(userId);
    const holding = await IcoHolding.findOne({ user: userId });

    const [buyAgg, sellAgg, stakeAgg] = await Promise.all([
      IcoTransaction.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(userId), type: 'buy', status: 'completed' } },
        { $group: { _id: null, tokens: { $sum: '$tokenAmount' }, fiat: { $sum: '$fiatAmount' } } },
      ]),
      IcoTransaction.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(userId), type: 'sell' } },
        { $group: { _id: null, tokens: { $sum: '$tokenAmount' }, fiat: { $sum: '$fiatAmount' } } },
      ]),
      StakingPosition.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(userId) } },
        { $group: { _id: null, staked: { $sum: '$tokenAmount' }, expected: { $sum: '$expectedReturn' } } },
      ]),
    ]);

    res.json({
      wallets: {
        main: {
          balance: wallet.balance,
          currency: wallet.currency,
          pendingWithdrawals: wallet.pendingWithdrawals,
          totalCredited: wallet.totalCredited,
          totalDebited: wallet.totalDebited,
        },
        token: {
          balance: holding?.balance || 0,
        },
        referral: {
          balance: user?.referralWalletBalance || 0,
          totalEarned: user?.referralTotalEarned || 0,
        },
        rewards: {
          balance: user?.rewardsWalletBalance || 0,
        },
        staking: {
          staked: stakeAgg?.[0]?.staked || 0,
          expectedReturn: stakeAgg?.[0]?.expected || 0,
          interestRate: STAKE_INTEREST_RATE,
        },
      },
      portfolio: {
        tokensHeld: holding?.balance || 0,
        tokensStaked: stakeAgg?.[0]?.staked || 0,
        referralCommissions: user?.referralTotalEarned || 0,
      },
      activity: {
        buy: {
          tokens: buyAgg?.[0]?.tokens || 0,
          fiat: buyAgg?.[0]?.fiat || 0,
        },
        sell: {
          tokens: sellAgg?.[0]?.tokens || 0,
          fiat: sellAgg?.[0]?.fiat || 0,
        },
        stake: {
          tokens: stakeAgg?.[0]?.staked || 0,
          expectedReturn: stakeAgg?.[0]?.expected || 0,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const adminListWalletTransactions = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.userId && mongoose.Types.ObjectId.isValid(req.query.userId)) {
      filter.user = req.query.userId;
    }
    if (req.query.status) {
      if (!WALLET_TRANSACTION_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ message: 'Invalid status filter' });
      }
      filter.status = req.query.status;
    }
    if (req.query.type) {
      filter.type = req.query.type;
    }
    if (req.query.category) {
      filter.category = req.query.category;
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
      WalletTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email mobile'),
      WalletTransaction.countDocuments(filter),
    ]);

    res.json({
      transactions: transactions.map(sanitizeTransaction),
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

const adminUpdateWalletTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { status, adminNote } = req.body;
    if (!status && adminNote === undefined) {
      return res.status(400).json({ message: 'Nothing to update' });
    }

    if (status && !WALLET_TRANSACTION_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }

    const transaction = await WalletTransaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    const previousStatus = transaction.status;
    let wallet;

    if (status && status !== transaction.status) {
      transaction.status = status;
      recordStatusChange(transaction, status, req.user._id, adminNote);
      if (transaction.category === 'withdrawal') {
        wallet = await getOrCreateWalletAccount(transaction.user);

        const canSettle = ['pending', 'processed'].includes(previousStatus);
        if (canSettle && status === 'completed') {
          wallet.pendingWithdrawals = Math.max(
            0,
            wallet.pendingWithdrawals - transaction.amount,
          );
          wallet.totalDebited += transaction.amount;
          await wallet.save();
        } else if (canSettle && ['failed', 'cancelled'].includes(status)) {
          wallet.balance += transaction.amount;
          wallet.pendingWithdrawals = Math.max(
            0,
            wallet.pendingWithdrawals - transaction.amount,
          );
          await wallet.save();
        }
      }
    }

    if (adminNote !== undefined) {
      transaction.adminNote = adminNote;
    }

    await transaction.save();

    if (status && status !== previousStatus && transaction.category === 'withdrawal') {
      await createUserNotification({
        userId: transaction.user,
        title: 'Withdrawal status update',
        message: `Your withdrawal is now ${status}.`,
        type: 'withdrawal',
        metadata: { transactionId: transaction._id, status },
      });
    }

    res.json({
      transaction: sanitizeTransaction(transaction),
      wallet: wallet
        ? {
          balance: wallet.balance,
            pendingWithdrawals: wallet.pendingWithdrawals,
            totalDebited: wallet.totalDebited,
          }
        : undefined,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getWalletSummary,
  listWalletTransactions,
  initiateWalletTopup,
  requestWalletWithdrawal,
  redeemReferralEarnings,
  swapMainToToken,
  stakeTokens,
  listStakes,
  claimStake,
  getWalletAnalytics,
  adminListWalletTransactions,
  adminUpdateWalletTransaction,
};
