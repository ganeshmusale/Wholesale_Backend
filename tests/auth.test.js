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

describe('Authentication & Role Escalation Security Tests', () => {

  it('1. MUST REJECT public registration with role=super_admin (403 Forbidden)', async () => {
    const fakeAdminPhone = `9${Date.now().toString().slice(-9)}`;
    const res = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: {
        full_name: 'Hacker Attempting Super Admin',
        phone: fakeAdminPhone,
        password: 'password123',
        role: 'super_admin'
      }
    });

    assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}`);
    assert.strictEqual(res.data.success, false);
    assert.match(res.data.message, /Role escalation forbidden/i);
  });

  it('2. Shop Owner registration forces role=business_man (password not required)', async () => {
    const shopPhone = `9${Date.now().toString().slice(-9)}`;
    const res = await makeRequest({
      method: 'POST',
      path: '/api/auth/shop/register',
      body: {
        full_name: 'Test Shop User',
        phone: shopPhone,
        business_name: 'Test Agro Shop',
        business_type: 'vegetable_shop',
        shop_address: 'Mandi Line 2',
        city: 'Wai'
      }
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.user.role, 'business_man');
    assert.ok(res.data.data.token, 'Must return JWT token');
  });

  it('3. Delivery registration forces role=delivery', async () => {
    const deliveryPhone = `9${Date.now().toString().slice(-9)}`;
    const res = await makeRequest({
      method: 'POST',
      path: '/api/auth/delivery/register',
      body: {
        full_name: 'Test Delivery Driver',
        phone: deliveryPhone,
        password: 'driverPassword123',
        city: 'Wai',
        shop_address: 'Bolero Pickup'
      }
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.user.role, 'delivery');
    assert.ok(res.data.data.token, 'Must return JWT token');
  });

  it('4. Rejects login with incorrect password (401 Unauthorized)', async () => {
    const res = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: {
        identifier: 'admin@wholesale.com',
        password: 'wrong_password_attempt'
      }
    });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.success, false);
  });

  it('5. Allows valid shop owner login via mobile number', async () => {
    const res = await makeRequest({
      method: 'POST',
      path: '/api/auth/shop/login',
      body: {
        phone: '9876543210'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.user.role, 'business_man');
    assert.ok(res.data.data.token);
  });

});
