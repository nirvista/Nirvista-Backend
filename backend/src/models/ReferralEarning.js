const mongoose = require('mongoose');

const referralEarningSchema = new mongoose.Schema({
  earner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  sourceUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  sourceType: {
    type: String,
    enum: ['ico', 'order'],
    required: true,
  },
  sourceId: {
    type: String,
    required: true,
  },
  depth: {
    type: Number,
    required: true,
    min: 0,
    max: 8,
  },
  percentage: {
    type: Number,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  currency: {
    type: String,
    default: 'INR',
  },
  status: {
    type: String,
    enum: ['pending', 'released', 'reversed'],
    default: 'released',
  },
  reviewer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  reviewedAt: {
    type: Date,
  },
  adminNote: {
    type: String,
    trim: true,
  },
}, {
  timestamps: true,
});

referralEarningSchema.index(
  { earner: 1, sourceId: 1, sourceType: 1, depth: 1 },
  { unique: true },
);

module.exports = mongoose.model('ReferralEarning', referralEarningSchema);
