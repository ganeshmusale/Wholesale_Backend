const { pool } = require('../config/db');

// Get list of purchases with date and optional filters
exports.getPurchases = async (req, res) => {
  try {
    const { date, start_date, end_date, product_id, market_id, search } = req.query;

    let whereClause = ' WHERE 1=1';
    const params = [];

    if (date) {
      whereClause += ' AND pu.purchase_date = ?';
      params.push(date);
    } else if (start_date && end_date) {
      whereClause += ' AND pu.purchase_date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    } else if (start_date) {
      whereClause += ' AND pu.purchase_date >= ?';
      params.push(start_date);
    }

    if (product_id) {
      whereClause += ' AND pu.product_id = ?';
      params.push(product_id);
    }

    if (market_id) {
      whereClause += ' AND pu.market_id = ?';
      params.push(market_id);
    }

    if (search) {
      whereClause += ' AND (p.name LIKE ? OR pu.supplier_name LIKE ? OR pu.market_name LIKE ? OR m.name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const query = `
      SELECT 
        pu.id,
        pu.purchase_date,
        pu.product_id,
        p.name AS product_name,
        p.image_url,
        c.name AS category_name,
        pu.market_id,
        COALESCE(pu.market_name, m.name, 'Direct Farmer / Haat') AS market_name,
        m.city AS market_city,
        pu.supplier_name,
        pu.unit_id,
        u.name AS unit_name,
        u.symbol AS unit_symbol,
        pu.quantity,
        pu.unit_price,
        pu.total_price,
        pu.lot_number,
        pu.transport_cost,
        pu.payment_status,
        pu.notes,
        pu.created_by,
        pu.created_at,
        pu.updated_at
      FROM purchases pu
      JOIN products p ON p.id = pu.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN markets m ON m.id = pu.market_id
      JOIN units u ON u.id = pu.unit_id
      ${whereClause}
      ORDER BY pu.purchase_date DESC, pu.id DESC
    `;

    const [rows] = await pool.query(query, params);

    return res.json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('Error fetching purchases:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch purchases.',
      error: error.message
    });
  }
};

// Get aggregated date-wise procurement summary (totals + product breakdown with weighted average rate)
exports.getPurchaseSummary = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    // 1. Overall stats for target date
    const [overallRows] = await pool.query(
      `SELECT 
        COUNT(id) AS total_lots,
        COUNT(DISTINCT product_id) AS unique_products,
        COALESCE(SUM(quantity), 0) AS total_quantity,
        COALESCE(SUM(total_price), 0) AS total_amount,
        COALESCE(SUM(transport_cost), 0) AS total_transport_cost
       FROM purchases
       WHERE purchase_date = ?`,
      [targetDate]
    );

    // 2. Aggregated by product (allowing multiple lots of the same vegetable at different rates/markets)
    const [productRows] = await pool.query(
      `SELECT 
        pu.product_id,
        p.name AS product_name,
        p.image_url,
        u.symbol AS unit_symbol,
        c.name AS category_name,
        COUNT(pu.id) AS lots_count,
        SUM(pu.quantity) AS total_quantity,
        SUM(pu.total_price) AS total_amount,
        ROUND(SUM(pu.total_price) / SUM(pu.quantity), 2) AS weighted_avg_rate,
        MIN(pu.unit_price) AS min_rate,
        MAX(pu.unit_price) AS max_rate
       FROM purchases pu
       JOIN products p ON p.id = pu.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       JOIN units u ON u.id = pu.unit_id
       WHERE pu.purchase_date = ?
       GROUP BY pu.product_id, p.name, p.image_url, u.symbol, c.name
       ORDER BY total_amount DESC`,
      [targetDate]
    );

    // 3. Detailed lots for this date to nest inside product groups
    const [allLots] = await pool.query(
      `SELECT 
        pu.id,
        pu.product_id,
        pu.purchase_date,
        pu.market_id,
        COALESCE(pu.market_name, m.name, 'Direct Farmer') AS market_name,
        pu.supplier_name,
        pu.quantity,
        pu.unit_price,
        pu.total_price,
        pu.payment_status,
        pu.notes
       FROM purchases pu
       LEFT JOIN markets m ON m.id = pu.market_id
       WHERE pu.purchase_date = ?
       ORDER BY pu.product_id, pu.unit_price ASC`,
      [targetDate]
    );

    // Group lots by product_id
    const lotsByProduct = {};
    for (const lot of allLots) {
      if (!lotsByProduct[lot.product_id]) {
        lotsByProduct[lot.product_id] = [];
      }
      lotsByProduct[lot.product_id].push(lot);
    }

    const productsWithLots = productRows.map(prod => ({
      ...prod,
      lots: lotsByProduct[prod.product_id] || []
    }));

    return res.json({
      success: true,
      date: targetDate,
      overall: {
        total_lots: Number(overallRows[0]?.total_lots || 0),
        unique_products: Number(overallRows[0]?.unique_products || 0),
        total_quantity: Number(overallRows[0]?.total_quantity || 0),
        total_amount: Number(overallRows[0]?.total_amount || 0),
        total_transport_cost: Number(overallRows[0]?.total_transport_cost || 0),
        overall_avg_rate: overallRows[0]?.total_quantity > 0
          ? Math.round((overallRows[0].total_amount / overallRows[0].total_quantity) * 100) / 100
          : 0
      },
      products: productsWithLots
    });
  } catch (error) {
    console.error('Error fetching purchase summary:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch procurement summary.',
      error: error.message
    });
  }
};

// Create purchases (supports both single purchase object or array of items)
exports.createPurchase = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const userId = req.user?.id || null;
    const body = req.body;

    // Normalize input to array of purchase items
    let items = [];
    let defaultDate = body.purchase_date || new Date().toISOString().split('T')[0];

    if (Array.isArray(body.items)) {
      items = body.items.map(item => ({
        ...item,
        purchase_date: item.purchase_date || defaultDate
      }));
    } else if (Array.isArray(body)) {
      items = body.map(item => ({
        ...item,
        purchase_date: item.purchase_date || defaultDate
      }));
    } else {
      items = [body];
    }

    if (items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No purchase items provided.'
      });
    }

    // Validation
    for (const item of items) {
      if (!item.product_id) {
        return res.status(400).json({ success: false, message: 'Each purchase item requires a valid product_id.' });
      }
      if (!item.quantity || Number(item.quantity) <= 0) {
        return res.status(400).json({ success: false, message: 'Quantity must be greater than 0.' });
      }
      if (item.unit_price === undefined || Number(item.unit_price) < 0) {
        return res.status(400).json({ success: false, message: 'Valid unit_price is required.' });
      }
    }

    await connection.beginTransaction();

    const insertSql = `
      INSERT INTO purchases (
        purchase_date,
        product_id,
        market_id,
        market_name,
        supplier_name,
        unit_id,
        quantity,
        unit_price,
        total_price,
        lot_number,
        transport_cost,
        payment_status,
        notes,
        created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const insertedIds = [];

    for (const item of items) {
      const pDate = item.purchase_date || defaultDate;
      const qty = parseFloat(item.quantity);
      const price = parseFloat(item.unit_price);
      const total = item.total_price !== undefined ? parseFloat(item.total_price) : parseFloat((qty * price).toFixed(2));
      const unitId = item.unit_id || 1;
      const marketId = item.market_id || null;
      const marketName = item.market_name || null;
      const supplierName = item.supplier_name || null;
      const lotNumber = item.lot_number || null;
      const transportCost = parseFloat(item.transport_cost || 0.00);
      const paymentStatus = item.payment_status || 'paid';
      const notes = item.notes || null;

      const [result] = await connection.query(insertSql, [
        pDate,
        item.product_id,
        marketId,
        marketName,
        supplierName,
        unitId,
        qty,
        price,
        total,
        lotNumber,
        transportCost,
        paymentStatus,
        notes,
        userId
      ]);

      insertedIds.push(result.insertId);
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: `Successfully recorded ${insertedIds.length} purchase entry/entries.`,
      inserted_ids: insertedIds
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating purchases:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to record purchases.',
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Update purchase
exports.updatePurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      purchase_date,
      product_id,
      market_id,
      market_name,
      supplier_name,
      unit_id,
      quantity,
      unit_price,
      total_price,
      lot_number,
      transport_cost,
      payment_status,
      notes
    } = req.body;

    const [existing] = await pool.query('SELECT * FROM purchases WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Purchase record not found.' });
    }

    const current = existing[0];
    const newQty = quantity !== undefined ? parseFloat(quantity) : current.quantity;
    const newPrice = unit_price !== undefined ? parseFloat(unit_price) : current.unit_price;
    const newTotal = total_price !== undefined ? parseFloat(total_price) : parseFloat((newQty * newPrice).toFixed(2));

    await pool.query(
      `UPDATE purchases SET
        purchase_date = COALESCE(?, purchase_date),
        product_id = COALESCE(?, product_id),
        market_id = ?,
        market_name = ?,
        supplier_name = ?,
        unit_id = COALESCE(?, unit_id),
        quantity = ?,
        unit_price = ?,
        total_price = ?,
        lot_number = ?,
        transport_cost = COALESCE(?, transport_cost),
        payment_status = COALESCE(?, payment_status),
        notes = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        purchase_date || current.purchase_date,
        product_id || current.product_id,
        market_id !== undefined ? market_id : current.market_id,
        market_name !== undefined ? market_name : current.market_name,
        supplier_name !== undefined ? supplier_name : current.supplier_name,
        unit_id || current.unit_id,
        newQty,
        newPrice,
        newTotal,
        lot_number !== undefined ? lot_number : current.lot_number,
        transport_cost !== undefined ? transport_cost : current.transport_cost,
        payment_status || current.payment_status,
        notes !== undefined ? notes : current.notes,
        id
      ]
    );

    return res.json({
      success: true,
      message: 'Purchase record updated successfully.'
    });
  } catch (error) {
    console.error('Error updating purchase:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update purchase record.',
      error: error.message
    });
  }
};

// Delete purchase
exports.deletePurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query('DELETE FROM purchases WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Purchase record not found.' });
    }

    return res.json({
      success: true,
      message: 'Purchase record deleted successfully.'
    });
  } catch (error) {
    console.error('Error deleting purchase:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete purchase record.',
      error: error.message
    });
  }
};
