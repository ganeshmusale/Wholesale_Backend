const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function initializeDatabase() {
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    multipleStatements: true
  };

  console.log(`Connecting to MySQL at ${dbConfig.host}:${dbConfig.port} as user '${dbConfig.user}'...`);

  try {
    // 1. Connect to MySQL server without database
    const connection = await mysql.createConnection(dbConfig);
    console.log(' Connected to MySQL server successfully.');

    // 2. Read schema.sql
    const schemaPath = path.join(__dirname, 'schema.sql');
    let schemaSql = fs.readFileSync(schemaPath, 'utf8');

    // Generate password hash from environment variable or fallback for initial setup
    const initialPass = process.env.ADMIN_INITIAL_PASSWORD || 'ChangeMeImmediately#2026';
    const salt = await bcrypt.genSalt(10);
    const defaultHash = await bcrypt.hash(initialPass, salt);

    // Replace dummy hashes with fresh valid bcrypt hash
    schemaSql = schemaSql.replace(
      /\$2a\$10\$[A-Za-z0-9./]{53}/g,
      () => defaultHash
    );

    // Check and add city column to users table if already exists without it
    await connection.query('USE wholesale_db;');
    const [cols] = await connection.query("SHOW COLUMNS FROM users LIKE 'city'");
    if (cols.length === 0) {
      await connection.query("ALTER TABLE users ADD COLUMN city VARCHAR(100) NULL AFTER role");
      console.log(' Added city column to users table.');
    }

    // Check and add delivery_request_status & rejection_reason to orders table
    const [orderCols1] = await connection.query("SHOW COLUMNS FROM orders LIKE 'delivery_request_status'");
    if (orderCols1.length === 0) {
      await connection.query("ALTER TABLE orders ADD COLUMN delivery_request_status ENUM('pending', 'accepted', 'rejected') DEFAULT NULL AFTER delivery_user_id");
      console.log(' Added delivery_request_status column to orders.');
    }
    const [orderCols2] = await connection.query("SHOW COLUMNS FROM orders LIKE 'rejection_reason'");
    if (orderCols2.length === 0) {
      await connection.query("ALTER TABLE orders ADD COLUMN rejection_reason VARCHAR(255) NULL AFTER delivery_request_status");
      console.log(' Added rejection_reason column to orders.');
    }

    console.log('Executing database schema and initial seed data...');
    await connection.query(schemaSql);

    // Explicitly ensure default users have the verified bcrypt hash
    await connection.query(
      'UPDATE users SET password_hash = ? WHERE email IN (?, ?, ?)',
      [defaultHash, 'admin@wholesale.com', 'delivery@wholesale.com', 'suresh@veggieshop.com']
    );

    console.log(' Database "wholesale_db" and all master tables initialized successfully!');
    console.log('\n[SECURITY NOTE] Default administrative accounts provisioned.');
    console.log('Please rotate all administrator credentials prior to production deployment.');

    await connection.end();
  } catch (error) {
    console.error(' Database initialization failed:');
    console.error(error.message);
    console.error('\nNOTE: If MySQL is not running, please start Apache and MySQL from XAMPP Control Panel.');
    process.exit(1);
  }
}

if (require.main === module) {
  initializeDatabase();
}

module.exports = initializeDatabase;
