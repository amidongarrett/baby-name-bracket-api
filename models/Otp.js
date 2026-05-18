const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 }, // MongoDB TTL — auto-deletes expired docs
    },
    used: {
      type: Boolean,
      default: false,
    },
  },
  { versionKey: false }
);

module.exports = mongoose.model('Otp', otpSchema);
