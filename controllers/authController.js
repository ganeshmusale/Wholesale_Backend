const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { getPagination } = require('../utils/paginate');

// Generate JWT helper
const generateToken = (user) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable is not defined.');
  }
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email, phone: user.phone },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// Register User (and optionally Business)
exports.register = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const {
      full_name,
      email,
      phone,
      password,
      role,
      // Business fields (if registering as business_man)
      business_name,
      business_type = 'vegetable_shop',
      contact_person,
      shop_address,
      city,
      gst_number
    } = req.body;

    if (!full_name || !phone) {
      return res.status(400).json({ success: false, message: 'Name and phone are required.' });
    }

    // Password is required for admin/delivery; for shop owners (business_man), password is fully optional
    const allowedPublicRoles = ['business_man', 'delivery'];
    const assignedRole = allowedPublicRoles.includes(role) ? role : 'business_man';

    if (assignedRole !== 'business_man' && !password) {
      return res.status(400).json({ success: false, message: 'Password is required for delivery partners.' });
    }

    // Prevent privilege escalation: Reject any attempt to register as super_admin
    if (role === 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Role escalation forbidden. Administrator accounts cannot be created via public registration.'
      });
    }

    // Check if phone or email already exists
    const [existing] = await connection.query(
      'SELECT id FROM users WHERE phone = ? OR (email IS NOT NULL AND email = ?)',
      [phone, email || null]
    );

    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'User with this phone number or email already exists.' });
    }

    await connection.beginTransaction();

    // Hash password (use provided password or a secure randomized default hash for passwordless mobile users)
    const effectivePassword = password || `Shop_${phone}_${Math.random().toString(36).slice(-8)}`;
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(effectivePassword, salt);

    // Insert user (with city for location-based delivery matching)
    const [userResult] = await connection.query(
      'INSERT INTO users (full_name, email, phone, password_hash, role, city) VALUES (?, ?, ?, ?, ?, ?)',
      [full_name, email || null, phone, password_hash, assignedRole, city || null]
    );

    const userId = userResult.insertId;
    let businessId = null;

    // If role is business_man, create the business record
    if (assignedRole === 'business_man') {
      const bName = business_name || `${full_name}'s Store`;
      const bContact = contact_person || full_name;
      const bAddress = shop_address || 'Address pending';
      const bCity = city || 'City pending';

      const [businessResult] = await connection.query(
        `INSERT INTO businesses (user_id, business_name, business_type, contact_person, mobile_number, shop_address, city, gst_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, bName, business_type, bContact, phone, bAddress, bCity, gst_number || null]
      );
      businessId = businessResult.insertId;
    }

    await connection.commit();

    const newUser = {
      id: userId,
      full_name,
      email,
      phone,
      role: assignedRole,
      business_id: businessId
    };

    const token = generateToken(newUser);

    return res.status(201).json({
      success: true,
      message: 'User registered successfully.',
      data: {
        token,
        user: newUser
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Registration error:', error);
    return res.status(500).json({ success: false, message: 'Registration failed.', error: error.message });
  } finally {
    connection.release();
  }
};

// Login with Phone or Email + Password
exports.login = async (req, res) => {
  try {
    const { identifier, password } = req.body; // identifier can be phone or email

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Phone/Email and password are required.' });
    }

    const [rows] = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.password_hash, u.role, u.is_active,
              b.id AS business_id, b.business_name, b.business_type, b.city AS business_city
       FROM users u
       LEFT JOIN businesses b ON b.user_id = u.id
       WHERE u.phone = ? OR u.email = ?`,
      [identifier, identifier]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. User not found.' });
    }

    const user = rows[0];

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated. Contact admin.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. Incorrect password.' });
    }

    const token = generateToken(user);

    delete user.password_hash;

    return res.json({
      success: true,
      message: 'Login successful.',
      data: {
        token,
        user
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: 'Login failed.', error: error.message });
  }
};

// Direct Mobile Number Login for Shop Owners / Businesses
exports.loginWithMobile = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, message: 'Mobile number is required.' });
    }

    // Clean phone number (strip whitespace, +91, dashes)
    const cleanPhone = phone.toString().replace(/[^0-9]/g, '').slice(-10);

    const [rows] = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_active,
              b.id AS business_id, b.business_name, b.business_type, b.city AS business_city
       FROM users u
       LEFT JOIN businesses b ON b.user_id = u.id
       WHERE u.phone = ? OR u.phone = ? OR u.phone LIKE ?`,
      [cleanPhone, phone, `%${cleanPhone}`]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No shop or account found with mobile number "${cleanPhone}". Please check your number or register your shop.`
      });
    }

    const user = rows[0];

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated. Please contact admin.' });
    }

    const token = generateToken(user);

    return res.json({
      success: true,
      message: `Welcome back, ${user.full_name}!`,
      data: {
        token,
        user
      }
    });
  } catch (error) {
    console.error('Direct mobile login error:', error);
    return res.status(500).json({ success: false, message: 'Mobile login failed.', error: error.message });
  }
};

// Direct 1-Click Role Login (Super Admin, Shop Owner, Delivery Partner)
exports.loginByRole = async (req, res) => {
  try {
    const { role } = req.body;
    const validRoles = ['super_admin', 'business_man', 'delivery'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    const [rows] = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_active,
              b.id AS business_id, b.business_name, b.business_type, b.city AS business_city
       FROM users u
       LEFT JOIN businesses b ON b.user_id = u.id
       WHERE u.role = ? AND u.is_active = TRUE
       ORDER BY u.id ASC
       LIMIT 1`,
      [role]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: `No active user found for role "${role}".` });
    }

    const user = rows[0];
    const token = generateToken(user);

    return res.json({
      success: true,
      message: `Logged in as ${user.full_name} (${user.role.replace('_', ' ').toUpperCase()})`,
      data: {
        token,
        user
      }
    });
  } catch (error) {
    console.error('Role login error:', error);
    return res.status(500).json({ success: false, message: 'Role login failed.', error: error.message });
  }
};

// Get current profile
exports.getProfile = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_active, u.created_at,
              b.id AS business_id, b.business_name, b.business_type, b.contact_person,
              b.mobile_number AS business_phone, b.shop_address, b.city, b.gst_number
       FROM users u
       LEFT JOIN businesses b ON b.user_id = u.id
       WHERE u.id = ?`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching profile.', error: error.message });
  }
};

// List all users with pagination (Super Admin only - Limit: 10)
exports.getAllUsers = async (req, res) => {
  try {
    const { role, search } = req.query;
    const pagination = getPagination(req, 10);

    let whereClause = ' WHERE 1=1';
    const params = [];

    if (role) {
      whereClause += ' AND u.role = ?';
      params.push(role);
    }

    if (search) {
      whereClause += ' AND (u.full_name LIKE ? OR u.phone LIKE ? OR b.business_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Total count for pagination
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM users u
      LEFT JOIN businesses b ON b.user_id = u.id
      ${whereClause}
    `;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0]?.total || 0;

    let dataQuery = `
      SELECT u.id, u.full_name, u.email, u.phone, u.role, u.city AS user_city, u.is_active, u.created_at,
             b.id AS business_id, b.business_name, b.business_type, COALESCE(u.city, b.city) AS city
      FROM users u
      LEFT JOIN businesses b ON b.user_id = u.id
      ${whereClause}
      ORDER BY u.created_at DESC
    `;

    const dataParams = [...params];
    if (!pagination.isAll) {
      dataQuery += ' LIMIT ? OFFSET ?';
      dataParams.push(pagination.limit, pagination.offset);
    }

    const [rows] = await pool.query(dataQuery, dataParams);
    return res.json({
      success: true,
      count: rows.length,
      pagination: pagination.buildMeta(total),
      data: rows
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching users.', error: error.message });
  }
};

// ==========================================
// DEDICATED ROLE-SPECIFIC CONTROLLERS
// ==========================================

// 1. Admin Login (Requires Super Admin credentials)
exports.loginAdmin = async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Admin Email/Phone and password are required.' });
    }

    const [rows] = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.password_hash, u.role, u.is_active
       FROM users u
       WHERE (u.email = ? OR u.phone = ?) AND u.role = 'super_admin'`,
      [identifier.trim(), identifier.trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials or non-admin account.' });
    }

    const user = rows[0];
    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Admin account has been deactivated.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. Incorrect password.' });
    }

    const token = generateToken(user);
    delete user.password_hash;

    return res.json({
      success: true,
      message: 'Admin authentication successful.',
      data: { token, user }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    return res.status(500).json({ success: false, message: 'Admin login failed.', error: error.message });
  }
};

// 2. Shop Owner Direct Mobile Login
exports.loginShop = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Shop mobile number is required.' });
    }

    const cleanPhone = phone.toString().replace(/[^0-9]/g, '').slice(-10);
    const [rows] = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_active,
              b.id AS business_id, b.business_name, b.business_type, b.city AS business_city, b.shop_address
       FROM users u
       LEFT JOIN businesses b ON b.user_id = u.id
       WHERE (u.phone = ? OR u.phone = ? OR u.phone LIKE ?) AND u.role = 'business_man'`,
      [cleanPhone, phone, `%${cleanPhone}`]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No registered shop found for mobile number "${cleanPhone}". Please register your shop first.`
      });
    }

    const user = rows[0];
    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Shop account deactivated. Contact APMC admin.' });
    }

    const token = generateToken(user);

    return res.json({
      success: true,
      message: `Welcome back, ${user.full_name}!`,
      data: { token, user }
    });
  } catch (error) {
    console.error('Shop login error:', error);
    return res.status(500).json({ success: false, message: 'Shop login failed.', error: error.message });
  }
};

// 3. Shop Owner Registration
exports.registerShop = async (req, res) => {
  req.body.role = 'business_man';
  return exports.register(req, res);
};

// 4. Delivery Partner Login
exports.loginDelivery = async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Delivery partner Phone/Email and password are required.' });
    }

    const [rows] = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.password_hash, u.role, u.city, u.is_active
       FROM users u
       WHERE (u.email = ? OR u.phone = ?) AND u.role = 'delivery'`,
      [identifier.trim(), identifier.trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'No delivery partner account found with these credentials.' });
    }

    const user = rows[0];
    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Delivery account deactivated. Contact APMC admin.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid password.' });
    }

    const token = generateToken(user);
    delete user.password_hash;

    return res.json({
      success: true,
      message: 'Delivery partner authentication successful.',
      data: { token, user }
    });
  } catch (error) {
    console.error('Delivery login error:', error);
    return res.status(500).json({ success: false, message: 'Delivery partner login failed.', error: error.message });
  }
};

// 5. Delivery Partner Registration
exports.registerDelivery = async (req, res) => {
  req.body.role = 'delivery';
  return exports.register(req, res);
};

