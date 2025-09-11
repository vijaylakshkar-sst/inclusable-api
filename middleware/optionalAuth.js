// middleware/optionalAuth.js
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

module.exports = function (req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next(); // No token? Just continue without attaching req.user
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Attach user info if token is valid
  } catch (err) {
    // Optional: silently ignore or log error
    console.warn('Invalid token in optionalAuth:', err.message);
  }

  next(); // Always proceed
};
