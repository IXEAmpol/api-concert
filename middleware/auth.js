const jwt = require('jsonwebtoken');
const { sql, dbConfig } = require('../imports/shared');

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ status: 'fail', message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key');

    // Optional: Attach the decoded payload directly to req.user
    req.user = decoded;

    next();
  } catch (err) {
    console.error('Auth error:', err.message);
    return res.status(401).json({ status: 'fail', message: 'Invalid or expired token' });
  }
};