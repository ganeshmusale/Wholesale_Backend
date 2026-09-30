const { pool } = require('../config/db');

// Consolidated Vegetable Market Price Comparison Report
exports.getMarketComparisonReport = async (req, res) => {
  try {
    const { date = new Date().toISOString().slice(0, 10) } = req.query;

    const [markets] = await pool.query('SELECT id, name, city FROM markets WHERE is_active = TRUE ORDER BY id ASC');
    const [products] = await pool.query(`
      SELECT p.id, p.name, c.name AS category_name, u.symbol AS unit_symbol, u.name AS unit_name, p.default_bulk_min_qty
      FROM products p
      JOIN categories c ON c.id = p.category_id
      JOIN units u ON u.id = p.unit_id
      WHERE p.is_active = TRUE
      ORDER BY p.name ASC
    `);

    // Fetch latest available rate on or before query date
    const [rates] = await pool.query(
      `SELECT mr.market_id, mr.product_id, mr.wholesale_rate, mr.rate_date
       FROM market_rates mr
       WHERE mr.rate_date = ?`,
      [date]
    );

    const rateMap = {};
    rates.forEach(r => {
      if (!rateMap[r.product_id]) rateMap[r.product_id] = {};
      rateMap[r.product_id][r.market_id] = parseFloat(r.wholesale_rate);
    });

    const report = products.map((prod, index) => {
      const marketPrices = {};
      let minPrice = Infinity;
      let maxPrice = -Infinity;
      let minMarket = null;
      let maxMarket = null;

      markets.forEach(m => {
        const price = rateMap[prod.id]?.[m.id] ?? null;
        marketPrices[m.name] = price;
        if (price !== null) {
          if (price < minPrice) {
            minPrice = price;
            minMarket = m.name;
          }
          if (price > maxPrice) {
            maxPrice = price;
            maxMarket = m.name;
          }
        }
      });

      const priceDiff = (maxPrice !== -Infinity && minPrice !== Infinity && maxPrice > minPrice)
        ? (maxPrice - minPrice).toFixed(2)
        : '0.00';

      return {
        sr: index + 1,
        vegetable: prod.name,
        category: prod.category_name,
        unit: prod.unit_symbol,
        bulk_min_qty: prod.default_bulk_min_qty,
        market_prices: marketPrices,
        best_market: minMarket || 'N/A',
        lowest_rate: minPrice !== Infinity ? minPrice : null,
        highest_rate: maxPrice !== -Infinity ? maxPrice : null,
        potential_saving_per_unit: priceDiff
      };
    });

    return res.json({
      success: true,
      report_date: date,
      markets: markets.map(m => m.name),
      data: report
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to generate report.', error: error.message });
  }
};

// Procurement & Sales KPI Summary
exports.getDashboardSummary = async (req, res) => {
  try {
    const [totalOrders] = await pool.query('SELECT COUNT(*) AS total_orders, COALESCE(SUM(total_amount), 0) AS total_revenue FROM orders');
    const [activeBusinesses] = await pool.query('SELECT COUNT(*) AS total_businesses FROM businesses');
    const [totalProducts] = await pool.query('SELECT COUNT(*) AS total_products FROM products WHERE is_active = TRUE');
    const [pendingDeliveries] = await pool.query('SELECT COUNT(*) AS pending_deliveries FROM orders WHERE order_status IN ("procurement", "out_for_delivery")');

    const [topVegetables] = await pool.query(`
      SELECT p.name AS vegetable, SUM(oi.quantity) AS total_quantity, u.symbol AS unit, SUM(oi.total_price) AS total_sales
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN units u ON u.id = oi.unit_id
      GROUP BY oi.product_id, p.name, u.symbol
      ORDER BY total_sales DESC
      LIMIT 5
    `);

    return res.json({
      success: true,
      data: {
        stats: {
          orders_count: totalOrders[0].total_orders,
          revenue: totalOrders[0].total_revenue,
          businesses_count: activeBusinesses[0].total_businesses,
          products_count: totalProducts[0].total_products,
          pending_deliveries: pendingDeliveries[0].pending_deliveries
        },
        top_vegetables: topVegetables
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// 1. Sales & Revenue Comprehensive Report
exports.getSalesReport = async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    let query = `
      SELECT o.id, o.order_number, o.created_at, o.order_status, o.payment_status,
             o.total_amount, o.paid_amount, (o.total_amount - o.paid_amount) AS balance_amount,
             b.business_name, b.business_type, b.city, b.contact_person, b.mobile_number,
             pt.name AS payment_type_name,
             COUNT(oi.id) AS total_items,
             COALESCE(SUM(oi.quantity), 0) AS total_volume
      FROM orders o
      JOIN businesses b ON b.id = o.business_id
      JOIN payment_types pt ON pt.id = o.payment_type_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE 1=1
    `;
    const params = [];

    if (date_from) {
      query += ' AND DATE(o.created_at) >= ?';
      params.push(date_from);
    }
    if (date_to) {
      query += ' AND DATE(o.created_at) <= ?';
      params.push(date_to);
    }

    query += ' GROUP BY o.id ORDER BY o.created_at DESC';

    const [rows] = await pool.query(query, params);

    const summary = rows.reduce((acc, r) => {
      acc.total_orders += 1;
      acc.total_revenue += parseFloat(r.total_amount || 0);
      acc.total_collected += parseFloat(r.paid_amount || 0);
      acc.total_pending_credit += parseFloat(r.balance_amount || 0);
      return acc;
    }, { total_orders: 0, total_revenue: 0, total_collected: 0, total_pending_credit: 0 });

    return res.json({ success: true, summary, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// 2. Vegetable Procurement & Demand Aggregation Report
exports.getProcurementReport = async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    let query = `
      SELECT p.id AS product_id, p.name AS vegetable_name, c.name AS category_name,
             u.symbol AS unit_symbol, u.name AS unit_name,
             COUNT(DISTINCT oi.order_id) AS orders_count,
             SUM(oi.quantity) AS total_quantity_demanded,
             AVG(oi.unit_price) AS average_rate,
             SUM(oi.total_price) AS total_procurement_cost
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN categories c ON c.id = p.category_id
      JOIN units u ON u.id = oi.unit_id
      JOIN orders o ON o.id = oi.order_id
      WHERE o.order_status NOT IN ('cancelled')
    `;
    const params = [];

    if (date_from) {
      query += ' AND DATE(o.created_at) >= ?';
      params.push(date_from);
    }
    if (date_to) {
      query += ' AND DATE(o.created_at) <= ?';
      params.push(date_to);
    }

    query += ' GROUP BY p.id, p.name, c.name, u.symbol, u.name ORDER BY total_quantity_demanded DESC';

    const [rows] = await pool.query(query, params);
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// 3. Delivery Operations & Partner Performance Report
exports.getDeliveryReport = async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    let query = `
      SELECT u.id AS delivery_partner_id, u.full_name AS partner_name, u.phone AS partner_phone,
             COALESCE(u.city, 'Wai') AS home_city,
             COUNT(o.id) AS total_assigned,
             SUM(CASE WHEN o.delivery_request_status = 'accepted' THEN 1 ELSE 0 END) AS accepted_count,
             SUM(CASE WHEN o.delivery_request_status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
             SUM(CASE WHEN o.order_status = 'delivered' THEN 1 ELSE 0 END) AS delivered_count,
             SUM(CASE WHEN o.order_status = 'out_for_delivery' THEN 1 ELSE 0 END) AS active_in_transit,
             COALESCE(SUM(CASE WHEN o.order_status = 'delivered' THEN o.total_amount ELSE 0 END), 0) AS total_delivered_value
      FROM users u
      LEFT JOIN orders o ON o.delivery_user_id = u.id
    `;
    const params = [];

    if (date_from && date_to) {
      query += ' AND (DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?)';
      params.push(date_from, date_to);
    } else if (date_from) {
      query += ' AND DATE(o.created_at) >= ?';
      params.push(date_from);
    }

    query += ` WHERE u.role = 'delivery' GROUP BY u.id, u.full_name, u.phone, u.city ORDER BY delivered_count DESC`;

    const [rows] = await pool.query(query, params);
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// 4. Shop Owner Khata & Credit Balance Ledger Report
exports.getKhataLedgerReport = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT b.id AS business_id, b.business_name, b.business_type, b.contact_person, b.mobile_number,
             b.city, b.shop_address,
             COUNT(o.id) AS total_orders,
             COALESCE(SUM(o.total_amount), 0) AS total_billed,
             COALESCE(SUM(o.paid_amount), 0) AS total_paid,
             COALESCE(SUM(o.total_amount - o.paid_amount), 0) AS outstanding_khata_due,
             SUM(CASE WHEN o.payment_status = 'pending' THEN 1 ELSE 0 END) AS unpaid_orders_count,
             MAX(o.created_at) AS last_order_date
      FROM businesses b
      LEFT JOIN orders o ON o.business_id = b.id
      GROUP BY b.id, b.business_name, b.business_type, b.contact_person, b.mobile_number, b.city, b.shop_address
      ORDER BY outstanding_khata_due DESC, b.business_name ASC
    `);

    const summary = rows.reduce((acc, r) => {
      acc.total_shops += 1;
      acc.total_market_credit += parseFloat(r.outstanding_khata_due || 0);
      acc.total_turnover += parseFloat(r.total_billed || 0);
      return acc;
    }, { total_shops: 0, total_market_credit: 0, total_turnover: 0 });

    return res.json({ success: true, summary, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

