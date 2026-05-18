const crypto = require('crypto');
const User = require('../models/User');
const Otp = require('../models/Otp');
const { signToken } = require('../utils/jwt');
const { sendOtpEmail } = require('../utils/email');

/**
 * POST /api/auth/request-code
 * body: { email: string }
 */
async function requestCode(req, res) {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'email is required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Upsert user so we have a record ready
  await User.findOneAndUpdate(
    { email: normalizedEmail },
    { $setOnInsert: { email: normalizedEmail } },
    { upsert: true, new: true }
  );

  // Generate 6-digit code (padded to always be 6 chars)
  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await Otp.create({ email: normalizedEmail, code, expiresAt });

  await sendOtpEmail(normalizedEmail, code);

  return res.status(200).json({ message: 'Code sent' });
}

/**
 * POST /api/auth/verify-code
 * body: { email: string, code: string }
 */
async function verifyCode(req, res) {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'email and code are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Find the most recent, unused, non-expired OTP for this email
  const otp = await Otp.findOne({
    email: normalizedEmail,
    used: false,
    expiresAt: { $gt: new Date() },
  }).sort({ expiresAt: -1 });

  if (!otp || otp.code !== String(code).trim()) {
    return res.status(401).json({ error: 'Invalid or expired code' });
  }

  // Mark OTP as used
  otp.used = true;
  await otp.save();

  // Update user's last login
  const user = await User.findOneAndUpdate(
    { email: normalizedEmail },
    { lastLoginAt: new Date() },
    { new: true }
  );

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const isNewUser = !user.displayName;
  const token = signToken(user.id);

  return res.status(200).json({
    token,
    isNewUser,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    },
  });
}

/**
 * POST /api/auth/set-name
 * header: Authorization: Bearer <token>
 * body: { displayName: string }
 */
async function setName(req, res) {
  const { displayName } = req.body;
  if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
    return res.status(400).json({ error: 'displayName is required' });
  }
  if (displayName.trim().length > 50) {
    return res.status(400).json({ error: 'displayName must be 50 characters or fewer' });
  }

  const user = await User.findOneAndUpdate(
    { id: req.userId },
    { displayName: displayName.trim() },
    { new: true }
  );

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    },
  });
}

/**
 * GET /api/auth/me
 * header: Authorization: Bearer <token>
 */
async function getMe(req, res) {
  const user = await User.findOne({ id: req.userId });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    },
  });
}

module.exports = { requestCode, verifyCode, setName, getMe };
