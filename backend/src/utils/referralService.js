const User = require('../models/User');
const ReferralEarning = require('../models/ReferralEarning');
const IcoTransaction = require('../models/IcoTransaction');

// Infinity 8 plan:
// - Depth 0 (always available): 5%
// - Depth 1: 15% (unlocks after 8 directs)
// - Depth 2: 10%
// - Depth 3: 8%
// - Depth 4: 5%
// - Depth 5: 3%
// - Depth 6: 2%
// - Depth 7: 1%
// - Depth 8: 1%
const REFERRAL_PERCENTAGES = [5, 15, 10, 8, 5, 3, 2, 1, 1];
const PROMOTION_THRESHOLD = 8;
const MAX_LEVELS = REFERRAL_PERCENTAGES.length;
const MONTHLY_TOKEN_REQUIREMENT = Number(process.env.REFERRAL_MIN_MONTHLY_TOKENS || 100);
const ACTIVE_WINDOW_DAYS = Number(process.env.REFERRAL_ACTIVE_WINDOW_DAYS || 30);
const REFERRAL_FALLBACK_CODE = (process.env.REFERRAL_FALLBACK_CODE || '').trim().toUpperCase();

const normalizeReferralCode = (code = '') => code.trim().toUpperCase();

const ensureDownlineArray = (arr = []) => {
  const counts = [...arr].slice(0, MAX_LEVELS);
  while (counts.length < MAX_LEVELS) {
    counts.push(0);
  }
  return counts;
};

const calculateNetworkLevel = (downlineCounts = []) => {
  const counts = ensureDownlineArray(downlineCounts);
  let level = 0;
  for (let i = 0; i < counts.length - 1; i += 1) {
    if (counts[i] >= PROMOTION_THRESHOLD) {
      level = i + 1;
    } else {
      break;
    }
  }
  return level;
};

const generateUniqueReferralCode = async () => {
  let attempts = 0;
  while (attempts < 5) {
    const code = `ICO${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await User.findOne({ referralCode: code });
    if (!exists) {
      return code;
    }
    attempts += 1;
  }
  return `ICO${Date.now().toString(36).toUpperCase()}`;
};

const ensureReferralCode = async (user) => {
  if (user.referralCode) {
    return false;
  }
  user.referralCode = await generateUniqueReferralCode();
  return true;
};

const incrementDownlineCounts = async (ancestorIds = []) => {
  for (let depth = 0; depth < ancestorIds.length; depth += 1) {
    const ancestorId = ancestorIds[depth];
    // eslint-disable-next-line no-await-in-loop
    const ancestor = await User.findById(ancestorId);
    if (!ancestor) continue;
    const counts = ensureDownlineArray(ancestor.referralDownlineCounts);
    counts[depth] = (counts[depth] || 0) + 1;
    ancestor.referralDownlineCounts = counts;
    ancestor.referralLevel = calculateNetworkLevel(counts);
    // eslint-disable-next-line no-await-in-loop
    await ensureReferralCode(ancestor);
    // eslint-disable-next-line no-await-in-loop
    await ancestor.save();
  }
};

const isUserActiveForReferral = async (userId) => {
  if (!MONTHLY_TOKEN_REQUIREMENT || MONTHLY_TOKEN_REQUIREMENT <= 0) {
    return true;
  }
  const windowStart = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [agg] = await IcoTransaction.aggregate([
    {
      $match: {
        user: userId,
        status: 'completed',
        type: 'buy',
        createdAt: { $gte: windowStart },
      },
    },
    {
      $group: {
        _id: null,
        tokens: { $sum: '$tokenAmount' },
      },
    },
  ]);
  const tokens = agg?.tokens || 0;
  return tokens >= MONTHLY_TOKEN_REQUIREMENT;
};

const applyReferralCodeOnSignup = async (user, referralCode) => {
  const code = normalizeReferralCode(referralCode);
  await ensureReferralCode(user);

  if (!code || user.referredBy) {
    return user;
  }

  // Allow a configured fallback code (for the very first/seed user)
  if (REFERRAL_FALLBACK_CODE && code === REFERRAL_FALLBACK_CODE) {
    return user;
  }

  const referrer = await User.findOne({ referralCode: code });
  if (!referrer) {
    const err = new Error('Invalid referral code');
    err.statusCode = 400;
    throw err;
  }

  if (referrer._id.equals(user._id)) {
    const err = new Error('You cannot use your own referral code');
    err.statusCode = 400;
    throw err;
  }

  const referrerPath = referrer.referralPath || [];
  if (referrerPath.some((id) => id && id.toString() === user._id.toString())) {
    const err = new Error('Referral loop detected');
    err.statusCode = 400;
    throw err;
  }

  user.referredBy = referrer._id;
  user.referralPath = [referrer._id, ...referrerPath].slice(0, MAX_LEVELS);
  await user.save();
  await incrementDownlineCounts(user.referralPath);
  return user;
};

const distributeReferralCommission = async ({ buyerId, amount, sourceType, sourceId }) => {
  if (!buyerId || !amount || amount <= 0) return;

  const buyer = await User.findById(buyerId);
  if (!buyer || !buyer.referralPath || buyer.referralPath.length === 0) return;

  const ancestors = buyer.referralPath.slice(0, MAX_LEVELS);

  for (let depth = 0; depth < ancestors.length; depth += 1) {
    const ancestorId = ancestors[depth];
    // eslint-disable-next-line no-await-in-loop
    const ancestor = await User.findById(ancestorId);
    if (!ancestor) continue;

    const percentage = REFERRAL_PERCENTAGES[depth];
    const earningAmount = Number(((amount * percentage) / 100).toFixed(2));
    if (!earningAmount || earningAmount <= 0) continue;

    const qualifies = (ancestor.referralLevel || 0) >= depth;
    if (!qualifies) continue;

    // Ensure the ancestor is active by meeting the monthly token purchase requirement
    // eslint-disable-next-line no-await-in-loop
    const active = await isUserActiveForReferral(ancestor._id);
    if (!active) continue;

    // Prevent duplicates when callbacks retry
    // eslint-disable-next-line no-await-in-loop
    const exists = await ReferralEarning.findOne({
      earner: ancestor._id,
      sourceId: String(sourceId),
      sourceType,
      depth,
    });
    if (exists) continue;

    // eslint-disable-next-line no-await-in-loop
    await ReferralEarning.create({
      earner: ancestor._id,
      sourceUser: buyer._id,
      sourceType,
      sourceId: String(sourceId),
      depth,
      percentage,
      amount: earningAmount,
    });

    ancestor.referralWalletBalance = (ancestor.referralWalletBalance || 0) + earningAmount;
    ancestor.referralTotalEarned = (ancestor.referralTotalEarned || 0) + earningAmount;
    // eslint-disable-next-line no-await-in-loop
    await ancestor.save();
  }
};

module.exports = {
  REFERRAL_PERCENTAGES,
  normalizeReferralCode,
  ensureReferralCode,
  isUserActiveForReferral,
  applyReferralCodeOnSignup,
  distributeReferralCommission,
};
