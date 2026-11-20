import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Device from "../models/Device.js";
import { createOtpChallenge, verifyOtp } from "../services/otp.service.js";

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

// Register a new user
const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email or username already exists.',
      });
    }

    // Create user
    const user = await User.create({
      username,
      email,
      password,
    });

    // Send OTP for email verification
    await createOtpChallenge(user._id, user.email);

    res.status(201).json({
      success: true,
      message: 'User registered. Please verify your email with the OTP sent.',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Registration failed.',
    });
  }
};

// Verify OTP after registration
const verifyRegistrationOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    const result = await verifyOtp(user._id, otp);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    // Mark user as verified
    user.isVerified = true;
    await user.save();

    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Email verified successfully.',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'OTP verification failed.',
    });
  }
};

// Login with credentials
const login = async (req, res) => {
  try {
    const { email, password, deviceName, deviceType, userAgent } = req.body;

    // Find user and include password field
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.',
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.',
      });
    }

    // If OTP is enabled, send OTP challenge
    if (user.isOtpEnabled) {
      await createOtpChallenge(user._id, user.email);

      // Record device info
      await Device.create({
        user: user._id,
        deviceName: deviceName || 'Unknown Device',
        deviceType: deviceType || 'browser',
        ipAddress: req.ip,
        userAgent: userAgent || req.get('User-Agent') || '',
      });

      return res.json({
        success: true,
        message: 'OTP sent. Please verify to complete login.',
        requiresOtp: true,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
        },
      });
    }

    // No OTP required — generate token and return
    const token = generateToken(user._id);

    // Record device info
    await Device.create({
      user: user._id,
      deviceName: deviceName || 'Unknown Device',
      deviceType: deviceType || 'browser',
      ipAddress: req.ip,
      userAgent: userAgent || req.get('User-Agent') || '',
      otpVerified: true,
    });

    res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Login failed.',
    });
  }
};

// Verify OTP during login
const verifyLoginOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    const result = await verifyOtp(user._id, otp);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    // Mark the latest device as OTP verified
    const device = await Device.findOne({ user: user._id, otpVerified: false }).sort({ createdAt: -1 });
    if (device) {
      device.otpVerified = true;
      device.lastActive = new Date();
      await device.save();
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'OTP verified. Login successful.',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'OTP verification failed.',
    });
  }
};

// Request a new OTP
const requestOtp = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    await createOtpChallenge(user._id, user.email);

    res.json({
      success: true,
      message: 'A new OTP has been sent to your email.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send OTP.',
    });
  }
};

// Enable OTP for a user
const enableOtp = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    user.isOtpEnabled = true;
    await user.save();

    // Send test OTP
    await createOtpChallenge(user._id, user.email);

    res.json({
      success: true,
      message: 'OTP enabled. A test code has been sent to your email.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to enable OTP.',
    });
  }
};

// Disable OTP for a user
const disableOtp = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    user.isOtpEnabled = false;
    await user.save();

    res.json({
      success: true,
      message: 'OTP has been disabled.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to disable OTP.',
    });
  }
};

// Get user's trusted devices
const getDevices = async (req, res) => {
  try {
    const devices = await Device.find({ user: req.user.id }).sort({ createdAt: -1 });

    res.json({
      success: true,
      devices,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch devices.',
    });
  }
};

// Remove a device
const removeDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;

    const device = await Device.findOneAndDelete({
      _id: deviceId,
      user: req.user.id,
    });

    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Device not found.',
      });
    }

    res.json({
      success: true,
      message: 'Device removed successfully.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to remove device.',
    });
  }
};

export {
  register,
  verifyRegistrationOtp,
  login,
  verifyLoginOtp,
  requestOtp,
  enableOtp,
  disableOtp,
  getDevices,
  removeDevice,
};
