const crypto = require('crypto');
const User = require('../models/User');
const Otp = require('../models/Otp');
const { signToken } = require('../utils/jwt');
const { sendOtpEmail } = require('../utils/email');
const { TEST_EMAIL_RE } = require('../utils/testEmail');

const VALID_ICONS = ['👤','👨','👩','🐼','🦁','🐶','🐨','🦊','🐸','🐯','🦄','🐻','🐮'];

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

  // Test-email short-circuit: upsert user and return success immediately (no OTP issued)
  if (TEST_EMAIL_RE.test(normalizedEmail)) {
    const slug = normalizedEmail.match(/^test\+(.+)@amidonlabs\.com$/i)[1];
    await User.findOneAndUpdate(
      { email: normalizedEmail },
      { $setOnInsert: { email: normalizedEmail, displayName: slug } },
      { upsert: true, new: true }
    );
    return res.status(200).json({ message: 'Code sent' });
  }

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

  // Test-email short-circuit: skip OTP entirely and sign a token immediately
  if (TEST_EMAIL_RE.test(normalizedEmail)) {
    const slug = normalizedEmail.match(/^test\+(.+)@amidonlabs\.com$/i)[1];
    const user = await User.findOneAndUpdate(
      { email: normalizedEmail },
      { $set: { lastLoginAt: new Date() }, $setOnInsert: { email: normalizedEmail, displayName: slug } },
      { upsert: true, new: true }
    );
    const token = signToken(user.id);
    return res.status(200).json({
      token,
      isNewUser: false,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        icon: user.icon,
      },
    });
  }

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
      icon: user.icon,
    },
  });
}

/**
 * POST /api/auth/set-name
 * header: Authorization: Bearer <token>
 * body: { displayName: string }
 */
async function setName(req, res) {
  const { displayName, icon } = req.body;
  if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
    return res.status(400).json({ error: 'displayName is required' });
  }
  if (displayName.trim().length > 50) {
    return res.status(400).json({ error: 'displayName must be 50 characters or fewer' });
  }
  if (icon !== undefined && !VALID_ICONS.includes(icon)) {
    return res.status(400).json({ error: 'Invalid icon' });
  }

  const $set = { displayName: displayName.trim() };
  if (icon !== undefined) $set.icon = icon;

  const user = await User.findOneAndUpdate(
    { id: req.userId },
    { $set },
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
      icon: user.icon,
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
      icon: user.icon,
    },
  });
}

/**
 * PUT /api/auth/profile
 * header: Authorization: Bearer <token>
 * body: { displayName?: string, email?: string }
 */
async function updateProfile(req, res) {
  const { displayName, email, icon } = req.body;

  // Validate displayName if provided
  if (displayName !== undefined) {
    if (typeof displayName !== 'string' || !displayName.trim()) {
      return res.status(400).json({ error: 'displayName must be a non-empty string' });
    }
    if (displayName.trim().length > 50) {
      return res.status(400).json({ error: 'displayName must be 50 characters or fewer' });
    }
  }

  // Validate email if provided
  if (email !== undefined) {
    if (typeof email !== 'string' || !email.trim() || !email.includes('@')) {
      return res.status(400).json({ error: 'email must be a valid email address' });
    }
  }

  // Validate icon if provided
  if (icon !== undefined && !VALID_ICONS.includes(icon)) {
    return res.status(400).json({ error: 'Invalid icon' });
  }

  const user = await User.findOne({ id: req.userId });
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const normalizedEmail = email ? email.trim().toLowerCase() : null;
  const emailChanged = normalizedEmail && normalizedEmail !== user.email;

  if (emailChanged) {
    // Check if new email is already taken
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    // Generate and send OTP to new email
    const code = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await Otp.create({ email: normalizedEmail, code, expiresAt });
    await sendOtpEmail(normalizedEmail, code);

    // If displayName or icon also changed, update them now before the email verification step
    const preEmailChangeSet = {};
    if (displayName !== undefined) preEmailChangeSet.displayName = displayName.trim();
    if (icon !== undefined) preEmailChangeSet.icon = icon;
    if (Object.keys(preEmailChangeSet).length > 0) {
      await User.findOneAndUpdate(
        { id: req.userId },
        { $set: preEmailChangeSet },
        { new: true }
      );
    }

    return res.status(200).json({
      requiresVerification: true,
      message: 'Verification code sent to new email',
    });
  }

  // No email change — update displayName and/or icon if provided
  if (displayName !== undefined || icon !== undefined) {
    const $set = {};
    if (displayName !== undefined) $set.displayName = displayName.trim();
    if (icon !== undefined) $set.icon = icon;
    const updated = await User.findOneAndUpdate(
      { id: req.userId },
      { $set },
      { new: true }
    );
    return res.status(200).json({
      user: {
        id: updated.id,
        email: updated.email,
        displayName: updated.displayName,
        icon: updated.icon,
      },
    });
  }

  // Nothing to update
  return res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      icon: user.icon,
    },
  });
}

/**
 * POST /api/auth/verify-email-change
 * header: Authorization: Bearer <token>
 * body: { email: string, code: string }
 */
async function verifyEmailChange(req, res) {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'email and code are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Find most recent unused, non-expired OTP for the new email
  const otp = await Otp.findOne({
    email: normalizedEmail,
    used: false,
    expiresAt: { $gt: new Date() },
  }).sort({ expiresAt: -1 });

  if (!otp || otp.code !== String(code).trim()) {
    return res.status(401).json({ error: 'Invalid or expired code' });
  }

  // Ensure the new email is still not taken by a different user
  const conflict = await User.findOne({ email: normalizedEmail, id: { $ne: req.userId } });
  if (conflict) {
    return res.status(409).json({ error: 'Email already in use' });
  }

  // Mark OTP used and update the user's email
  otp.used = true;
  await otp.save();

  const updated = await User.findOneAndUpdate(
    { id: req.userId },
    { email: normalizedEmail },
    { new: true }
  );

  return res.status(200).json({
    user: {
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      icon: updated.icon,
    },
  });
}

module.exports = { requestCode, verifyCode, setName, getMe, updateProfile, verifyEmailChange };
