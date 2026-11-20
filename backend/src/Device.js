import mongoose from "mongoose";

const deviceSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },

        deviceId: {
            type: String,
            required: true
        },

        deviceName: {
            type: String,
            default: "Unknown device"
        },

        refreshTokenHash: {
            type: String,
            required: true,
            select: false
        },

        expiresAt: {
            type: Date,
            required: true
        },

        revokedAt: {
            type: Date,
            default: null
        }
    },
    { timestamps: true }
);

deviceSchema.index(
    { userId: 1, deviceId: 1 },
    { unique: true }
);

export default mongoose.model("Device", deviceSchema);