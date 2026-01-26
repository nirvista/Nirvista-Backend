const mongoose = require('mongoose');

const walletAccountSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    unique: true,
    required: true,
  },
  balance: {
    type: Number,
    default: 0,
    min: 0,
  },
  currency: {
    type: String,
    default: 'INR',
    uppercase: true,
  },
  totalCredited: {
    type: Number,
    default: 0,
    min: 0,
  },
  totalDebited: {
    type: Number,
    default: 0,
    min: 0,
  },
  pendingWithdrawals: {
    type: Number,
    default: 0,
    min: 0,
  },
  metadata: mongoose.Schema.Types.Mixed,
}, {
  timestamps: true,
});

module.exports = mongoose.model('WalletAccount', walletAccountSchema);
