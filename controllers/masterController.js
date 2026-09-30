const { pool } = require('../config/db');
const { getPagination } = require('../utils/paginate');

// ==========================================
// 1. ALL MASTERS SUMMARY (Convenient for UI)
// ==========================================
exports.getAllMastersSummary = async (req, res) => {
  try {
    const [units] = await pool.query('SELECT * FROM units WHERE is_active = TRUE ORDER BY name ASC');
    const [categories] = await pool.query('SELECT * FROM categories WHERE is_active = TRUE ORDER BY name ASC');
    const [businessTypes] = await pool.query('SELECT * FROM business_types WHERE is_active = TRUE ORDER BY name ASC');
    const [markets] = await pool.query('SELECT * FROM markets WHERE is_active = TRUE ORDER BY name ASC');
    const [paymentTypes] = await pool.query('SELECT * FROM payment_types WHERE is_active = TRUE ORDER BY name ASC');
    const [products] = await pool.query(`
      SELECT p.*, c.name AS category_name, u.name AS unit_name, u.symbol AS unit_symbol
      FROM products p
      JOIN categories c ON c.id = p.category_id
      JOIN units u ON u.id = p.unit_id
      WHERE p.is_active = TRUE
      ORDER BY p.name ASC
    `);

    return res.json({
      success: true,
      data: {
        units,
        categories,
        businessTypes,
        markets,
        paymentTypes,
        products
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch masters.', error: error.message });
  }
};

// ==========================================
// 2. UNITS MASTER
// ==========================================
exports.getUnits = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM units ORDER BY id ASC');
    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.createUnit = async (req, res) => {
  try {
    const { name, symbol, conversion_to_kg = 1.00 } = req.body;
    if (!name || !symbol) {
      return res.status(400).json({ success: false, message: 'Name and symbol are required.' });
    }
    const [result] = await pool.query(
      'INSERT INTO units (name, symbol, conversion_to_kg) VALUES (?, ?, ?)',
      [name, symbol, conversion_to_kg]
    );
    return res.status(201).json({ success: true, message: 'Unit created.', data: { id: result.insertId, name, symbol, conversion_to_kg } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateUnit = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, symbol, conversion_to_kg, is_active } = req.body;
    await pool.query(
      'UPDATE units SET name = COALESCE(?, name), symbol = COALESCE(?, symbol), conversion_to_kg = COALESCE(?, conversion_to_kg), is_active = COALESCE(?, is_active) WHERE id = ?',
      [name, symbol, conversion_to_kg, is_active, id]
    );
    return res.json({ success: true, message: 'Unit updated.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// 3. CATEGORIES MASTER
// ==========================================
exports.getCategories = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM categories ORDER BY name ASC');
    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Category name is required.' });
    const [result] = await pool.query('INSERT INTO categories (name, description) VALUES (?, ?)', [name, description || null]);
    return res.status(201).json({ success: true, message: 'Category created.', data: { id: result.insertId, name, description } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, is_active } = req.body;
    await pool.query(
      'UPDATE categories SET name = COALESCE(?, name), description = COALESCE(?, description), is_active = COALESCE(?, is_active) WHERE id = ?',
      [name, description, is_active, id]
    );
    return res.json({ success: true, message: 'Category updated.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    // Check if any products are linked to this category
    const [linked] = await pool.query('SELECT COUNT(*) as count FROM products WHERE category_id = ?', [id]);
    if (linked[0].count > 0) {
      // If products exist, soft-deactivate instead or inform user
      await pool.query('UPDATE categories SET is_active = FALSE WHERE id = ?', [id]);
      return res.json({
        success: true,
        message: `Category has ${linked[0].count} product(s) linked to it. It has been deactivated to preserve order history and catalog integrity.`
      });
    }

    // Otherwise safe to hard delete
    await pool.query('DELETE FROM categories WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Category deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// 4. MARKETS MASTER (Wai, Nashik, etc.)
// ==========================================
exports.getMarkets = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM markets ORDER BY name ASC');
    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.createMarket = async (req, res) => {
  try {
    const { name, city, state = 'Maharashtra' } = req.body;
    if (!name || !city) return res.status(400).json({ success: false, message: 'Name and city are required.' });
    const [result] = await pool.query('INSERT INTO markets (name, city, state) VALUES (?, ?, ?)', [name, city, state]);
    return res.status(201).json({ success: true, message: 'Market created.', data: { id: result.insertId, name, city, state } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateMarket = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, city, state, is_active } = req.body;
    await pool.query(
      'UPDATE markets SET name = COALESCE(?, name), city = COALESCE(?, city), state = COALESCE(?, state), is_active = COALESCE(?, is_active) WHERE id = ?',
      [name, city, state, is_active, id]
    );
    return res.json({ success: true, message: 'Market updated.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// 5. PRODUCTS MASTER (Paginated: Limit 10, or limit=all)
// ==========================================
exports.getProducts = async (req, res) => {
  try {
    const { category_id, search, is_active } = req.query;
    // Default limit 10, but allows limit=all if requested by dropdowns
    const pagination = getPagination(req, 10);

    let whereClause = ' WHERE 1=1';
    const params = [];

    if (category_id) {
      whereClause += ' AND p.category_id = ?';
      params.push(category_id);
    }
    if (is_active !== undefined) {
      whereClause += ' AND p.is_active = ?';
      params.push(is_active === 'true' || is_active === '1');
    }
    if (search) {
      whereClause += ' AND (p.name LIKE ? OR c.name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    // Count query
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM products p
      JOIN categories c ON c.id = p.category_id
      JOIN units u ON u.id = p.unit_id
      ${whereClause}
    `;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0]?.total || 0;

    let dataQuery = `
      SELECT p.*, c.name AS category_name, u.name AS unit_name, u.symbol AS unit_symbol, u.conversion_to_kg
      FROM products p
      JOIN categories c ON c.id = p.category_id
      JOIN units u ON u.id = p.unit_id
      ${whereClause}
      ORDER BY p.name ASC
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
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.createProduct = async (req, res) => {
  try {
    const { category_id, name, unit_id, default_bulk_min_qty = 50.00, image_url, description } = req.body;
    if (!category_id || !name || !unit_id) {
      return res.status(400).json({ success: false, message: 'Category, product name, and primary unit are required.' });
    }
    const [result] = await pool.query(
      `INSERT INTO products (category_id, name, unit_id, default_bulk_min_qty, image_url, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [category_id, name, unit_id, default_bulk_min_qty, image_url || null, description || null]
    );
    return res.status(201).json({ success: true, message: 'Product created successfully.', id: result.insertId });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { category_id, name, unit_id, default_bulk_min_qty, image_url, description, is_active } = req.body;
    await pool.query(
      `UPDATE products
       SET category_id = COALESCE(?, category_id),
           name = COALESCE(?, name),
           unit_id = COALESCE(?, unit_id),
           default_bulk_min_qty = COALESCE(?, default_bulk_min_qty),
           image_url = COALESCE(?, image_url),
           description = COALESCE(?, description),
           is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [category_id, name, unit_id, default_bulk_min_qty, image_url, description, is_active, id]
    );
    return res.json({ success: true, message: 'Product updated successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    // Check if product is referenced in order_items
    const [orders] = await pool.query('SELECT COUNT(*) as count FROM order_items WHERE product_id = ?', [id]);
    if (orders[0].count > 0) {
      await pool.query('UPDATE products SET is_active = FALSE WHERE id = ?', [id]);
      return res.json({
        success: true,
        message: `Product is present in ${orders[0].count} order record(s). Deactivated vegetable to safeguard order history.`
      });
    }

    await pool.query('DELETE FROM products WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Vegetable deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// 6. PAYMENT TYPES MASTER
// ==========================================
exports.getPaymentTypes = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM payment_types ORDER BY id ASC');
    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.createPaymentType = async (req, res) => {
  try {
    const { name, code, description } = req.body;
    if (!name || !code) return res.status(400).json({ success: false, message: 'Name and code are required.' });
    const [result] = await pool.query(
      'INSERT INTO payment_types (name, code, description) VALUES (?, ?, ?)',
      [name, code.toUpperCase(), description || null]
    );
    return res.status(201).json({ success: true, message: 'Payment type created.', id: result.insertId });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// 7. BUSINESS TYPES MASTER (Dynamic commercial buyer types)
// ==========================================
exports.getBusinessTypes = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM business_types ORDER BY name ASC');
    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.createBusinessType = async (req, res) => {
  try {
    const { name, code, description } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Business type name is required.' });
    
    // Auto-generate slug/code if not provided
    const cleanCode = (code || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    const [result] = await pool.query(
      'INSERT INTO business_types (name, code, description) VALUES (?, ?, ?)',
      [name, cleanCode, description || null]
    );
    return res.status(201).json({
      success: true,
      message: 'Business type created successfully.',
      data: { id: result.insertId, name, code: cleanCode, description }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateBusinessType = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, description, is_active } = req.body;
    await pool.query(
      'UPDATE business_types SET name = COALESCE(?, name), code = COALESCE(?, code), description = COALESCE(?, description), is_active = COALESCE(?, is_active) WHERE id = ?',
      [name, code, description, is_active, id]
    );
    return res.json({ success: true, message: 'Business type updated successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteBusinessType = async (req, res) => {
  try {
    const { id } = req.params;
    // Check if any businesses use this type code
    const [typeRows] = await pool.query('SELECT code FROM business_types WHERE id = ?', [id]);
    if (typeRows.length > 0) {
      const typeCode = typeRows[0].code;
      const [used] = await pool.query('SELECT COUNT(*) as count FROM businesses WHERE business_type = ?', [typeCode]);
      if (used[0].count > 0) {
        await pool.query('UPDATE business_types SET is_active = FALSE WHERE id = ?', [id]);
        return res.json({
          success: true,
          message: `Business type is assigned to ${used[0].count} business(es). Deactivated instead to safeguard business profiles.`
        });
      }
    }

    await pool.query('DELETE FROM business_types WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Business type deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
