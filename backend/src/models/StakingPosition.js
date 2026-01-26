const mongoose = require('mongoose');

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
    interestRate: {
      type: Number,
      required: true,
      min: 0,
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
      enum: ['active', 'matured', 'claimed', 'cancelled'],
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
    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);

stakingPositionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('StakingPosition', stakingPositionSchema);
