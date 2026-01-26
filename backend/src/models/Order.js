const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
  },
  name: String,
  sku: String,
  image: String,
  price: Number,
  currency: {
    type: String,
    default: 'INR',
  },
  quantity: Number,
  subtotal: Number,
}, { _id: false });

const addressSnapshotSchema = new mongoose.Schema({
  name: String,
  line1: String,
  line2: String,
  city: String,
  state: String,
  postalCode: String,
  country: String,
  phone: String,
}, { _id: false });

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  items: [orderItemSchema],
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending',
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'initiated', 'paid', 'failed', 'refunded'],
    default: 'pending',
  },
  paymentMethod: {
    type: String,
    enum: ['cod', 'phonepe'],
    default: 'phonepe',
  },
  totals: {
    subtotal: Number,
    shipping: {
      type: Number,
      default: 0,
    },
    taxes: {
      type: Number,
      default: 0,
    },
    grandTotal: Number,
    currency: {
      type: String,
      default: 'INR',
    },
  },
  shippingAddress: addressSnapshotSchema,
  billingAddress: addressSnapshotSchema,
  phonePeOrderId: String,
  phonePePaymentLink: String,
  phonePePayload: mongoose.Schema.Types.Mixed,
}, {
  timestamps: true,
});

module.exports = mongoose.model('Order', orderSchema);
