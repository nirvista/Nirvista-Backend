const mongoose = require('mongoose');

const mobileChangeRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    newMobile: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    reviewedAt: {
      type: Date,
    },
    reviewer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewNote: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
);

mobileChangeRequestSchema.index({ user: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('MobileChangeRequest', mobileChangeRequestSchema);
