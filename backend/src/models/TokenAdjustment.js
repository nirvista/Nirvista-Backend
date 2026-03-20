const mongoose = require('mongoose');

const tokenAdjustmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    adjustmentType: {
      type: String,
      enum: ['bonus', 'adjustment', 'manual_allocation'],
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);

tokenAdjustmentSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('TokenAdjustment', tokenAdjustmentSchema);