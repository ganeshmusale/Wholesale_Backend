const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('FATAL: JWT_SECRET environment variable is not defined.');
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user still exists and is active
    const [rows] = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_active, b.id AS business_id, b.business_name
       FROM users u
       LEFT JOIN businesses b ON b.user_id = u.id
       WHERE u.id = ?`,
      [decoded.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid token: User does not exist.' });
    }

    if (!rows[0].is_active) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated.' });
    }

    req.user = rows[0];
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.', error: error.message });
  }
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Requires one of the following roles: [${roles.join(', ')}]`
      });
    }
    next();
  };
};

module.exports = {
  verifyToken,
  authorizeRoles
};
