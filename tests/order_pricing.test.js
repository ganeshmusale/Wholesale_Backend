const { describe, it } = require('node:test');
const assert = require('node:assert');
const http = require('http');

function makeRequest({ method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (data) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path,
      method,
      headers: reqHeaders
    }, (res) => {
      let resBody = '';
      res.on('data', (chunk) => resBody += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(resBody) });
        } catch {
          resolve({ status: res.statusCode, raw: resBody });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('Server-Side Pricing & Payment Validation Tests', () => {
  let shopToken = null;
  let adminToken = null;

  // Setup: obtain tokens for shop owner and admin
  it('Setup: Authenticate shop owner and admin', async () => {
    const shopLogin = await makeRequest({
      method: 'POST',
      path: '/api/auth/shop/login',
      body: { phone: '9876543210' }
    });
    assert.strictEqual(shopLogin.status, 200);
    shopToken = shopLogin.data.data.token;

    const adminLogin = await makeRequest({
      method: 'POST',
      path: '/api/auth/admin/login',
      body: { identifier: 'admin@wholesale.com', password: 'admin123' }
    });
    assert.strictEqual(adminLogin.status, 200);
    adminToken = adminLogin.data.data.token;
  });

  it('1. MUST IGNORE client-submitted unit_price and calculate total using authoritative server rate', async () => {
    // Attempting to send unit_price = 0.01 (client tampering)
    const res = await makeRequest({
      method: 'POST',
      path: '/api/orders',
      headers: { Authorization: `Bearer ${shopToken}` },
      body: {
        payment_type_id: 1,
        items: [
          {
            product_id: 1, // Potatoes (min bulk qty 250kg)
            quantity: 250,
            unit_price: 0.01 // Tampered price
          }
        ]
      }
    });

    assert.strictEqual(res.status, 201, `Failed to place order: ${JSON.stringify(res.data)}`);
    assert.strictEqual(res.data.success, true);

    // If the 0.01 was used, total would be 2.50. With real rates (>= 15/kg), total is >= 3750.
    const orderTotal = res.data.data.total_amount;
    assert.ok(orderTotal > 1000, `Expected server-calculated total > 1000, but got ${orderTotal}`);
    assert.strictEqual(res.data.data.payment_status, 'pending');
  });

  it('2. MUST IGNORE client-submitted payment_status="paid" and force status="pending"', async () => {
    const res = await makeRequest({
      method: 'POST',
      path: '/api/orders',
      headers: { Authorization: `Bearer ${shopToken}` },
      body: {
        payment_type_id: 1,
        payment_status: 'paid', // Client attempting to declare itself already paid
        paid_amount: 99999.00,
        items: [
          {
            product_id: 1,
            quantity: 250
          }
        ]
      }
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.data.payment_status, 'pending', 'Order payment_status MUST be initialized to pending');
  });

  it('3. MUST REJECT order placed below minimum bulk quantity (400 Bad Request)', async () => {
    const res = await makeRequest({
      method: 'POST',
      path: '/api/orders',
      headers: { Authorization: `Bearer ${shopToken}` },
      body: {
        payment_type_id: 1,
        items: [
          {
            product_id: 1,
            quantity: 10 // Below 250kg minimum bulk threshold
          }
        ]
      }
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
    assert.match(res.data.message, /Minimum wholesale order quantity/i);
  });

  it('4. MUST ENFORCE server-calculated payment status on payment recording', async () => {
    // Create an order first with valid 250kg bulk quantity
    const createRes = await makeRequest({
      method: 'POST',
      path: '/api/orders',
      headers: { Authorization: `Bearer ${shopToken}` },
      body: {
        payment_type_id: 1,
        items: [{ product_id: 1, quantity: 250 }]
      }
    });
    const orderId = createRes.data.data.order_id;
    const total = createRes.data.data.total_amount;

    // Record partial payment: 50 Rs
    const partialRes = await makeRequest({
      method: 'POST',
      path: `/api/orders/${orderId}/payment`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { amount_paid: 50.00, payment_status: 'paid' } // Client tries to force 'paid'
    });
    assert.strictEqual(partialRes.status, 200);
    assert.strictEqual(partialRes.data.data.payment_status, 'partial', 'Status must be partial since 50 < total');

    // Record remaining payment to complete total
    const remaining = total - 50;
    const fullRes = await makeRequest({
      method: 'POST',
      path: `/api/orders/${orderId}/payment`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { amount_paid: remaining }
    });
    assert.strictEqual(fullRes.status, 200);
    assert.strictEqual(fullRes.data.data.payment_status, 'paid', 'Status must be paid when total is settled');
  });

});
