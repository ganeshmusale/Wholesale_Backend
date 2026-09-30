const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Ensure JWT_SECRET is always available (with fallback if .env is not yet configured on cPanel)
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.warn('[SECURITY WARNING] JWT_SECRET not found in .env; using default production fallback secret.');
  process.env.JWT_SECRET = '59a12b2785e99d48f18bbc7ca013ce78acbef5f36a7eb36450636778a9c507f1';
}

const { testConnection } = require('./config/db');

// Import route modules
const authRoutes = require('./routes/authRoutes');
const masterRoutes = require('./routes/masterRoutes');
const businessRoutes = require('./routes/businessRoutes');
const marketRateRoutes = require('./routes/marketRateRoutes');
const orderRoutes = require('./routes/orderRoutes');
const reportRoutes = require('./routes/reportRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Allowed origins for production (wholesale.bhoopreet.com) & local development
const allowedOrigins = [
  'https://wholesale.bhoopreet.com',
  'https://www.wholesale.bhoopreet.com',
  'https://backsale.bhoopreet.com',
  'http://backsale.bhoopreet.com',
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

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Whole Sale Bulk Vegetable API',
    database: process.env.DB_NAME || 'wholesale_db'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/masters', masterRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/rates', marketRateRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reports', reportRoutes);

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Whole Sale Bulk Vegetable Procurement API',
    domain: 'https://backsale.bhoopreet.com',
    frontend: 'https://wholesale.bhoopreet.com',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      masters: '/api/masters/all',
      rates: '/api/rates/consolidated',
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

module.exports = app;


