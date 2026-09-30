const mysql = require('mysql2/promise');
const path = require('path');
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
  dateStrings: true
});

// Test connection function
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log(`Connected to MySQL database "${process.env.DB_NAME || 'wholesale_db'}" successfully.✅`);
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
