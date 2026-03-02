const WalletTransaction = require('../models/WalletTransaction');
const User = require('../models/User');

const MIN_ACTIVATION_AMOUNT = Number(
  process.env.ACCOUNT_ACTIVATION_MIN_AMOUNT || 1000,
);
const QUALIFYING_STATUSES = ['processed', 'completed'];

const getMonthWindow = (date = new Date()) => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 1, 0, 0, 0, 0);
  return { start, end, period: `${year}-${String(month + 1).padStart(2, '0')}` };
};

const buildActivationStatus = ({
  firstActivatedAt,
  lastQualifyingTransactionAt,
  currentMonthQualified,
  manualOverride,
  now = new Date(),
}) => {
  let status = 'never_activated';
  let reason = `First qualifying transaction of INR ${MIN_ACTIVATION_AMOUNT} is pending`;

  if (manualOverride?.overrideStatus === 'active' || manualOverride?.forceActive) {
    status = 'active';
    reason = 'Activated manually by admin';
  } else if (manualOverride?.overrideStatus === 'inactive') {
    status = 'inactive';
    reason = 'Deactivated manually by admin';
  } else if (firstActivatedAt) {
    if (currentMonthQualified) {
      status = 'active';
      reason = 'Monthly minimum transaction met';
    } else {
      status = 'inactive';
      reason = `No qualifying INR ${MIN_ACTIVATION_AMOUNT} transaction in current month`;
    }
  }

  const monthWindow = getMonthWindow(now);
  return {
    status,
    binaryStatus: status === 'active' ? 'active' : 'inactive',
    isActive: status === 'active',
    isActivatedEver: Boolean(firstActivatedAt || manualOverride?.forceActive),
    isManuallyActivated: Boolean(manualOverride?.overrideStatus || manualOverride?.forceActive),
    manualActivation: (manualOverride?.overrideStatus || manualOverride?.forceActive)
      ? {
          overrideStatus:
            manualOverride?.overrideStatus ||
            (manualOverride?.forceActive ? 'active' : null),
          setAt: manualOverride?.setAt || null,
          setBy: manualOverride?.setBy || null,
          note: manualOverride?.note || null,
        }
      : null,
    firstActivatedAt: firstActivatedAt || null,
    lastQualifyingTransactionAt: lastQualifyingTransactionAt || null,
    currentMonthQualified: Boolean(currentMonthQualified),
    monthlyMinimumAmount: MIN_ACTIVATION_AMOUNT,
    activationAmount: MIN_ACTIVATION_AMOUNT,
    evaluationMonth: monthWindow.period,
    reason,
  };
};

const resolveUserActivationStatus = async (userId, options = {}) => {
  const now = options.now || new Date();
  const { start, end } = getMonthWindow(now);

  const [firstQualifying, currentMonthQualifying, user] = await Promise.all([
    WalletTransaction.findOne({
      user: userId,
      amount: { $gte: MIN_ACTIVATION_AMOUNT },
      status: { $in: QUALIFYING_STATUSES },
    })
      .sort({ createdAt: 1 })
      .select('createdAt'),
    WalletTransaction.findOne({
      user: userId,
      amount: { $gte: MIN_ACTIVATION_AMOUNT },
      status: { $in: QUALIFYING_STATUSES },
      createdAt: { $gte: start, $lt: end },
    })
      .sort({ createdAt: -1 })
      .select('createdAt'),
    User.findById(userId).select('manualActivation'),
  ]);

  return buildActivationStatus({
    firstActivatedAt: firstQualifying?.createdAt,
    lastQualifyingTransactionAt: currentMonthQualifying?.createdAt || firstQualifying?.createdAt,
    currentMonthQualified: Boolean(currentMonthQualifying),
    manualOverride: user?.manualActivation,
    now,
  });
};

const resolveActivationStatusMap = async (userIds = [], options = {}) => {
  if (!userIds.length) return new Map();

  const now = options.now || new Date();
  const { start, end } = getMonthWindow(now);

  const [firstRows, monthRows, users] = await Promise.all([
    WalletTransaction.aggregate([
      {
        $match: {
          user: { $in: userIds },
          amount: { $gte: MIN_ACTIVATION_AMOUNT },
          status: { $in: QUALIFYING_STATUSES },
        },
      },
      {
        $group: {
          _id: '$user',
          firstActivatedAt: { $min: '$createdAt' },
        },
      },
    ]),
    WalletTransaction.aggregate([
      {
        $match: {
          user: { $in: userIds },
          amount: { $gte: MIN_ACTIVATION_AMOUNT },
          status: { $in: QUALIFYING_STATUSES },
          createdAt: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: '$user',
          lastQualifyingTransactionAt: { $max: '$createdAt' },
        },
      },
    ]),
    User.find({ _id: { $in: userIds } }).select('manualActivation'),
  ]);

  const firstMap = new Map(
    firstRows.map((row) => [row._id.toString(), row.firstActivatedAt]),
  );
  const monthMap = new Map(
    monthRows.map((row) => [row._id.toString(), row.lastQualifyingTransactionAt]),
  );

  const manualMap = new Map(
    users.map((user) => [user._id.toString(), user.manualActivation]),
  );

  const result = new Map();
  userIds.forEach((id) => {
    const key = id.toString();
    const firstActivatedAt = firstMap.get(key);
    const monthQualifyingAt = monthMap.get(key);
    result.set(
      key,
      buildActivationStatus({
        firstActivatedAt,
        lastQualifyingTransactionAt: monthQualifyingAt || firstActivatedAt,
        currentMonthQualified: Boolean(monthQualifyingAt),
        manualOverride: manualMap.get(key),
        now,
      }),
    );
  });

  return result;
};

const syncUserActivationTimestamp = async (userId) => {
  const firstQualifying = await WalletTransaction.findOne({
    user: userId,
    amount: { $gte: MIN_ACTIVATION_AMOUNT },
    status: { $in: QUALIFYING_STATUSES },
  })
    .sort({ createdAt: 1 })
    .select('createdAt');

  if (!firstQualifying) return null;

  await User.findByIdAndUpdate(
    userId,
    { $set: { activatedAt: firstQualifying.createdAt } },
    { new: false },
  );

  return firstQualifying.createdAt;
};

const resolveGlobalActivationCounts = async (options = {}) => {
  const now = options.now || new Date();
  const { start, end } = getMonthWindow(now);

  const [users, firstRows, monthRows] = await Promise.all([
    User.find({ role: 'user' }).select('_id manualActivation isActive'),
    WalletTransaction.aggregate([
      {
        $match: {
          amount: { $gte: MIN_ACTIVATION_AMOUNT },
          status: { $in: QUALIFYING_STATUSES },
        },
      },
      { $group: { _id: '$user', firstActivatedAt: { $min: '$createdAt' } } },
    ]),
    WalletTransaction.aggregate([
      {
        $match: {
          amount: { $gte: MIN_ACTIVATION_AMOUNT },
          status: { $in: QUALIFYING_STATUSES },
          createdAt: { $gte: start, $lt: end },
        },
      },
      { $group: { _id: '$user', lastQualifyingTransactionAt: { $max: '$createdAt' } } },
    ]),
  ]);

  const firstSet = new Set(firstRows.map((r) => r._id.toString()));
  const monthSet = new Set(monthRows.map((r) => r._id.toString()));

  const counts = {
    users: users.length,
    loginEnabled: 0,
    loginDisabled: 0,
    active: 0,
    inactive: 0,
    neverActivated: 0,
    manuallyActivated: 0,
  };

  users.forEach((user) => {
    const key = user._id.toString();
    const manualActive = Boolean(user.manualActivation?.forceActive);
    const ever = firstSet.has(key);
    const inMonth = monthSet.has(key);

    if (user.isActive === false) {
      counts.loginDisabled += 1;
    } else {
      counts.loginEnabled += 1;
    }

    if (manualActive) {
      counts.active += 1;
      counts.manuallyActivated += 1;
      return;
    }

    if (!ever) {
      counts.neverActivated += 1;
      return;
    }

    if (inMonth) {
      counts.active += 1;
    } else {
      counts.inactive += 1;
    }
  });

  return counts;
};

module.exports = {
  MIN_ACTIVATION_AMOUNT,
  resolveUserActivationStatus,
  resolveActivationStatusMap,
  resolveGlobalActivationCounts,
  syncUserActivationTimestamp,
};
