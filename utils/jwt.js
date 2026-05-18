const jwt = require('jsonwebtoken');

/**
 * Sign a JWT for the given userId.
 * @param {string} userId - The user's UUID id field.
 * @returns {string} Signed JWT string.
 */
function signToken(userId) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return jwt.sign({ sub: userId }, secret, { expiresIn: '7d' });
}

/**
 * Verify a JWT and return its decoded payload.
 * @param {string} token
 * @returns {{ sub: string }} Decoded payload.
 * @throws On invalid or expired token.
 */
function verifyToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return jwt.verify(token, secret);
}

module.exports = { signToken, verifyToken };
