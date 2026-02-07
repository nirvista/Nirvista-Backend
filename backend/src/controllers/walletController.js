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
const { createPayUPaymentPayload } = require('../utils/payu');
const { getOrCreateWalletAccount } = require('../utils/walletAccount');
const { distributeReferralCommission } = require('../utils/referralService');
const { resolveStages } = require('../utils/icoStages');
const { verifyUserOtp } = require('../utils/otpHelpers');
const { isFirebaseOtpEnabled, verifyFirebaseOtpForUser } = require('../utils/firebaseOtp');
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
const FLUID_NOTICE_DAYS = Number(process.env.FLUID_STACK_NOTICE_DAYS || 30);
const WALLET_TRANSACTION_STATUSES = [
  'initiated',
  'pending',
  'processed',
  'completed',
  'failed',
  'cancelled',
];

const STACKING_PLANS = {
  fixed: {
    label: 'Fixed Stack',
    description: 'Higher returns - Locked until maturity',
    badge: '🔥',
    noticeDays: 0,
    allowEarlyWithdrawal: false,
    durations: {
      3: 6,
      6: 8,
      12: 10,
      24: 16,
    },
  },
  fluid: {
    label: 'Fluid Stack',
    description: 'Flexible withdrawal - 1-month notice required',
    badge: null,
    noticeDays: FLUID_NOTICE_DAYS,
    allowEarlyWithdrawal: true,
    durations: {
      3: 3,
      6: 6,
      12: 8,
      24: 10,
    },
  },
};

const VALID_STACK_TYPES = Object.keys(STACKING_PLANS);
const VALID_STACK_DURATIONS = new Set(
  Object.values(STACKING_PLANS).flatMap((plan) =>
    Object.keys(plan.durations).map((months) => Number(months)),
  ),
);

const sanitizeTransaction = (transaction) => {
  if (!transaction) {
    return transaction;
  }
  const doc = transaction.toObject ? transaction.toObject() : transaction;
  delete doc.phonePePayload;
  delete doc.phonePeResponse;
  delete doc.payuPayload;
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

const roundAmount = (value) => Number((Number(value) || 0).toFixed(4));

const getMonthlyRate = (stackType, durationMonths) => {
  const plan = STACKING_PLANS[stackType];
  return plan ? plan.durations[durationMonths] : undefined;
};

const buildInterestSchedule = (startAt, monthlyAmount, durationMonths) => {
  const schedule = [];
  for (let monthIndex = 1; monthIndex <= durationMonths; monthIndex += 1) {
    const creditedAt = new Date(startAt.getTime());
    creditedAt.setMonth(creditedAt.getMonth() + monthIndex);
    schedule.push({
      label: `Month ${monthIndex}`,
      amount: monthlyAmount,
      status: 'pending',
      creditedAt,
    });
  }
  return schedule;
};

const buildStackPlanPayload = () =>
  VALID_STACK_TYPES.map((stackType) => {
    const plan = STACKING_PLANS[stackType];
    const durations = Object.entries(plan.durations)
      .map(([duration, rate]) => ({
        months: Number(duration),
        monthlyInterestRate: rate,
      }))
      .sort((a, b) => a.months - b.months);
    return {
      type: stackType,
      label: plan.label,
      description: plan.description,
      badge: plan.badge,
      noticeDays: plan.noticeDays,
      allowEarlyWithdrawal: plan.allowEarlyWithdrawal,
      durations,
    };
  });

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

    const stakingStatuses = [
      'active',
      'withdrawal_requested',
      'withdrawal_available',
      'matured',
    ];
    const stakingAgg = await StakingPosition.aggregate([
      {
        $match: {
          user: userObjectId,
          status: { $in: stakingStatuses },
        },
      },
      {
        $group: {
          _id: '$stackType',
          stakedBalance: { $sum: '$tokenAmount' },
          expectedReturn: { $sum: '$expectedReturn' },
        },
      },
    ]);
    const stakingSummary = stakingAgg.reduce(
      (acc, entry) => {
        const type = entry._id || 'fixed';
        acc.totalStaked += entry.stakedBalance;
        acc.totalExpectedReturn += entry.expectedReturn;
        acc.breakdown[type] = {
          stakedBalance: entry.stakedBalance,
          expectedReturn: entry.expectedReturn,
        };
        return acc;
      },
      { totalStaked: 0, totalExpectedReturn: 0, breakdown: {} },
    );
    const stackingPlans = buildStackPlanPayload();

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
        totalStaked: stakingSummary.totalStaked,
        totalExpectedReturn: stakingSummary.totalExpectedReturn,
        breakdown: stakingSummary.breakdown,
      },
      stackingPlans,
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
    const usePayU = method === 'payu';

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

    if (usePayU) {
      const payuSession = createPayUPaymentPayload({
        amount,
        txnid: transaction._id.toString(),
        firstname: req.user?.name || 'User',
        email: req.user?.email || '',
        phone: req.user?.mobile || '',
        productinfo: `Wallet top-up of INR ${amount}`,
      });

      transaction.paymentGateway = 'payu';
      transaction.payuTransactionId = payuSession.payload.txnid;
      transaction.payuPayload = payuSession.payload;
      transaction.merchantTransactionId = payuSession.payload.txnid;
      await transaction.save();

      return res.status(201).json({
        wallet: {
          balance: wallet.balance,
          currency: wallet.currency,
          pendingWithdrawals: wallet.pendingWithdrawals,
        },
        transaction: sanitizeTransaction(transaction),
        paymentGateway: 'payu',
        payu: {
          endpoint: payuSession.endpoint,
          payload: payuSession.payload,
          hash: payuSession.hash,
          successUrl: payuSession.payload.surl,
          failureUrl: payuSession.payload.furl,
          mock: payuSession.mock,
        },
      });
    }

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
    const { otp, firebaseToken } = req.body || {};
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

    if (firebaseToken && isFirebaseOtpEnabled()) {
      const firebaseCheck = await verifyFirebaseOtpForUser({
        user,
        firebaseToken,
        purpose: 'withdrawal',
      });
      if (!firebaseCheck.ok) {
        return res.status(400).json({ message: firebaseCheck.message });
      }
    } else {
      const otpCheck = verifyUserOtp({ user, otp, purpose: 'withdrawal' });
      if (!otpCheck.ok) {
        return res.status(400).json({ message: otpCheck.message });
      }
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

    const stackType = (req.body.stackType || 'fixed').toLowerCase();
    if (!VALID_STACK_TYPES.includes(stackType)) {
      return res.status(400).json({
        message: `stackType must be one of ${VALID_STACK_TYPES.join(', ')}`,
      });
    }

    const durationMonths = Number(req.body.durationMonths);
    if (Number.isNaN(durationMonths) || !VALID_STACK_DURATIONS.has(durationMonths)) {
      return res.status(400).json({
        message: `durationMonths must be one of ${[...VALID_STACK_DURATIONS].join(', ')}`,
      });
    }

    const monthlyRate = getMonthlyRate(stackType, durationMonths);
    if (monthlyRate === undefined) {
      return res.status(400).json({ message: 'Invalid stack type or duration' });
    }

    await ensureKycVerified(req.user._id);

    const holding = await IcoHolding.findOne({ user: req.user._id });
    if (!holding || holding.balance < tokenAmount) {
      return res.status(400).json({ message: 'Insufficient token balance' });
    }

    holding.balance -= tokenAmount;
    await holding.save();

    const monthlyInterestAmount = roundAmount((tokenAmount * monthlyRate) / 100);
    const interestAmount = roundAmount(monthlyInterestAmount * durationMonths);
    const expectedReturn = roundAmount(tokenAmount + interestAmount);
    const now = new Date();
    const maturesAt = new Date(now);
    maturesAt.setMonth(maturesAt.getMonth() + durationMonths);

    const plan = STACKING_PLANS[stackType];
    const interestHistory = buildInterestSchedule(now, monthlyInterestAmount, durationMonths);

    const stake = await StakingPosition.create({
      user: req.user._id,
      tokenAmount,
      stackType,
      durationMonths,
      interestRate: monthlyRate,
      monthlyInterestAmount,
      interestAmount,
      expectedReturn,
      startedAt: now,
      maturesAt,
      interestHistory,
      withdrawal: {
        noticeDays: plan.noticeDays,
      },
      metadata: {
        stackPlan: stackType,
        durationMonths,
      },
    });

    await createUserNotification({
      userId: req.user._id,
      title: 'Staking started',
      message: `Started a ${durationMonths}-month ${stackType.toUpperCase()} stack for ${tokenAmount} tokens.`,
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
      {
        user: req.user._id,
        status: 'active',
        stackType: 'fixed',
        maturesAt: { $lte: now },
      },
      { $set: { status: 'matured' } },
    );
    await StakingPosition.updateMany(
      {
        user: req.user._id,
        status: 'withdrawal_requested',
        'withdrawal.withdrawableAt': { $lte: now },
      },
      { $set: { status: 'withdrawal_available' } },
    );

    const stakes = await StakingPosition.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(req.query.limit) || 100, 200));

    res.json(stakes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const requestStakeWithdrawal = async (req, res) => {
  try {
    const { stakeId } = req.params;
    const stake = await StakingPosition.findOne({
      _id: stakeId,
      user: req.user._id,
    });

    if (!stake) {
      return res.status(404).json({ message: 'Stake not found' });
    }

    if (stake.stackType !== 'fluid') {
      return res.status(400).json({
        message: 'Withdrawal notice is only available for fluid stacks',
      });
    }

    if (['claimed', 'cancelled'].includes(stake.status)) {
      return res
        .status(400)
        .json({ message: 'Cannot request withdrawal for a closed stake' });
    }

    const now = new Date();
    const withdrawableAt = new Date(now);
    withdrawableAt.setDate(withdrawableAt.getDate() + FLUID_NOTICE_DAYS);

    stake.withdrawal = {
      ...stake.withdrawal,
      noticeDays: FLUID_NOTICE_DAYS,
      requestedAt: now,
      withdrawableAt,
    };
    stake.status =
      withdrawableAt <= now ? 'withdrawal_available' : 'withdrawal_requested';
    await stake.save();

    res.json(stake);
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
    if (stake.status === 'claimed') {
      return res.status(400).json({ message: 'Stake already claimed' });
    }
    if (stake.stackType === 'fixed') {
      if (stake.maturesAt > now) {
        return res.status(400).json({ message: 'Stake not yet matured' });
      }
    } else {
      const withdrawableAt = stake.withdrawal?.withdrawableAt;
      if (!withdrawableAt) {
        return res.status(400).json({
          message: 'Create a withdrawal notice before claiming a fluid stack',
        });
      }

      if (withdrawableAt > now) {
        return res
          .status(400)
          .json({ message: 'Withdrawal notice is still in the cooling period' });
      }

      stake.status = 'withdrawal_available';
      stake.withdrawal.completedAt = now;
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

    const [buyAgg, sellAgg, stackBreakdownAgg] = await Promise.all([
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
        {
          $group: {
            _id: '$stackType',
            staked: { $sum: '$tokenAmount' },
            expected: { $sum: '$expectedReturn' },
          },
        },
      ]),
    ]);

    const stakingTotals = stackBreakdownAgg.reduce(
      (acc, entry) => {
        acc.totalStaked += entry.staked || 0;
        acc.totalExpected += entry.expected || 0;
        acc.breakdown[entry._id || 'fixed'] = {
          staked: entry.staked || 0,
          expectedReturn: entry.expected || 0,
        };
        return acc;
      },
      { totalStaked: 0, totalExpected: 0, breakdown: {} },
    );
    const stackingPlans = buildStackPlanPayload();

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
          staked: stakingTotals.totalStaked,
          expectedReturn: stakingTotals.totalExpected,
          breakdown: stakingTotals.breakdown,
        },
      },
      portfolio: {
        tokensHeld: holding?.balance || 0,
        tokensStaked: stakingTotals.totalStaked,
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
          tokens: stakingTotals.totalStaked,
          expectedReturn: stakingTotals.totalExpected,
        },
      },
      stackingPlans,
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
  requestStakeWithdrawal,
  claimStake,
  getWalletAnalytics,
  adminListWalletTransactions,
  adminUpdateWalletTransaction,
};
