import mongoose from "mongoose";

const otpChallengeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    otp: {
      type: String,
      required: true,
      select: false,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 3,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// TTL index: auto-delete expired OTPs
otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Check if OTP is expired
otpChallengeSchema.methods.isExpired = function () {
  return new Date() > this.expiresAt;
};

// Check if max attempts reached
otpChallengeSchema.methods.isMaxAttemptsReached = function () {
  return this.attempts >= this.maxAttempts;
};

const OtpChallenge =
  mongoose.models.OtpChallenge || mongoose.model("OtpChallenge", otpChallengeSchema);
export default OtpChallenge;
