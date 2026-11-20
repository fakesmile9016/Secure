import mongoose from "mongoose";

const otpSchema = new mongoose.Schema(
    {
        phone: {
            type: String,
            required: true
        },

        otpHash: {
            type: String,
            required: true,
            select: false
        },

        expiresAt: {
            type: Date,
            required: true
        },

        attempts: {
            type: Number,
            default: 0
        },

        consumed: {
            type: Boolean,
            default: false
        }
    },
    { timestamps: true }
);

otpSchema.index(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
);

export default mongoose.model("OtpChallenge", otpSchema);