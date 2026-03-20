const mongoose = require('mongoose');

const preIcoStageSchema = new mongoose.Schema(
  {
    stageName: {
      type: String,
      required: true,
      trim: true,
    },
    tokenPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    bonusPercent: {
      type: Number,
      default: 0,
      min: 0,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    allocationLimit: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    autoSwitch: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

preIcoStageSchema.index({ startDate: 1, endDate: 1 });
preIcoStageSchema.index({ isActive: 1 });

module.exports = mongoose.model('PreIcoStage', preIcoStageSchema);