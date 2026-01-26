const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
  url: String,
  altText: String,
}, { _id: false });

const attributeSchema = new mongoose.Schema({
  key: String,
  value: String,
}, { _id: false });

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  salePrice: {
    type: Number,
    min: 0,
  },
  currency: {
    type: String,
    default: 'INR',
  },
  stock: {
    type: Number,
    default: 0,
    min: 0,
  },
  sku: {
    type: String,
    trim: true,
    unique: true,
    sparse: true,
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
  },
  attributes: [attributeSchema],
  images: [imageSchema],
  isActive: {
    type: Boolean,
    default: true,
  },
  rating: {
    type: Number,
    default: 0,
  },
  ratingCount: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Product', productSchema);
