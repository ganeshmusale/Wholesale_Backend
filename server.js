const http = require('http');
const fs = require('fs');
const path = require('path');

// Prevent unhandled async errors (e.g. DB connection retries) from crashing Passenger on cPanel
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

// Auto-patch mysql2 for Node 10 / 12 compatibility on cPanel if needed
try {
  const mysql2PkgPath = require.resolve('mysql2/package.json');
  const mysql2Dir = path.dirname(mysql2PkgPath);

  const poolClusterPath = path.join(mysql2Dir, 'lib', 'pool_cluster.js');
  if (fs.existsSync(poolClusterPath)) {
    const content = fs.readFileSync(poolClusterPath, 'utf8');
    if (content.indexOf('node?.pool') !== -1) {
      fs.writeFileSync(poolClusterPath, content.replace(/node\?\.pool/g, '(node && node.pool)'), 'utf8');
    }
  }

  const tracingPath = path.join(mysql2Dir, 'lib', 'tracing.js');
  if (fs.existsSync(tracingPath)) {
    let content = fs.readFileSync(tracingPath, 'utf8');
    if (content.indexOf('?.') !== -1 || content.indexOf('??') !== -1) {
      content = content
        .replace(/typeof dc\?\.tracingChannel === 'function'/g, "Boolean(dc && typeof dc.tracingChannel === 'function')")
        .replace(/channel\.hasSubscribers \?\? channel\.start\?\.hasSubscribers \?\? false/g, 'Boolean(channel.hasSubscribers || (channel.start && channel.start.hasSubscribers))');
      fs.writeFileSync(tracingPath, content, 'utf8');
    }
  }
} catch (patchErr) {
  // Ignore if mysql2 is not yet resolved
}

let app;

try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });

  // Ensure JWT_SECRET is always available (with fallback if .env is not yet configured on cPanel)
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.warn('[SECURITY WARNING] JWT_SECRET not found in .env; using default production fallback secret.');
    process.env.JWT_SECRET = '59a12b2785e99d48f18bbc7ca013ce78acbef5f36a7eb36450636778a9c507f1';
  }

  const express = require('express');
  const cors = require('cors');
  const morgan = require('morgan');
  const { testConnection, pool } = require('./config/db');

  // Import route modules
  const authRoutes = require('./routes/authRoutes');
  const masterRoutes = require('./routes/masterRoutes');
  const businessRoutes = require('./routes/businessRoutes');
  const marketRateRoutes = require('./routes/marketRateRoutes');
  const orderRoutes = require('./routes/orderRoutes');
  const reportRoutes = require('./routes/reportRoutes');
  const purchaseRoutes = require('./routes/purchaseRoutes');

  app = express();
  const PORT = process.env.PORT || 5000;

  // Allowed origins for production (wholesale.shetkarimall.com) & local development
  const allowedOrigins = [
    'https://wholesale.shetkarimall.com',
    'http://wholesale.shetkarimall.com',
    'http://localhost:5173',
    'http://localhost:3000',
    process.env.CLIENT_URL
  ].filter(Boolean);

  // Core Middleware
  app.use(cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true
  }));
  app.use(morgan('dev'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health Check (includes live DB connectivity status)
  app.get('/api/health', async (req, res) => {
    let dbConnected = false;
    let dbError = null;
    try {
      const conn = await pool.getConnection();
      dbConnected = true;
      conn.release();
    } catch (e) {
      dbError = e.message;
    }
    res.json({
      status: 'healthy',
      node_version: process.version,
      database_connected: dbConnected,
      database_name: process.env.DB_NAME || 'wholesale_db',
      database_error: dbError,
      timestamp: new Date().toISOString(),
      service: 'Whole Sale Bulk Vegetable API'
    });
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/masters', masterRoutes);
  app.use('/api/business', businessRoutes);
  app.use('/api/rates', marketRateRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/purchases', purchaseRoutes);

  // Root route
  app.get('/', (req, res) => {
    res.json({
      message: 'Welcome to Whole Sale Bulk Vegetable Procurement API',
      domain: 'https://backsale.bhoopreet.com',
      frontend: 'https://wholesale.shetkarimall.com',
      node_version: process.version,
      endpoints: {
        health: '/api/health',
        auth: '/api/auth',
        masters: '/api/masters/all',
        rates: '/api/rates/consolidated',
        purchases: '/api/purchases',
        orders: '/api/orders',
        reports: '/api/reports/market-comparison'
      }
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
  });

  // Global Error Handler
  app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Internal Server Error',
      error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  });

  // Start Server synchronously so both `node server.js` and cPanel Phusion Passenger / lsnode.js attach immediately
  app.listen(PORT, () => {
    console.log(`Whole Sale Vegetable Backend running on port ${PORT}`);
    testConnection();
  });
} catch (startupError) {
  console.error('[STARTUP ERROR]', startupError);
  const fallbackPort = process.env.PORT || 5000;
  const fallbackServer = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      success: false,
      status: 'startup_error',
      hint: 'Please click "Run NPM Install" in cPanel -> Setup Node.js App and use Node.js 18+ or 20+.',
      node_version: process.version,
      error: startupError.message,
      stack: startupError.stack
    }, null, 2));
  });
  fallbackServer.listen(fallbackPort);
  app = fallbackServer;
}

module.exports = app;
