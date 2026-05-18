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

module.exports = { requireAuth };
