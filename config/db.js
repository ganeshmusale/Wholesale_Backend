const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'wholesale_db',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  multipleStatements: true
});

// Test connection and auto-initialize tables if database is empty (for cPanel deployment)
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    const dbName = process.env.DB_NAME || 'wholesale_db';
    console.log(`Connected to MySQL database "${dbName}" successfully.✅`);

    try {
      const [tables] = await connection.query("SHOW TABLES LIKE 'users'");
      if (tables.length === 0) {
        console.log('No tables found in database. Auto-initializing schema and seed data...');
        const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
        let schemaSql = fs.readFileSync(schemaPath, 'utf8');
        // Remove hardcoded CREATE DATABASE and USE statements for cPanel shared DB compatibility
        schemaSql = schemaSql
          .replace(/CREATE DATABASE IF NOT EXISTS\s+`?wholesale_db`?[^;]*;/gi, '')
          .replace(/USE\s+`?wholesale_db`?\s*;/gi, '');

        const defaultPass = process.env.ADMIN_INITIAL_PASSWORD || 'admin123';
        const salt = await bcrypt.genSalt(10);
        const defaultHash = await bcrypt.hash(defaultPass, salt);
        schemaSql = schemaSql.replace(/\$2a\$10\$[A-Za-z0-9./]{53}/g, () => defaultHash);

        await connection.query(schemaSql);
        await connection.query(
          'UPDATE users SET password_hash = ? WHERE email IN (?, ?, ?)',
          [defaultHash, 'admin@wholesale.com', 'delivery@wholesale.com', 'suresh@veggieshop.com']
        );
        console.log('Database schema and default accounts initialized automatically!✅');
      }
    } catch (initErr) {
      console.warn('Auto-schema check warning:', initErr.message);
    }

    connection.release();
    return true;
  } catch (error) {
    console.error('MySQL connection error: ❌', error.message);
    return false;
  }
}

module.exports = {
  pool,
  testConnection
};

