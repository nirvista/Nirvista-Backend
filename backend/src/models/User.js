const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const addressSchema = new mongoose.Schema({
  label: {
    type: String,
    trim: true,
  },
  fullName: {
    type: String,
    trim: true,
  },
  phone: {
    type: String,
    trim: true,
  },
  line1: {
    type: String,
    trim: true,
  },
  line2: {
    type: String,
    trim: true,
  },
  city: {
    type: String,
    trim: true,
  },
  state: {
    type: String,
    trim: true,
  },
  postalCode: {
    type: String,
    trim: true,
  },
  country: {
    type: String,
    default: 'IN',
    trim: true,
  },
  landmark: {
    type: String,
    trim: true,
  },
  isDefault: {
    type: Boolean,
    default: false,
  },
});

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  nameUpdatedAt: {
    type: Date,
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
  },
  mobile: {
    type: String,
    trim: true,
  },
  password: {
    type: String,
  },
  pin: {
    type: String,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  activatedAt: {
    type: Date,
  },
  disabledAt: {
    type: Date,
  },
  disabledReason: {
    type: String,
    trim: true,
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
  },
  country: {
    type: String,
    default: 'IN',
    uppercase: true,
    trim: true,
  },
  referralCode: {
    type: String,
    trim: true,
    uppercase: true,
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  referralPath: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  referralLevel: {
    type: Number,
    default: 0,
    min: 0,
    max: 8,
  },
  referralDownlineCounts: {
    type: [Number],
    default: () => Array(9).fill(0), // depth 0-8
  },
  referralWalletBalance: {
    type: Number,
    default: 0,
  },
  referralTotalEarned: {
    type: Number,
    default: 0,
  },
  rewardsWalletBalance: {
    type: Number,
    default: 0,
    min: 0,
  },
  pendingEmail: {
    type: String,
    trim: true,
    lowercase: true,
  },
  pendingEmailRequestedAt: {
    type: Date,
  },
  bankDetails: {
    accountHolderName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    ifsc: { type: String, trim: true, uppercase: true },
    bankName: { type: String, trim: true },
    verified: { type: Boolean, default: false },
    addedAt: { type: Date },
    addedBy: { type: String, enum: ['user', 'admin'], default: 'user' },
  },
  upiDetails: {
    upiId: { type: String, trim: true, lowercase: true },
    verified: { type: Boolean, default: false },
    addedAt: { type: Date },
    addedBy: { type: String, enum: ['user', 'admin'], default: 'user' },
  },
  profileImageUrl: {
    type: String,
    trim: true,
  },
  profileImagePublicId: {
    type: String,
    trim: true,
  },
  profileImageSetAt: {
    type: Date,
  },
  addresses: [addressSchema],
  isEmailVerified: {
    type: Boolean,
    default: false,
  },
  isMobileVerified: {
    type: Boolean,
    default: false,
  },
  otp: {
    code: {
      type: String,
    },
    expiresAt: {
      type: Date,
    },
    channel: {
      type: String,
      enum: ['email', 'mobile'],
    },
    purpose: {
      type: String,
      trim: true,
    },
  },
}, {
  timestamps: true,
});

// Ensure unique constraints only apply when values exist
userSchema.index(
  { email: 1 },
  { unique: true, sparse: true, partialFilterExpression: { email: { $exists: true, $ne: null } } },
);
userSchema.index(
  { mobile: 1 },
  { unique: true, sparse: true, partialFilterExpression: { mobile: { $exists: true, $ne: null } } },
);
userSchema.index(
  { referralCode: 1 },
  { unique: true, sparse: true, partialFilterExpression: { referralCode: { $exists: true, $ne: null } } },
);

// Match Password
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Match PIN
userSchema.methods.matchPin = async function(enteredPin) {
  return await bcrypt.compare(enteredPin, this.pin);
};

const User = mongoose.model('User', userSchema);

module.exports = User;
