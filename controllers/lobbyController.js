const crypto = require('crypto');
const Bracket = require('../models/Bracket');
const User = require('../models/User');
const { sendInviteEmail } = require('../utils/email');
const { TEST_EMAIL_RE } = require('../utils/testEmail');

/**
 * Generate an 8-char uppercase alphanumeric invite code.
 * Uses crypto.randomBytes for sufficient randomness.
 *
 * @returns {string}
 */
function generateInviteCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * POST /api/brackets
 * Create a new bracket and send an invite email to Owner 2.
 */
async function createBracket(req, res) {
  const { owner1Name, owner2Name, owner2Email } = req.body;

  // Body validation
  if (!owner1Name || typeof owner1Name !== 'string' || !owner1Name.trim()) {
    return res.status(400).json({ error: 'owner1Name is required' });
  }
  if (!owner2Name || typeof owner2Name !== 'string' || !owner2Name.trim()) {
    return res.status(400).json({ error: 'owner2Name is required' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!owner2Email || !emailRegex.test(owner2Email)) {
    return res.status(400).json({ error: 'A valid owner2Email is required' });
  }

  const inviteCode = generateInviteCode();
  const user = await User.findOne({ id: req.userId });

  let bracket;
  try {
    bracket = await Bracket.create({
      name: `${owner1Name.trim()} & ${owner2Name.trim()}`,
      owner1UserId: req.userId,
      owner1Name: owner1Name.trim(),
      owner1Icon: user?.icon || '👤',
      owner2Name: owner2Name.trim(),
      owner2Email: owner2Email.trim(),
      inviteCode,
      status: 'draft'
    });
  } catch (err) {
    // Retry once on unique constraint violation (rare collision)
    if (err.code === 11000 && err.keyPattern && err.keyPattern.inviteCode) {
      const retryCode = generateInviteCode();
      bracket = await Bracket.create({
        name: `${owner1Name.trim()} & ${owner2Name.trim()}`,
        owner1UserId: req.userId,
        owner1Name: owner1Name.trim(),
        owner1Icon: user?.icon || '👤',
        owner2Name: owner2Name.trim(),
        owner2Email: owner2Email.trim(),
        inviteCode: retryCode,
        status: 'draft'
      });
    } else {
      throw err;
    }
  }

  // Fire-and-forget — do not block the response on email delivery
  sendInviteEmail(owner2Email.trim(), bracket.inviteCode).catch(console.error);

  return res.status(201).json({
    bracket: {
      id: bracket._id,
      inviteCode: bracket.inviteCode,
      owner1Name: bracket.owner1Name,
      owner2Name: bracket.owner2Name,
      status: bracket.status
    }
  });
}

/**
 * GET /api/brackets/mine
 * Return brackets the authenticated user owns (as Owner 1 or Owner 2)
 * and brackets where they are a guest.
 */
async function listMyBrackets(req, res) {
  const userId = req.userId;
  const projection = '_id name inviteCode owner1Name owner2Name status currentRound createdAt';

  const user = await User.findOne({ id: userId }, 'email').lean();
  const isTestUser = TEST_EMAIL_RE.test(user?.email);

  const queries = [
    Bracket.find(
      { $or: [{ owner1UserId: userId }, { owner2UserId: userId }] },
      projection
    ).lean(),
    Bracket.find(
      { guestUserIds: userId },
      projection
    ).lean(),
  ];

  if (isTestUser) {
    queries.push(Bracket.find({ status: 'active' }, projection).lean());
  }

  const results = await Promise.all(queries);
  const [owned, guest] = results;
  const response = { owned, guest };

  if (isTestUser) {
    response.allActive = results[2];
  }

  return res.status(200).json(response);
}

/**
 * POST /api/brackets/join
 * Join an existing bracket as a guest via invite code.
 */
async function joinBracket(req, res) {
  const { inviteCode } = req.body;

  if (!inviteCode || typeof inviteCode !== 'string' || !inviteCode.trim()) {
    return res.status(400).json({ error: 'inviteCode is required' });
  }

  const bracket = await Bracket.findOne({ inviteCode: inviteCode.trim() });
  if (!bracket) {
    return res.status(404).json({ error: 'Invalid invite code' });
  }

  const userId = req.userId;

  if (bracket.owner1UserId === userId || bracket.owner2UserId === userId) {
    return res.status(400).json({ error: 'You are already an owner of this bracket' });
  }

  if (bracket.guestUserIds.includes(userId)) {
    return res.status(400).json({ error: 'Already joined' });
  }

  bracket.guestUserIds.push(userId);
  await bracket.save();

  return res.status(200).json({
    bracket: {
      id: bracket._id,
      inviteCode: bracket.inviteCode,
      owner1Name: bracket.owner1Name,
      owner2Name: bracket.owner2Name,
      status: bracket.status
    }
  });
}

/**
 * GET /api/brackets/:inviteCode/accept-owner
 * Claim the Owner 2 seat when clicking an invite link.
 */
async function acceptOwner2(req, res) {
  const { inviteCode } = req.params;

  const bracket = await Bracket.findOne({ inviteCode });
  if (!bracket) {
    return res.status(404).json({ error: 'Bracket not found' });
  }

  const userId = req.userId;

  // Seat already claimed by someone else
  if (bracket.owner2UserId && bracket.owner2UserId !== userId) {
    return res.status(409).json({ error: 'Owner 2 seat already claimed' });
  }

  const user = await User.findOne({ id: userId });

  // Idempotent — already this user, just return the bracket
  bracket.owner2UserId = userId;
  bracket.owner2Icon = user?.icon || '👤';
  await bracket.save();

  return res.status(200).json({
    bracket: {
      id: bracket._id,
      inviteCode: bracket.inviteCode,
      owner1Name: bracket.owner1Name,
      owner2Name: bracket.owner2Name,
      status: bracket.status
    }
  });
}

module.exports = { createBracket, listMyBrackets, joinBracket, acceptOwner2 };
