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

describe('Pagination & Query Limit 10 Tests', () => {
  let adminToken = null;
  let shopToken = null;

  it('Setup: Authenticate users', async () => {
    const adminLogin = await makeRequest({
      method: 'POST',
      path: '/api/auth/admin/login',
      body: { identifier: 'admin@wholesale.com', password: 'admin123' }
    });
    assert.strictEqual(adminLogin.status, 200);
    adminToken = adminLogin.data.data.token;

    const shopLogin = await makeRequest({
      method: 'POST',
      path: '/api/auth/shop/login',
      body: { phone: '9876543210' }
    });
    assert.strictEqual(shopLogin.status, 200);
    shopToken = shopLogin.data.data.token;
  });

  it('1. Orders endpoint defaults to limit 10 with pagination metadata', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/orders',
      headers: { Authorization: 'Bearer ' + adminToken }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.pagination, 'Should contain pagination metadata');
    assert.strictEqual(res.data.pagination.limit, 10, 'Default limit must be 10');
    assert.strictEqual(res.data.pagination.page, 1, 'Default page must be 1');
    assert.ok(typeof res.data.pagination.total === 'number', 'Total count should be number');
    assert.ok(Array.isArray(res.data.data));
    assert.ok(res.data.data.length <= 10, 'Returned rows must be at most 10');
  });

  it('2. Users directory endpoint defaults to limit 10 with pagination', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/auth/users',
      headers: { Authorization: 'Bearer ' + adminToken }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.pagination);
    assert.strictEqual(res.data.pagination.limit, 10);
    assert.ok(res.data.data.length <= 10);
  });

  it('3. Business directory endpoint defaults to limit 10 with pagination', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/business/all',
      headers: { Authorization: 'Bearer ' + adminToken }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.pagination);
    assert.strictEqual(res.data.pagination.limit, 10);
    assert.ok(res.data.data.length <= 10);
  });

  it('4. Products endpoint supports limit 10 pagination', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/masters/products?page=1&limit=10',
      headers: { Authorization: 'Bearer ' + adminToken }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.pagination);
    assert.strictEqual(res.data.pagination.limit, 10);
    assert.ok(res.data.data.length <= 10);
  });

  it('5. Products endpoint supports limit=all for dropdown lookups', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/masters/products?limit=all',
      headers: { Authorization: 'Bearer ' + adminToken }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.pagination);
    assert.strictEqual(res.data.pagination.page, 1);
  });
});
