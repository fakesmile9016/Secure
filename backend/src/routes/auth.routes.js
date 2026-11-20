import express from "express";
import {
  register,
  verifyRegistrationOtp,
  login,
  verifyLoginOtp,
  requestOtp,
  enableOtp,
  disableOtp,
  getDevices,
  removeDevice,
} from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";

const router = express.Router();

// Public routes
router.post('/register', register);
router.post('/verify-registration', verifyRegistrationOtp);
router.post('/login', login);
router.post('/verify-login-otp', verifyLoginOtp);
router.post('/request-otp', requestOtp);

// Protected routes (require authentication)
router.post('/enable-otp', authenticate, enableOtp);
router.post('/disable-otp', authenticate, disableOtp);
router.get('/devices', authenticate, getDevices);
router.delete('/devices/:deviceId', authenticate, removeDevice);

export default router;
