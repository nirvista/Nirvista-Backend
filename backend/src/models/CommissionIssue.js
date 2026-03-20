const mongoose = require('mongoose');

const commissionIssueSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    relatedTransaction: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved'],
      default: 'open',
    },
    notes: [
      {
        note: { type: String, trim: true },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        at: { type: Date, default: Date.now },
      },
    ],
    resolution: {
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      resolvedAt: Date,
      note: { type: String, trim: true },
    },
  },
  { timestamps: true },
);

commissionIssueSchema.index({ user: 1, createdAt: -1 });
commissionIssueSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('CommissionIssue', commissionIssueSchema);