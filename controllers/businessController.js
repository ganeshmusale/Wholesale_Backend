const { pool } = require('../config/db');
const { getPagination } = require('../utils/paginate');

// Get all businesses with pagination (Admin / Delivery - Limit: 10)
exports.getAllBusinesses = async (req, res) => {
  try {
    const { city, business_type, search } = req.query;
    const pagination = getPagination(req, 10);

    let whereClause = ' WHERE 1=1';
    const params = [];

    if (city) {
      whereClause += ' AND b.city = ?';
      params.push(city);
    }
    if (business_type) {
      whereClause += ' AND b.business_type = ?';
      params.push(business_type);
    }
    if (search) {
      whereClause += ' AND (b.business_name LIKE ? OR b.contact_person LIKE ? OR b.mobile_number LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Count query
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM businesses b
      JOIN users u ON u.id = b.user_id
      ${whereClause}
    `;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0]?.total || 0;

    let dataQuery = `
      SELECT b.*, u.full_name AS owner_name, u.email AS owner_email, u.phone AS owner_phone
      FROM businesses b
      JOIN users u ON u.id = b.user_id
      ${whereClause}
      ORDER BY b.created_at DESC
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
    return res.status(500).json({ success: false, message: 'Failed to fetch businesses.', error: error.message });
  }
};

// Get current user's business profile
exports.getMyBusiness = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM businesses WHERE user_id = ?', [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No business profile found for this user.' });
    }
    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Register or Update Business Profile
exports.saveBusinessProfile = async (req, res) => {
  try {
    const {
      business_name,
      business_type = 'vegetable_shop',
      contact_person,
      mobile_number,
      shop_address,
      city,
      gst_number
    } = req.body;

    if (!business_name || !contact_person || !mobile_number || !shop_address || !city) {
      return res.status(400).json({
        success: false,
        message: 'Business name, contact person, mobile number, shop address, and city are required.'
      });
    }

    // Check if business exists for user
    const [existing] = await pool.query('SELECT id FROM businesses WHERE user_id = ?', [req.user.id]);

    if (existing.length > 0) {
      // Update
      await pool.query(
        `UPDATE businesses
         SET business_name = ?, business_type = ?, contact_person = ?, mobile_number = ?, shop_address = ?, city = ?, gst_number = ?
         WHERE user_id = ?`,
        [business_name, business_type, contact_person, mobile_number, shop_address, city, gst_number || null, req.user.id]
      );
      return res.json({ success: true, message: 'Business profile updated successfully.' });
    } else {
      // Insert
      const [result] = await pool.query(
        `INSERT INTO businesses (user_id, business_name, business_type, contact_person, mobile_number, shop_address, city, gst_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, business_name, business_type, contact_person, mobile_number, shop_address, city, gst_number || null]
      );
      return res.status(201).json({ success: true, message: 'Business profile registered successfully.', id: result.insertId });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to save business profile.', error: error.message });
  }
};

// Admin onboards a new Shop Owner / Business (Pan-India)
exports.adminCreateShopOwner = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const {
      full_name,
      phone,
      email,
      password = 'password123',
      business_name,
      business_type = 'vegetable_shop',
      contact_person,
      shop_address,
      city,
      state = 'Maharashtra',
      gst_number
    } = req.body;

    if (!full_name || !phone || !business_name || !shop_address || !city) {
      return res.status(400).json({
        success: false,
        message: 'Full name, mobile number, shop name, address, and city are required.'
      });
    }

    const [existing] = await connection.query(
      'SELECT id FROM users WHERE phone = ? OR (email IS NOT NULL AND email = ?)',
      [phone, email || null]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'A user with this mobile number or email already exists.'
      });
    }

    await connection.beginTransaction();

    const bcrypt = require('bcryptjs');
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // 1. Create user with role business_man
    const [userRes] = await connection.query(
      'INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, "business_man")',
      [full_name, email || null, phone, password_hash]
    );
    const newUserId = userRes.insertId;

    // 2. Create business
    const [bizRes] = await connection.query(
      `INSERT INTO businesses (user_id, business_name, business_type, contact_person, mobile_number, shop_address, city, state, gst_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newUserId, business_name, business_type, contact_person || full_name, phone, shop_address, city, state, gst_number || null]
    );
    const newBusinessId = bizRes.insertId;

    // 3. Clone default rates into this new business so they have an active price list immediately!
    const today = new Date().toISOString().slice(0, 10);
    const [defaultRates] = await connection.query(
      'SELECT product_id, wholesale_price, min_bulk_qty, is_available, notes FROM daily_store_rates WHERE rate_date = CURDATE() AND (business_id = 1 OR business_id IS NULL)'
    );

    if (defaultRates.length > 0) {
      for (const r of defaultRates) {
        await connection.query(
          `INSERT INTO daily_store_rates (business_id, rate_date, product_id, wholesale_price, min_bulk_qty, is_available, admin_user_id, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE wholesale_price = VALUES(wholesale_price)`,
          [newBusinessId, today, r.product_id, r.wholesale_price, r.min_bulk_qty, r.is_available, req.user.id, r.notes]
        );
      }
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: `Shop Owner "${business_name}" (${city}, ${state}) created successfully!`,
      data: {
        user_id: newUserId,
        business_id: newBusinessId,
        business_name,
        contact_person: contact_person || full_name,
        city,
        state,
        login_identifier: phone,
        default_password: password
      }
    });
  } catch (error) {
    await connection.rollback();
    return res.status(500).json({ success: false, message: 'Failed to create shop owner.', error: error.message });
  } finally {
    connection.release();
  }
};

