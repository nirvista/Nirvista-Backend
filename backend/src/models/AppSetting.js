const mongoose = require('mongoose');

const appSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    description: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
);

const AppSetting = mongoose.model('AppSetting', appSettingSchema);

module.exports = AppSetting;
