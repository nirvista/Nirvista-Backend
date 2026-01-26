const mongoose = require('mongoose');

const icoTransactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  type: {
    type: String,
    enum: ['buy', 'sell'],
    required: true,
  },
  tokenAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  pricePerToken: {
    type: Number,
    required: true,
  },
  fiatAmount: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: 'INR',
  },
  status: {
    type: String,
    enum: ['pending', 'initiated', 'completed', 'failed', 'cancelled'],
    default: 'pending',
  },
  paymentReference: String,
  phonePeTransactionId: String,
  metadata: mongoose.Schema.Types.Mixed,
}, {
  timestamps: true,
});

module.exports = mongoose.model('IcoTransaction', icoTransactionSchema);
