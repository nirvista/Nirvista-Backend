const mongoose = require('mongoose');

const VALID_DURATIONS = [3, 6, 12, 24];
const VALID_STATUSES = [
  'active',
  'withdrawal_requested',
  'withdrawal_available',
  'matured',
  'claimed',
  'cancelled',
];

const interestHistoryEntrySchema = new mongoose.Schema(
  {
    label: String,
    amount: {
      type: Number,
      min: 0,
      default: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'available', 'withdrawn'],
      default: 'pending',
    },
    creditedAt: Date,
  },
  { _id: false },
);

const withdrawalNoticeSchema = new mongoose.Schema(
  {
    noticeDays: {
      type: Number,
      min: 0,
      default: 0,
    },
    requestedAt: Date,
    withdrawableAt: Date,
    completedAt: Date,
  },
  { _id: false },
);

const stakingPositionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    tokenAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    stackType: {
      type: String,
      enum: ['fixed', 'fluid'],
      required: true,
    },
    durationMonths: {
      type: Number,
      enum: VALID_DURATIONS,
      required: true,
    },
    interestRate: {
      type: Number,
      required: true,
      min: 0,
    },
    monthlyInterestAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    interestAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    expectedReturn: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: VALID_STATUSES,
      default: 'active',
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    maturesAt: {
      type: Date,
      required: true,
    },
    claimedAt: {
      type: Date,
    },
    interestHistory: {
      type: [interestHistoryEntrySchema],
      default: [],
    },
    withdrawal: {
      type: withdrawalNoticeSchema,
      default: () => ({}),
    },
    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);

stakingPositionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('StakingPosition', stakingPositionSchema);
