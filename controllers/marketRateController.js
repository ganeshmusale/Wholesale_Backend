const { pool } = require('../config/db');
const { getPagination } = require('../utils/paginate');

// Upsert daily market rates (single or bulk)
exports.saveMarketRates = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { rate_date, market_id, rates } = req.body;
    // rates is an array of: { product_id, wholesale_rate, min_bulk_qty }

    if (!rate_date || !market_id || !Array.isArray(rates) || rates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'rate_date, market_id, and an array of rates are required.'
      });
    }

    await connection.beginTransaction();

    const sql = `
      INSERT INTO market_rates (rate_date, market_id, product_id, wholesale_rate, min_bulk_qty)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        wholesale_rate = VALUES(wholesale_rate),
        min_bulk_qty = VALUES(min_bulk_qty),
        updated_at = CURRENT_TIMESTAMP
    `;

    for (const item of rates) {
      if (!item.product_id || item.wholesale_rate === undefined) continue;
      await connection.query(sql, [
        rate_date,
        market_id,
        item.product_id,
        item.wholesale_rate,
        item.min_bulk_qty || 100.00
      ]);
    }

    await connection.commit();
    return res.json({ success: true, message: `Successfully updated ${rates.length} wholesale market rates.` });
  } catch (error) {
    await connection.rollback();
    return res.status(500).json({ success: false, message: 'Failed to update rates.', error: error.message });
  } finally {
    connection.release();
  }
};

// Get market rates with filters (Paginated: Limit 10)
exports.getMarketRates = async (req, res) => {
  try {
    const { rate_date, market_id, product_id } = req.query;
    const pagination = getPagination(req, 10);

    let whereClause = ' WHERE 1=1';
    const params = [];

    if (rate_date) {
      whereClause += ' AND mr.rate_date = ?';
      params.push(rate_date);
    }
    if (market_id) {
      whereClause += ' AND mr.market_id = ?';
      params.push(market_id);
    }
    if (product_id) {
      whereClause += ' AND mr.product_id = ?';
      params.push(product_id);
    }

    // Count total
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM market_rates mr
      JOIN markets m ON m.id = mr.market_id
      JOIN products p ON p.id = mr.product_id
      JOIN categories c ON c.id = p.category_id
      JOIN units u ON u.id = p.unit_id
      ${whereClause}
    `;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0]?.total || 0;

    let dataQuery = `
      SELECT mr.*, m.name AS market_name, m.city AS market_city,
             p.name AS product_name, c.name AS category_name,
             u.symbol AS unit_symbol, u.name AS unit_name
      FROM market_rates mr
      JOIN markets m ON m.id = mr.market_id
      JOIN products p ON p.id = mr.product_id
      JOIN categories c ON c.id = p.category_id
      JOIN units u ON u.id = p.unit_id
      ${whereClause}
      ORDER BY mr.rate_date DESC, p.name ASC
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

// Consolidated Market Comparison Report (Wai vs Nashik vs Pune matrix from notes)
exports.getConsolidatedRates = async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    // 1. Get all active markets
    const [markets] = await pool.query('SELECT id, name, city FROM markets WHERE is_active = TRUE ORDER BY id ASC');

    // 2. Get all active products
    const [products] = await pool.query(`
      SELECT p.id, p.name, p.default_bulk_min_qty, c.name AS category_name, u.symbol AS unit_symbol
      FROM products p
      JOIN categories c ON c.id = p.category_id
      JOIN units u ON u.id = p.unit_id
      WHERE p.is_active = TRUE
      ORDER BY p.id ASC
    `);

    // 3. Get rates for this date (or closest recent date if not found)
    const [rates] = await pool.query(
      `SELECT mr.market_id, mr.product_id, mr.wholesale_rate, mr.min_bulk_qty, mr.rate_date
       FROM market_rates mr
       WHERE mr.rate_date = ?`,
      [date]
    );

    // Create a map for quick lookup: product_id -> { market_id: wholesale_rate }
    const rateMap = {};
    rates.forEach((r) => {
      if (!rateMap[r.product_id]) rateMap[r.product_id] = {};
      rateMap[r.product_id][r.market_id] = {
        rate: parseFloat(r.wholesale_rate),
        minQty: parseFloat(r.min_bulk_qty)
      };
    });

    // Build consolidated rows
    const matrix = products.map((prod, index) => {
      const marketRates = {};
      let lowestRate = null;
      let lowestMarket = null;

      markets.forEach((m) => {
        const rateInfo = rateMap[prod.id]?.[m.id];
        if (rateInfo) {
          marketRates[m.id] = rateInfo.rate;
          if (lowestRate === null || rateInfo.rate < lowestRate) {
            lowestRate = rateInfo.rate;
            lowestMarket = m.name;
          }
        } else {
          marketRates[m.id] = null;
        }
      });

      return {
        sr: index + 1,
        product_id: prod.id,
        vegetable: prod.name,
        category: prod.category_name,
        unit: prod.unit_symbol,
        bulk_min_qty: prod.default_bulk_min_qty,
        rates_by_market: marketRates,
        lowest_rate: lowestRate,
        best_market_to_buy: lowestMarket
      };
    });

    return res.json({
      success: true,
      query_date: date,
      markets,
      consolidated_matrix: matrix
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to generate consolidated rates.', error: error.message });
  }
};

// ==========================================
// STORE DAILY PRICING (Admin sets daily selling price according to the market)
// ==========================================

// Get Daily Price Sheet for Store Admin & Shop Owners (Pan-India)
// Shows all vegetables, today's rate, yesterday's rate, and APMC Mandi benchmarks (Wai, Nashik, Pune)
exports.getDailyStorePriceSheet = async (req, res) => {
  try {
    const today = req.query.date || new Date().toISOString().slice(0, 10);
    const yesterdayDate = new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Resolve target business_id:
    let targetBusinessId = req.query.business_id ? parseInt(req.query.business_id, 10) : null;
    if (req.user.role === 'business_man') {
      targetBusinessId = req.user.business_id;
    } else if (!targetBusinessId) {
      targetBusinessId = 1; // default store
    }

    // Get current business info
    const [bizInfo] = await pool.query('SELECT id, business_name, city, state FROM businesses WHERE id = ?', [targetBusinessId]);
    const currentBusiness = bizInfo[0] || { id: targetBusinessId, business_name: 'Main Wholesale Store', city: 'Wai', state: 'Maharashtra' };

    // Get all businesses list for Super Admin dropdown
    let allStores = [];
    if (req.user.role === 'super_admin') {
      const [stores] = await pool.query('SELECT id, business_name, city, state, business_type FROM businesses ORDER BY business_name ASC');
      allStores = stores;
    }

    // 1. Get all active products
    const [products] = await pool.query(`
      SELECT p.id, p.name, p.default_bulk_min_qty, p.image_url, c.name AS category_name, u.symbol AS unit_symbol, u.name AS unit_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      JOIN units u ON u.id = p.unit_id
      WHERE p.is_active = TRUE
      ORDER BY p.name ASC
    `);

    // 2. Get today's store rates for this specific business
    const [todayRates] = await pool.query('SELECT * FROM daily_store_rates WHERE rate_date = ? AND business_id = ?', [today, targetBusinessId]);
    const todayMap = {};
    todayRates.forEach(r => { todayMap[r.product_id] = r; });

    // 3. Get yesterday's store rates for this business
    const [yesterdayRates] = await pool.query('SELECT product_id, wholesale_price FROM daily_store_rates WHERE rate_date = ? AND business_id = ?', [yesterdayDate, targetBusinessId]);
    const yesterdayMap = {};
    yesterdayRates.forEach(r => { yesterdayMap[r.product_id] = parseFloat(r.wholesale_price); });

    // 4. Get APMC Mandi rates for today (Wai, Nashik, Pune benchmark)
    const [mandiRates] = await pool.query(`
      SELECT mr.product_id, mr.wholesale_rate, m.name AS market_name, m.city
      FROM market_rates mr
      JOIN markets m ON m.id = mr.market_id
      WHERE mr.rate_date = ?
    `, [today]);

    const mandiMap = {};
    mandiRates.forEach(mr => {
      if (!mandiMap[mr.product_id]) mandiMap[mr.product_id] = [];
      mandiMap[mr.product_id].push({
        market: mr.city || mr.market_name,
        mandi_rate: parseFloat(mr.wholesale_rate)
      });
    });

    const sheet = products.map(prod => {
      const todayEntry = todayMap[prod.id];
      const todayPrice = todayEntry ? parseFloat(todayEntry.wholesale_price) : null;
      const prevPrice = yesterdayMap[prod.id] || null;

      let diff = null;
      let trend = 'same';
      if (todayPrice !== null && prevPrice !== null) {
        diff = (todayPrice - prevPrice).toFixed(2);
        if (todayPrice > prevPrice) trend = 'up';
        else if (todayPrice < prevPrice) trend = 'down';
      }

      return {
        product_id: prod.id,
        name: prod.name,
        category: prod.category_name,
        unit: prod.unit_symbol,
        unit_name: prod.unit_name,
        today_price: todayPrice,
        yesterday_price: prevPrice,
        price_diff: diff,
        trend,
        min_bulk_qty: todayEntry ? parseFloat(todayEntry.min_bulk_qty) : parseFloat(prod.default_bulk_min_qty),
        is_available: todayEntry ? Boolean(todayEntry.is_available) : true,
        notes: todayEntry?.notes || '',
        mandi_benchmarks: mandiMap[prod.id] || []
      };
    });

    return res.json({
      success: true,
      rate_date: today,
      business: currentBusiness,
      all_stores: allStores,
      is_published_today: todayRates.length > 0,
      total_items: sheet.length,
      data: sheet
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load price sheet.', error: error.message });
  }
};

// Save Store Admin / Shop Owner's Daily Selling Price Sheet
exports.saveDailyStorePriceSheet = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { rate_date = new Date().toISOString().slice(0, 10), rates, business_id } = req.body;

    let targetBusinessId = business_id ? parseInt(business_id, 10) : null;
    if (req.user.role === 'business_man') {
      targetBusinessId = req.user.business_id;
    } else if (!targetBusinessId) {
      targetBusinessId = 1;
    }

    if (!Array.isArray(rates) || rates.length === 0) {
      return res.status(400).json({ success: false, message: 'Rates array is required.' });
    }

    await connection.beginTransaction();

    const sql = `
      INSERT INTO daily_store_rates (business_id, rate_date, product_id, wholesale_price, min_bulk_qty, is_available, admin_user_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        wholesale_price = VALUES(wholesale_price),
        min_bulk_qty = VALUES(min_bulk_qty),
        is_available = VALUES(is_available),
        admin_user_id = VALUES(admin_user_id),
        notes = VALUES(notes),
        updated_at = CURRENT_TIMESTAMP
    `;

    for (const item of rates) {
      if (!item.product_id || item.wholesale_price === undefined) continue;
      await connection.query(sql, [
        targetBusinessId,
        rate_date,
        item.product_id,
        parseFloat(item.wholesale_price),
        parseFloat(item.min_bulk_qty || 50.00),
        item.is_available !== false,
        req.user?.id || null,
        item.notes || null
      ]);
    }

    await connection.commit();
    return res.json({
      success: true,
      message: `Successfully saved daily store prices for ${rates.length} vegetables.`
    });
  } catch (error) {
    await connection.rollback();
    return res.status(500).json({ success: false, message: 'Failed to save daily prices.', error: error.message });
  } finally {
    connection.release();
  }
};

// Customer Live Wholesale Rates Endpoint (Today's available rates to buy)
exports.getTodayCustomerRates = async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { business_id, city } = req.query;

    let targetBusinessId = business_id ? parseInt(business_id, 10) : null;
    if (!targetBusinessId) {
      targetBusinessId = 1; // default to first store if not specified
    }

    const [rows] = await pool.query(`
      SELECT dsr.rate_date, dsr.business_id, dsr.wholesale_price, dsr.min_bulk_qty, dsr.is_available, dsr.notes,
             b.business_name, b.city AS business_city, b.state AS business_state,
             p.id AS product_id, p.name AS vegetable_name, p.image_url,
             c.name AS category_name,
             u.name AS unit_name, u.symbol AS unit_symbol
      FROM daily_store_rates dsr
      JOIN businesses b ON b.id = dsr.business_id
      JOIN products p ON p.id = dsr.product_id
      JOIN categories c ON c.id = p.category_id
      JOIN units u ON u.id = p.unit_id
      WHERE dsr.business_id = ? AND dsr.is_available = TRUE AND p.is_active = TRUE
      ORDER BY c.name ASC, p.name ASC
    `, [targetBusinessId]);

    return res.json({
      success: true,
      rate_date: today,
      is_todays_rate: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Get Vegetable Price Trend History
exports.getPriceTrendHistory = async (req, res) => {
  try {
    const { product_id, days = 15 } = req.query;
    if (!product_id) {
      return res.status(400).json({ success: false, message: 'product_id is required.' });
    }

    const [rows] = await pool.query(`
      SELECT rate_date, wholesale_price, min_bulk_qty
      FROM daily_store_rates
      WHERE product_id = ?
      ORDER BY rate_date DESC
      LIMIT ?
    `, [product_id, parseInt(days, 10)]);

    return res.json({ success: true, product_id, history: rows.reverse() });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

