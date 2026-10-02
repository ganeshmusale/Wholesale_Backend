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

      // Ensure 'purchases' table exists for Admin Haat & Mandi procurement
      const [purchaseTable] = await connection.query("SHOW TABLES LIKE 'purchases'");
      if (purchaseTable.length === 0) {
        console.log('Creating "purchases" table for Admin Haat/Mandi procurement...');
        await connection.query(`
          CREATE TABLE IF NOT EXISTS \`purchases\` (
            \`id\` INT AUTO_INCREMENT PRIMARY KEY,
            \`purchase_date\` DATE NOT NULL,
            \`product_id\` INT NOT NULL,
            \`market_id\` INT NULL,
            \`market_name\` VARCHAR(150) NULL,
            \`supplier_name\` VARCHAR(150) NULL,
            \`unit_id\` INT NOT NULL DEFAULT 1,
            \`quantity\` DECIMAL(10, 2) NOT NULL,
            \`unit_price\` DECIMAL(10, 2) NOT NULL,
            \`total_price\` DECIMAL(12, 2) NOT NULL,
            \`lot_number\` VARCHAR(50) NULL,
            \`transport_cost\` DECIMAL(10, 2) DEFAULT 0.00,
            \`payment_status\` ENUM('paid', 'pending', 'partial') DEFAULT 'paid',
            \`notes\` VARCHAR(255) NULL,
            \`created_by\` INT NULL,
            \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT \`fk_purchase_product\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE RESTRICT,
            CONSTRAINT \`fk_purchase_market\` FOREIGN KEY (\`market_id\`) REFERENCES \`markets\` (\`id\`) ON DELETE SET NULL,
            CONSTRAINT \`fk_purchase_unit\` FOREIGN KEY (\`unit_id\`) REFERENCES \`units\` (\`id\`) ON DELETE RESTRICT,
            CONSTRAINT \`fk_purchase_user\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL,
            INDEX \`idx_purchase_date\` (\`purchase_date\`),
            INDEX \`idx_purchase_product\` (\`product_id\`),
            INDEX \`idx_purchase_market\` (\`market_id\`)
          ) ENGINE=InnoDB;
        `);
        await connection.query(`
          INSERT IGNORE INTO \`purchases\` (\`id\`, \`purchase_date\`, \`product_id\`, \`market_id\`, \`market_name\`, \`supplier_name\`, \`unit_id\`, \`quantity\`, \`unit_price\`, \`total_price\`, \`notes\`) VALUES
          (1, CURDATE(), 1, 1, 'Wai APMC Market', 'Kisan Patil (Farmer)', 1, 150.00, 20.00, 3000.00, 'Batch 1 - Wai Haat purchase'),
          (2, CURDATE(), 1, 2, 'Nashik APMC Market', 'Shinde Traders', 1, 250.00, 18.00, 4500.00, 'Batch 2 - Nashik Mandi lot'),
          (3, CURDATE(), 2, 2, 'Nashik APMC Market', 'Lasalgaon Mandi Trader', 1, 300.00, 21.00, 6300.00, 'Medium grade onion'),
          (4, CURDATE(), 3, 1, 'Wai APMC Market', 'Ramesh Farmer', 1, 100.00, 19.50, 1950.00, 'Fresh tomato crates');
        `);
        console.log('Table "purchases" created and initialized with sample lots!✅');
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

