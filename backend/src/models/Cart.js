const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  name: String,
  image: String,
  sku: String,
  price: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: 'INR',
  },
  quantity: {
    type: Number,
    default: 1,
    min: 1,
  },
});

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    unique: true,
    required: true,
  },
  items: [cartItemSchema],
  subtotal: {
    type: Number,
    default: 0,
  },
  currency: {
    type: String,
    default: 'INR',
  },
}, {
  timestamps: true,
});

cartSchema.methods.recalculate = function recalculate() {
  this.subtotal = this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
};

module.exports = mongoose.model('Cart', cartSchema);
