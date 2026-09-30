const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Validate critical security environment variables
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('\x1b[31m[CRITICAL SECURITY ERROR]\x1b[0m JWT_SECRET is missing or insufficiently random (< 32 chars). Please set a secure JWT_SECRET in .env.');
  process.exit(1);
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

// Core Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
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
    service: 'Wholesale Bulk Vegetable API',
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
    message: 'Welcome to Wholesale Bulk Vegetable Procurement API',
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

// Start Server
async function startServer() {
  await testConnection();
  app.listen(PORT, () => {
    console.log(`Wholesale Vegetable Backend running on port ${PORT}`);
    console.log(`Base URL: http://localhost:${PORT}`);
    console.log(`Health Check: http://localhost:${PORT}/api/health`);
    console.log(`Consolidated Rates: http://localhost:${PORT}/api/rates/consolidated`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = app;

