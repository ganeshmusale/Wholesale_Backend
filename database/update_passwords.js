const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

async function updatePasswords() {
  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('admin123', salt);

    console.log('Generated valid bcrypt hash for "admin123"');

    // Verify hash matches
    const verify = await bcrypt.compare('admin123', hash);
    console.log('Self-verification test:', verify ? 'PASSED ✅' : 'FAILED ❌');

    // Run migration for business_types
    await pool.query(`
      CREATE TABLE IF NOT EXISTS business_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        code VARCHAR(50) NOT NULL UNIQUE,
        description TEXT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    await pool.query("ALTER TABLE businesses MODIFY COLUMN business_type VARCHAR(100) NOT NULL DEFAULT 'vegetable_shop'");

    const [typesCount] = await pool.query('SELECT COUNT(*) as count FROM business_types');
    if (typesCount[0].count === 0) {
      await pool.query(`
        INSERT INTO business_types (name, code, description) VALUES
        ('Vegetable Shop (भाजीपाला दुकान)', 'vegetable_shop', 'Retail & Mandi vegetable retail sellers'),
        ('Restaurant / Hotel', 'restaurant', 'Food service restaurants and hotels'),
        ('Mess / Canteen (खानवळ)', 'mess', 'Student & worker mess canteens'),
        ('Eaters / Caterers (केटरर्स)', 'caterers', 'Event caterers and bulk wedding cookers'),
        ('Other Commercial Buyer', 'other', 'General bulk institutions and marts')
      `);
      console.log('business_types seeded successfully.');
    } else {
      console.log('business_types already seeded.');
    }

    process.exit(0);
  } catch (err) {
    console.error('Error updating passwords:', err);
    process.exit(1);
  }
}

updatePasswords();
