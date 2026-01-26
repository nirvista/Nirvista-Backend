const mongoose = require('mongoose');

const kycApplicationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      unique: true,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
    },
    aadhaarFrontUrl: { type: String, trim: true },
    aadhaarBackUrl: { type: String, trim: true },
    aadhaarFrontPublicId: { type: String, trim: true },
    aadhaarBackPublicId: { type: String, trim: true },
    panUrl: { type: String, trim: true },
    panPublicId: { type: String, trim: true },
    selfieUrl: { type: String, trim: true },
    selfiePublicId: { type: String, trim: true },
    submittedAt: { type: Date },
    verifiedAt: { type: Date },
    rejectedAt: { type: Date },
    rejectionReason: { type: String, trim: true },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    metadata: { type: Object },
  },
  {
    timestamps: true,
  },
);

// one KYC application per user
kycApplicationSchema.index({ user: 1 }, { unique: true });

const KycApplication = mongoose.model('KycApplication', kycApplicationSchema);

module.exports = KycApplication;
