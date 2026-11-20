import crypto from "crypto";
import nodemailer from "nodemailer";
import OtpChallenge from "../models/OtpChallenge.js";

// Generate a random OTP code
const generateOtp = (length = parseInt(process.env.OTP_LENGTH, 10) || 6) => {
  return crypto.randomInt(10 ** (length - 1), 10 ** length).toString();
};

// Create nodemailer transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

// Send OTP via email
const sendOtpEmail = async (email, otp) => {
  const transporter = createTransporter();
  const mailOptions = {
    from: process.env.SMTP_USER,
    to: email,
    subject: 'Your SecureChat Verification Code',
    text: `Your verification code is: ${otp}. It will expire in ${parseInt(process.env.OTP_EXPIRY, 10) || 300} seconds.`,
    html: `<p>Your SecureChat verification code is: <strong>${otp}</strong></p><p>It will expire in ${parseInt(process.env.OTP_EXPIRY, 10) || 300} seconds.</p>`,
  };

  await transporter.sendMail(mailOptions);
};

// Create a new OTP challenge for a user
const createOtpChallenge = async (userId, email) => {
  // Invalidate any existing unused OTPs
  await OtpChallenge.updateMany(
    { user: userId, isUsed: false },
    { isUsed: true }
  );

  const otp = generateOtp();
  const expirySeconds = parseInt(process.env.OTP_EXPIRY, 10) || 300;
  const expiresAt = new Date(Date.now() + expirySeconds * 1000);

  const challenge = await OtpChallenge.create({
    user: userId,
    otp,
    expiresAt,
  });

  // Send OTP to user's email
  await sendOtpEmail(email, otp);

  return challenge;
};

// Verify an OTP code
const verifyOtp = async (userId, code) => {
  // Find the latest unused, non-expired challenge for the user
  const challenge = await OtpChallenge.findOne({
    user: userId,
    isUsed: false,
  }).select('+otp');

  if (!challenge) {
    return { success: false, message: 'No OTP challenge found. Request a new one.' };
  }

  // Check if expired
  if (challenge.isExpired()) {
    return { success: false, message: 'OTP has expired. Request a new one.' };
  }

  // Check max attempts
  if (challenge.isMaxAttemptsReached()) {
    return { success: false, message: 'Too many failed attempts. Request a new OTP.' };
  }

  // Verify the code
  if (challenge.otp !== code) {
    challenge.attempts += 1;
    await challenge.save();
    return { success: false, message: 'Invalid OTP code.' };
  }

  // Mark as used
  challenge.isUsed = true;
  await challenge.save();

  return { success: true, message: 'OTP verified successfully.' };
};

export {
  generateOtp,
  createOtpChallenge,
  verifyOtp,
};
