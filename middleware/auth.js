const { verifyToken } = require('../utils/jwt');

/**
 * Express middleware that enforces a valid Bearer JWT.
 * On success, attaches req.userId (the token's `sub` claim).
 * On failure, returns 401.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Express middleware that optionally extracts a Bearer JWT.
 * If a valid token is present, sets req.userId from the token's `sub` claim.
 * If the header is absent or the token is invalid, calls next() without setting req.userId.
 * Allows unauthenticated guest callers to proceed while still identifying owners.
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = verifyToken(token);
      req.userId = payload.sub;
    } catch { /* invalid token — treat as unauthenticated */ }
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
