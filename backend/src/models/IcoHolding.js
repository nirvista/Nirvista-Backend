const mongoose = require('mongoose');

const icoHoldingSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    unique: true,
    required: true,
  },
  balance: {
    type: Number,
    default: 0,
  },
  averageBuyPrice: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('IcoHolding', icoHoldingSchema);
