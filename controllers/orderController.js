const { pool } = require('../config/db');
const { getPagination } = require('../utils/paginate');

// Create Bulk Purchase Order
exports.createOrder = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const {
      business_id,
      payment_type_id,
      delivery_address,
      delivery_date,
      notes,
      items // [{ product_id, quantity, unit_id, unit_price }]
    } = req.body;

    // Resolve business_id
    let actualBusinessId = business_id;
    if (req.user.role === 'business_man') {
      actualBusinessId = req.user.business_id;
      if (!actualBusinessId) {
        // Look up business for this user
        const [biz] = await connection.query('SELECT id, shop_address FROM businesses WHERE user_id = ?', [req.user.id]);
        if (biz.length === 0) {
          return res.status(400).json({ success: false, message: 'Please register your business profile before placing bulk orders.' });
        }
        actualBusinessId = biz[0].id;
      }
    }

    if (!actualBusinessId || !payment_type_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Business, payment type, and order items are required.' });
    }

    // Default address from business if not provided
    let finalAddress = delivery_address;
    if (!finalAddress) {
      const [biz] = await connection.query('SELECT shop_address, city FROM businesses WHERE id = ?', [actualBusinessId]);
      if (biz.length > 0) {
        finalAddress = `${biz[0].shop_address}, ${biz[0].city}`;
      } else {
        finalAddress = 'Self Pickup / Store Address';
      }
    }

    await connection.beginTransaction();

    // Calculate total amount & prepare items with SERVER-SIDE PRICE AND MIN-QTY ENFORCEMENT
    let totalAmount = 0;
    const orderItemsToInsert = [];

    for (const item of items) {
      const { product_id, quantity } = item;
      const qty = parseFloat(quantity);

      if (!product_id || isNaN(qty) || qty <= 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'Invalid product or quantity specified.' });
      }

      // 1. Fetch official product details (unit_id, min_bulk_qty, name)
      const [prodRows] = await connection.query(
        `SELECT p.id, p.name, p.unit_id, p.default_bulk_min_qty, u.name AS unit_name, u.symbol AS unit_symbol
         FROM products p
         JOIN units u ON u.id = p.unit_id
         WHERE p.id = ? AND p.is_active = TRUE`,
        [product_id]
      );

      if (prodRows.length === 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: `Product ID ${product_id} is not available for order.` });
      }

      const product = prodRows[0];
      const minQty = parseFloat(product.default_bulk_min_qty || 1);

      // 2. Validate Minimum Bulk Order Quantity
      if (qty < minQty) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Minimum wholesale order quantity for ${product.name} is ${minQty} ${product.unit_symbol}. Received: ${qty}.`
        });
      }

      // 3. Server-side authoritative price lookup:
      // First check daily_store_rates (today or most recent)
      let verifiedUnitPrice = null;

      const [storeRates] = await connection.query(
        `SELECT wholesale_price FROM daily_store_rates
         WHERE product_id = ? AND (business_id = ? OR business_id = 1) AND is_available = TRUE
         ORDER BY rate_date DESC, id DESC LIMIT 1`,
        [product_id, actualBusinessId]
      );

      if (storeRates.length > 0 && storeRates[0].wholesale_price != null) {
        verifiedUnitPrice = parseFloat(storeRates[0].wholesale_price);
      } else {
        // Fallback to market_rates
        const [mktRates] = await connection.query(
          `SELECT wholesale_rate FROM market_rates
           WHERE product_id = ?
           ORDER BY rate_date DESC, id DESC LIMIT 1`,
          [product_id]
        );
        if (mktRates.length > 0 && mktRates[0].wholesale_rate != null) {
          verifiedUnitPrice = parseFloat(mktRates[0].wholesale_rate);
        }
      }

      if (verifiedUnitPrice === null || isNaN(verifiedUnitPrice) || verifiedUnitPrice <= 0) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Wholesale pricing is currently not set for ${product.name}. Please contact APMC Mandi admin.`
        });
      }

      const lineTotal = Math.round(qty * verifiedUnitPrice * 100) / 100;
      totalAmount += lineTotal;
      orderItemsToInsert.push([null, product_id, product.unit_id, qty, verifiedUnitPrice, lineTotal]);
    }

    totalAmount = Math.round(totalAmount * 100) / 100;

    // Generate unique order number
    const timestamp = Date.now().toString().slice(-6);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const orderNumber = `BLK-${dateStr}-${timestamp}`;

    // Insert Order - ALWAYS enforce server-calculated total_amount, paid_amount = 0.00, and payment_status = 'pending'
    const [orderResult] = await connection.query(
      `INSERT INTO orders (order_number, business_id, payment_type_id, total_amount, paid_amount, payment_status, order_status, delivery_address, delivery_date, notes)
       VALUES (?, ?, ?, ?, 0.00, 'pending', 'placed', ?, ?, ?)`,
      [orderNumber, actualBusinessId, payment_type_id, totalAmount, finalAddress, delivery_date || null, notes || null]
    );

    const orderId = orderResult.insertId;

    // Insert Order Items with server verified prices
    for (const itemRow of orderItemsToInsert) {
      itemRow[0] = orderId; // assign actual orderId
      await connection.query(
        `INSERT INTO order_items (order_id, product_id, unit_id, quantity, unit_price, total_price)
         VALUES (?, ?, ?, ?, ?, ?)`,
        itemRow
      );
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: 'Bulk order placed successfully.',
      data: {
        order_id: orderId,
        order_number: orderNumber,
        total_amount: totalAmount,
        payment_status: 'pending',
        items_count: items.length
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Order placement error:', error);
    return res.status(500).json({ success: false, message: 'Order creation failed.', error: error.message });
  } finally {
    connection.release();
  }
};

// Get Orders (Filtered by Role with Pagination: Limit 10)
exports.getOrders = async (req, res) => {
  try {
    const { status, payment_status, date_from, date_to } = req.query;
    const pagination = getPagination(req, 10);

    let whereClause = ' WHERE 1=1';
    const params = [];

    // Role-based scoping
    if (req.user.role === 'business_man') {
      whereClause += ' AND b.user_id = ?';
      params.push(req.user.id);
    } else if (req.user.role === 'delivery') {
      // Delivery partner only sees orders assigned to them by admin
      whereClause += ' AND o.delivery_user_id = ?';
      params.push(req.user.id);
    }

    if (status) {
      whereClause += ' AND o.order_status = ?';
      params.push(status);
    }
    if (payment_status) {
      whereClause += ' AND o.payment_status = ?';
      params.push(payment_status);
    }
    if (date_from) {
      whereClause += ' AND DATE(o.created_at) >= ?';
      params.push(date_from);
    }
    if (date_to) {
      whereClause += ' AND DATE(o.created_at) <= ?';
      params.push(date_to);
    }

    // 1. Get total matching count for pagination
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM orders o
      JOIN businesses b ON b.id = o.business_id
      JOIN payment_types pt ON pt.id = o.payment_type_id
      LEFT JOIN users u ON u.id = o.delivery_user_id
      ${whereClause}
    `;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0]?.total || 0;

    // 2. Fetch paginated records
    let dataQuery = `
      SELECT o.*, b.business_name, b.business_type, b.contact_person, b.mobile_number, b.city,
             pt.name AS payment_type_name, pt.code AS payment_type_code,
             u.full_name AS delivery_person_name, u.phone AS delivery_person_phone
      FROM orders o
      JOIN businesses b ON b.id = o.business_id
      JOIN payment_types pt ON pt.id = o.payment_type_id
      LEFT JOIN users u ON u.id = o.delivery_user_id
      ${whereClause}
      ORDER BY o.created_at DESC
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
    return res.status(500).json({ success: false, message: 'Failed to fetch orders.', error: error.message });
  }
};

// Get Single Order Details with Line Items
exports.getOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    const [orders] = await pool.query(
      `SELECT o.*, b.business_name, b.business_type, b.contact_person, b.mobile_number, b.shop_address, b.city,
              pt.name AS payment_type_name, pt.code AS payment_type_code,
              u.full_name AS delivery_person_name, u.phone AS delivery_person_phone
       FROM orders o
       JOIN businesses b ON b.id = o.business_id
       JOIN payment_types pt ON pt.id = o.payment_type_id
       LEFT JOIN users u ON u.id = o.delivery_user_id
       WHERE o.id = ?`,
      [id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const order = orders[0];

    // Security check: business_man can only see their own order
    if (req.user.role === 'business_man' && order.business_id !== req.user.business_id) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    // Get order items
    const [items] = await pool.query(
      `SELECT oi.*, p.name AS product_name, c.name AS category_name, un.name AS unit_name, un.symbol AS unit_symbol
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN categories c ON c.id = p.category_id
       JOIN units un ON un.id = oi.unit_id
       WHERE oi.order_id = ?`,
      [id]
    );

    order.items = items;
    return res.json({ success: true, data: order });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Update Order Status & Assign Delivery (Admin sends delivery request to partner)
exports.updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { order_status, delivery_user_id, delivery_date } = req.body;

    const validStatuses = ['placed', 'confirmed', 'procurement', 'out_for_delivery', 'delivered', 'cancelled'];
    if (order_status && !validStatuses.includes(order_status)) {
      return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    // If admin is assigning or reassigning a delivery partner, set delivery_request_status to 'pending'
    let requestStatusUpdate = '';
    const params = [order_status, delivery_date];
    if (delivery_user_id !== undefined) {
      if (delivery_user_id) {
        requestStatusUpdate = ', delivery_user_id = ?, delivery_request_status = "pending", rejection_reason = NULL';
        params.push(delivery_user_id);
      } else {
        requestStatusUpdate = ', delivery_user_id = NULL, delivery_request_status = NULL, rejection_reason = NULL';
      }
    }
    params.push(id);

    await pool.query(
      `UPDATE orders
       SET order_status = COALESCE(?, order_status),
           delivery_date = COALESCE(?, delivery_date)
           ${requestStatusUpdate}
       WHERE id = ?`,
      params
    );

    return res.json({ success: true, message: 'Order updated successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Edit Order (Business Man can edit their order if status is 'placed' or 'confirmed')
exports.editOrder = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { items, delivery_address, delivery_date, notes } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one order item is required.' });
    }

    // 1. Fetch current order
    const [existingOrders] = await connection.query('SELECT * FROM orders WHERE id = ?', [id]);
    if (existingOrders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    const order = existingOrders[0];

    // 2. Authorization check
    if (req.user.role === 'business_man') {
      const userBizId = req.user.business_id;
      if (order.business_id !== userBizId) {
        // Also check by user_id
        const [biz] = await connection.query('SELECT id FROM businesses WHERE user_id = ?', [req.user.id]);
        if (biz.length === 0 || biz[0].id !== order.business_id) {
          return res.status(403).json({ success: false, message: 'You can only edit your own business orders.' });
        }
      }
    } else if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    // 3. Status restriction: Cannot edit if already out for delivery or delivered
    if (['out_for_delivery', 'delivered', 'cancelled'].includes(order.order_status)) {
      return res.status(400).json({
        success: false,
        message: `Orders that are already '${order.order_status}' cannot be edited.`
      });
    }

    await connection.beginTransaction();

    // 4. Validate & recalculate all items using authoritative server pricing
    let newTotalAmount = 0;
    const orderItemsToInsert = [];

    for (const item of items) {
      const { product_id, quantity } = item;
      const qty = parseFloat(quantity);

      if (!product_id || isNaN(qty) || qty <= 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'Invalid product or quantity specified.' });
      }

      // Fetch product info
      const [prodRows] = await connection.query(
        `SELECT p.id, p.name, p.unit_id, p.default_bulk_min_qty, u.name AS unit_name, u.symbol AS unit_symbol
         FROM products p
         JOIN units u ON u.id = p.unit_id
         WHERE p.id = ? AND p.is_active = TRUE`,
        [product_id]
      );

      if (prodRows.length === 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: `Product ID ${product_id} is no longer available.` });
      }

      const product = prodRows[0];
      const minQty = parseFloat(product.default_bulk_min_qty || 1);

      // Validate Minimum Bulk Order Quantity
      if (qty < minQty) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Minimum wholesale quantity for ${product.name} is ${minQty} ${product.unit_symbol}. Received: ${qty}.`
        });
      }

      // Authoritative price lookup
      let verifiedUnitPrice = null;
      const [storeRates] = await connection.query(
        `SELECT wholesale_price FROM daily_store_rates
         WHERE product_id = ? AND (business_id = ? OR business_id = 1) AND is_available = TRUE
         ORDER BY rate_date DESC, id DESC LIMIT 1`,
        [product_id, order.business_id]
      );

      if (storeRates.length > 0 && storeRates[0].wholesale_price != null) {
        verifiedUnitPrice = parseFloat(storeRates[0].wholesale_price);
      } else {
        const [mktRates] = await connection.query(
          `SELECT wholesale_rate FROM market_rates
           WHERE product_id = ?
           ORDER BY rate_date DESC, id DESC LIMIT 1`,
          [product_id]
        );
        if (mktRates.length > 0 && mktRates[0].wholesale_rate != null) {
          verifiedUnitPrice = parseFloat(mktRates[0].wholesale_rate);
        }
      }

      if (verifiedUnitPrice === null || isNaN(verifiedUnitPrice) || verifiedUnitPrice <= 0) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Wholesale pricing is currently unavailable for ${product.name}.`
        });
      }

      const lineTotal = Math.round(qty * verifiedUnitPrice * 100) / 100;
      newTotalAmount += lineTotal;
      orderItemsToInsert.push([id, product_id, product.unit_id, qty, verifiedUnitPrice, lineTotal]);
    }

    newTotalAmount = Math.round(newTotalAmount * 100) / 100;

    // 5. Replace order items in DB
    await connection.query('DELETE FROM order_items WHERE order_id = ?', [id]);
    for (const itemRow of orderItemsToInsert) {
      await connection.query(
        `INSERT INTO order_items (order_id, product_id, unit_id, quantity, unit_price, total_price)
         VALUES (?, ?, ?, ?, ?, ?)`,
        itemRow
      );
    }

    // 6. Update order header
    await connection.query(
      `UPDATE orders
       SET total_amount = ?,
           delivery_address = COALESCE(?, delivery_address),
           delivery_date = COALESCE(?, delivery_date),
           notes = COALESCE(?, notes)
       WHERE id = ?`,
      [newTotalAmount, delivery_address || null, delivery_date || null, notes !== undefined ? notes : null, id]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: 'Order updated successfully.',
      data: {
        order_id: id,
        total_amount: newTotalAmount,
        items_count: orderItemsToInsert.length
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Order edit error:', error);
    return res.status(500).json({ success: false, message: 'Order update failed.', error: error.message });
  } finally {
    connection.release();
  }
};

// Delivery Partner Accepts or Rejects the Delivery Request
exports.respondDeliveryRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, rejection_reason } = req.body; // action: 'accept' | 'reject'
    const deliveryPartnerId = req.user.id;

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be accept or reject.' });
    }

    const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const order = orders[0];
    if (order.delivery_user_id !== deliveryPartnerId && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'This delivery request is not assigned to you.' });
    }

    if (action === 'accept') {
      // Delivery partner accepts: order becomes out_for_delivery or procurement
      await pool.query(
        `UPDATE orders
         SET delivery_request_status = 'accepted',
             order_status = CASE WHEN order_status = 'placed' THEN 'confirmed' ELSE order_status END
         WHERE id = ?`,
        [id]
      );
      return res.json({ success: true, message: 'Delivery request accepted! You can now proceed with pickup and delivery.' });
    } else {
      // Delivery partner rejects: unassign partner and mark as rejected so Admin can reassign nearby partner
      await pool.query(
        `UPDATE orders
         SET delivery_request_status = 'rejected',
             rejection_reason = ?,
             delivery_user_id = NULL
         WHERE id = ?`,
        [rejection_reason || 'Partner unavailable at this time', id]
      );
      return res.json({ success: true, message: 'Delivery request rejected. Admin has been notified to reassign.' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to process delivery response.', error: error.message });
  }
};

// Record Payment against Order (Server-enforced payment calculation)
exports.recordPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount_paid } = req.body;

    const parsedAmount = parseFloat(amount_paid);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid positive payment amount is required.' });
    }

    const [order] = await pool.query('SELECT total_amount, paid_amount FROM orders WHERE id = ?', [id]);
    if (order.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const currentPaid = parseFloat(order[0].paid_amount || 0);
    const total = parseFloat(order[0].total_amount);
    const newPaid = Math.min(total, Math.round((currentPaid + parsedAmount) * 100) / 100);

    // Server-enforced payment status calculation: cannot be overridden by client
    let calculatedStatus = 'pending';
    if (newPaid >= total) {
      calculatedStatus = 'paid';
    } else if (newPaid > 0) {
      calculatedStatus = 'partial';
    }

    await pool.query(
      'UPDATE orders SET paid_amount = ?, payment_status = ? WHERE id = ?',
      [newPaid, calculatedStatus, id]
    );

    return res.json({
      success: true,
      message: 'Payment recorded successfully.',
      data: { paid_amount: newPaid, total_amount: total, payment_status: calculatedStatus }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
