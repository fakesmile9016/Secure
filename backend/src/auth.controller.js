import crypto from "crypto";
import jwt from "jsonwebtoken";

import User from "../models/User.js";
import Device from "../models/Device.js";
import OtpChallenge from "../models/OtpChallenge.js";

import {
    generateOTP,
    hashOTP,
    sendOTP
} from "../services/otp.service.js";

const hashToken = (token) =>
    crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");

const normalizePhone = (phone) => {
    if (typeof phone !== "string") return null;

    const normalized = phone.replace(/[\s()-]/g, "");

    return /^\+[1-9]\d{7,14}$/.test(normalized)
        ? normalized
        : null;
};

const createAccessToken = (user, deviceId) => {
    return jwt.sign(
        { deviceId },
        process.env.JWT_ACCESS_SECRET,
        {
            subject: user._id.toString(),
            expiresIn: "15m",
            algorithm: "HS256"
        }
    );
};

// 1. Request OTP
export const requestOTP = async (req, res) => {
    try {
        const phone = normalizePhone(req.body.phone);

        if (!phone) {
            return res.status(400).json({
                message: "Use phone format +919876543210"
            });
        }

        const otp = generateOTP();

        await OtpChallenge.updateMany(
            { phone, consumed: false },
            { consumed: true }
        );

        const challenge = await OtpChallenge.create({
            phone,
            otpHash: hashOTP(phone, otp),
            expiresAt: new Date(Date.now() + 5 * 60 * 1000)
        });

        try {
            await sendOTP(phone, otp);
        } catch (error) {
            await OtpChallenge.deleteOne({ _id: challenge._id });
            throw error;
        }

        return res.json({
            message: "OTP sent successfully",
            challengeId: challenge._id
        });

    } catch (error) {
        console.error("OTP request error:", error.message);

        return res.status(500).json({
            message: "Unable to send OTP"
        });
    }
};

// 2. Verify OTP
export const verifyOTP = async (req, res) => {
    try {
        const { challengeId, otp, deviceId, deviceName } = req.body;

        if (
            !/^\d{6}$/.test(otp || "") ||
            typeof challengeId !== "string" ||
            !/^[a-f\d]{24}$/i.test(challengeId) ||
            typeof deviceId !== "string" ||
            deviceId.length < 8 ||
            deviceId.length > 128
        ) {
            return res.status(400).json({
                message: "Invalid verification details"
            });
        }

        const challenge = await OtpChallenge.findOne({
            _id: challengeId,
            consumed: false,
            expiresAt: { $gt: new Date() },
            attempts: { $lt: 5 }
        }).select("+otpHash");

        if (!challenge) {
            return res.status(400).json({
                message: "OTP expired or invalid"
            });
        }

        const suppliedHash = hashOTP(challenge.phone, otp);

        const valid = crypto.timingSafeEqual(
            Buffer.from(challenge.otpHash, "hex"),
            Buffer.from(suppliedHash, "hex")
        );

        if (!valid) {
            challenge.attempts += 1;
            await challenge.save();

            return res.status(400).json({
                message: "Incorrect OTP"
            });
        }

        challenge.consumed = true;
        await challenge.save();

        let user = await User.findOne({
            phone: challenge.phone
        });

        if (!user) {
            user = await User.create({
                phone: challenge.phone,
                isVerified: true
            });
        } else {
            user.isVerified = true;
            await user.save();
        }

        if (!user.isActive) {
            return res.status(403).json({
                message: "Account is disabled"
            });
        }

        const accessToken = createAccessToken(user, deviceId);

        const refreshToken = crypto
            .randomBytes(48)
            .toString("base64url");

        const expiresAt = new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000
        );

        await Device.findOneAndUpdate(
            {
                userId: user._id,
                deviceId
            },
            {
                $set: {
                    deviceName: String(deviceName || "Unknown device").slice(0, 80),
                    refreshTokenHash: hashToken(refreshToken),
                    expiresAt,
                    revokedAt: null
                }
            },
            { upsert: true, new: true, runValidators: true }
        );

        return res.json({
            message: "Login successful",
            accessToken,
            refreshToken,
            user: {
                id: user._id,
                phone: user.phone,
                name: user.name
            }
        });

    } catch (error) {
        console.error("OTP verification error:", error.message);

        return res.status(500).json({
            message: "Verification failed"
        });
    }
};

// 3. Refresh access token
export const refreshSession = async (req, res) => {
    try {
        const { refreshToken, deviceId } = req.body;

        if (
            typeof refreshToken !== "string" ||
            typeof deviceId !== "string"
        ) {
            return res.status(400).json({
                message: "Invalid refresh details"
            });
        }

        const device = await Device.findOne({
            deviceId,
            revokedAt: null,
            expiresAt: { $gt: new Date() }
        }).select("+refreshTokenHash");

        if (
            !device ||
            !crypto.timingSafeEqual(
                Buffer.from(device.refreshTokenHash, "hex"),
                Buffer.from(hashToken(refreshToken), "hex")
            )
        ) {
            return res.status(401).json({
                message: "Session expired. Login again."
            });
        }

        const user = await User.findById(device.userId);

        if (!user || !user.isActive) {
            return res.status(401).json({
                message: "Account unavailable"
            });
        }

        const nextRefreshToken = crypto
            .randomBytes(48)
            .toString("base64url");

        device.refreshTokenHash = hashToken(nextRefreshToken);
        device.expiresAt = new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000
        );

        await device.save();

        return res.json({
            accessToken: createAccessToken(user, deviceId),
            refreshToken: nextRefreshToken
        });

    } catch (error) {
        console.error("Refresh error:", error.message);

        return res.status(500).json({
            message: "Unable to refresh session"
        });
    }
};

// 4. Logout current device
export const logout = async (req, res) => {
    try {
        await Device.updateOne(
            {
                userId: req.user.userId,
                deviceId: req.user.deviceId
            },
            {
                $set: {
                    revokedAt: new Date(),
                    refreshTokenHash: crypto.randomBytes(32).toString("hex")
                }
            }
        );

        return res.json({
            message: "Logged out successfully"
        });

    } catch {
        return res.status(500).json({
            message: "Logout failed"
        });
    }
};

// 5. Current user
export const me = async (req, res) => {
    const user = await User.findById(req.user.userId)
        .select("phone name avatar isVerified createdAt");

    if (!user) {
        return res.status(404).json({
            message: "User not found"
        });
    }

    return res.json({ user });
};