const jwt = require('jsonwebtoken');
const pool = require('../dbconfig');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

module.exports = async function (req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided.' });
  }

  try {
    // 1️⃣ Verify JWT
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    // 2️⃣ Check token against DB (single-device check)
    const client = await pool.connect();
    const result = await client.query(
      `SELECT active_token FROM users WHERE id = $1`,
      [decoded.userId]
    );
    client.release();

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found.' });
    }

    // 🚫 Logged in on another device
    if (result.rows[0].active_token !== token) {
      return res.status(401).json({
        error: 'Session expired. You are logged in on another device.'
      });
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};
