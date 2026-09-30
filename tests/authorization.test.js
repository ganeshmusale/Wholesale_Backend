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

describe('Access Control & Authorization Tests', () => {
  let deliveryToken = null;
  let shopToken = null;

  it('Setup: Obtain tokens for delivery partner and shop owner', async () => {
    const deliveryLogin = await makeRequest({
      method: 'POST',
      path: '/api/auth/delivery/login',
      body: { identifier: '9123456780', password: 'securePassword123' }
    });
    assert.strictEqual(deliveryLogin.status, 200);
    deliveryToken = deliveryLogin.data.data.token;

    const shopLogin = await makeRequest({
      method: 'POST',
      path: '/api/auth/shop/login',
      body: { phone: '9876543210' }
    });
    assert.strictEqual(shopLogin.status, 200);
    shopToken = shopLogin.data.data.token;
  });

  it('1. MUST REJECT unauthenticated requests with 401 Unauthorized', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/orders'
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.success, false);
  });

  it('2. MUST FORBID non-admin (delivery partner) from updating APMC market rates (403 Forbidden)', async () => {
    const res = await makeRequest({
      method: 'POST',
      path: '/api/rates/save-rates',
      headers: { Authorization: `Bearer ${deliveryToken}` },
      body: {
        rate_date: '2026-09-14',
        market_id: 1,
        rates: [{ product_id: 1, wholesale_rate: 10.00 }]
      }
    });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.data.success, false);
  });

  it('3. MUST FORBID non-admin from accessing user directory (403 Forbidden)', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/auth/users',
      headers: { Authorization: `Bearer ${shopToken}` }
    });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.data.success, false);
  });

});
