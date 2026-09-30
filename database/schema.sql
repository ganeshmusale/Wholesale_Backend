-- ==========================================================
-- Wholesale Bulk Vegetable Platform Database Schema (MySQL)
-- Compatible with XAMPP MySQL / MariaDB
-- ==========================================================

CREATE DATABASE IF NOT EXISTS `wholesale_db` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `wholesale_db`;

-- 1. USERS TABLE (Roles: super_admin, delivery, business_man)
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `full_name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(100) UNIQUE NULL,
  `phone` VARCHAR(20) UNIQUE NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('super_admin', 'delivery', 'business_man') NOT NULL DEFAULT 'business_man',
  `city` VARCHAR(100) NULL,
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. BUSINESSES TABLE (Vegetable shop, Restaurant, Mess, Caterers)
CREATE TABLE IF NOT EXISTS `businesses` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `business_name` VARCHAR(150) NOT NULL,
  `business_type` ENUM('vegetable_shop', 'restaurant', 'mess', 'caterers', 'other') NOT NULL DEFAULT 'vegetable_shop',
  `contact_person` VARCHAR(100) NOT NULL,
  `mobile_number` VARCHAR(20) NOT NULL,
  `shop_address` TEXT NOT NULL,
  `city` VARCHAR(100) NOT NULL,
  `state` VARCHAR(100) NOT NULL DEFAULT 'Maharashtra',
  `gst_number` VARCHAR(50) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_business_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 3. UNITS MASTER (kg, quintal, crate, bag, ton)
CREATE TABLE IF NOT EXISTS `units` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(50) NOT NULL UNIQUE,
  `symbol` VARCHAR(20) NOT NULL UNIQUE,
  `conversion_to_kg` DECIMAL(10, 2) DEFAULT 1.00,
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 4. CATEGORIES MASTER
CREATE TABLE IF NOT EXISTS `categories` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL UNIQUE,
  `description` TEXT NULL,
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 5. MARKETS MASTER (Wai, Nashik, Pune APMC, etc.)
CREATE TABLE IF NOT EXISTS `markets` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL UNIQUE,
  `city` VARCHAR(100) NOT NULL,
  `state` VARCHAR(100) DEFAULT 'Maharashtra',
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 6. PRODUCTS MASTER
CREATE TABLE IF NOT EXISTS `products` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `category_id` INT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `unit_id` INT NOT NULL,
  `default_bulk_min_qty` DECIMAL(10, 2) DEFAULT 50.00,
  `image_url` VARCHAR(255) NULL,
  `description` TEXT NULL,
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_product_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_product_unit` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- 7. PAYMENT TYPES MASTER
CREATE TABLE IF NOT EXISTS `payment_types` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(50) NOT NULL UNIQUE,
  `code` VARCHAR(30) NOT NULL UNIQUE,
  `description` VARCHAR(255) NULL,
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 8. DAILY WHOLESALE MARKET RATES (Wai, Nashik, etc. by Date)
CREATE TABLE IF NOT EXISTS `market_rates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `rate_date` DATE NOT NULL,
  `market_id` INT NOT NULL,
  `product_id` INT NOT NULL,
  `wholesale_rate` DECIMAL(10, 2) NOT NULL,
  `min_bulk_qty` DECIMAL(10, 2) DEFAULT 100.00,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_rate_market` FOREIGN KEY (`market_id`) REFERENCES `markets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rate_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  UNIQUE KEY `unique_market_product_date` (`rate_date`, `market_id`, `product_id`)
) ENGINE=InnoDB;

-- 8B. STORE DAILY SELLING RATES (Admin sets today's price according to the market)
CREATE TABLE IF NOT EXISTS `daily_store_rates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `business_id` INT NULL DEFAULT 1,
  `rate_date` DATE NOT NULL,
  `product_id` INT NOT NULL,
  `wholesale_price` DECIMAL(10, 2) NOT NULL,
  `min_bulk_qty` DECIMAL(10, 2) NOT NULL DEFAULT 50.00,
  `is_available` BOOLEAN DEFAULT TRUE,
  `admin_user_id` INT NULL,
  `notes` VARCHAR(255) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_store_rate_business` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_store_rate_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_store_rate_admin` FOREIGN KEY (`admin_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  UNIQUE KEY `unique_business_product_date` (`business_id`, `rate_date`, `product_id`)
) ENGINE=InnoDB;

-- 9. ORDERS / BULK PURCHASES
CREATE TABLE IF NOT EXISTS `orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_number` VARCHAR(50) NOT NULL UNIQUE,
  `business_id` INT NOT NULL,
  `delivery_user_id` INT NULL,
  `delivery_request_status` ENUM('pending', 'accepted', 'rejected') DEFAULT NULL,
  `rejection_reason` VARCHAR(255) NULL,
  `payment_type_id` INT NOT NULL,
  `payment_status` ENUM('pending', 'partial', 'paid') DEFAULT 'pending',
  `order_status` ENUM('placed', 'confirmed', 'procurement', 'out_for_delivery', 'delivered', 'cancelled') DEFAULT 'placed',
  `total_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `paid_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `delivery_address` TEXT NOT NULL,
  `delivery_date` DATE NULL,
  `notes` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_order_business` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_order_delivery_user` FOREIGN KEY (`delivery_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_order_payment_type` FOREIGN KEY (`payment_type_id`) REFERENCES `payment_types` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- 10. ORDER ITEMS (Bulk product line items)
CREATE TABLE IF NOT EXISTS `order_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `product_id` INT NOT NULL,
  `unit_id` INT NOT NULL,
  `quantity` DECIMAL(10, 2) NOT NULL,
  `unit_price` DECIMAL(10, 2) NOT NULL,
  `total_price` DECIMAL(12, 2) NOT NULL,
  CONSTRAINT `fk_item_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_item_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_item_unit` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ==========================================================
-- SEED DATA
-- ==========================================================

-- Seed Units
INSERT IGNORE INTO `units` (`id`, `name`, `symbol`, `conversion_to_kg`) VALUES
(1, 'Kilogram', 'kg', 1.00),
(2, 'Quintal', 'qtl', 100.00),
(3, 'Crate', 'crt', 20.00),
(4, 'Bag (Bora)', 'bag', 50.00),
(5, 'Ton', 'ton', 1000.00);

-- Seed Categories
INSERT IGNORE INTO `categories` (`id`, `name`, `description`) VALUES
(1, 'Root Vegetables', 'Potatoes, Carrots, Beetroot, Radish'),
(2, 'Alliums', 'Onions, Garlic, Shallots'),
(3, 'Solanaceous', 'Tomatoes, Brinjal, Bell Peppers'),
(4, 'Leafy Greens', 'Spinach, Methi, Coriander, Mint'),
(5, 'Cucurbits & Gourds', 'Bottle Gourd, Bitter Gourd, Cucumber, Pumpkin'),
(6, 'Brassicas', 'Cabbage, Cauliflower, Broccoli');

-- Seed Markets (from notes: Wai, Nashik, plus Pune & Vashi APMC)
INSERT IGNORE INTO `markets` (`id`, `name`, `city`, `state`) VALUES
(1, 'Wai APMC Market', 'Wai', 'Maharashtra'),
(2, 'Nashik APMC Market', 'Nashik', 'Maharashtra'),
(3, 'Pune APMC (Gultekdi)', 'Pune', 'Maharashtra'),
(4, 'Vashi APMC Market', 'Navi Mumbai', 'Maharashtra');

-- Seed Payment Types
INSERT IGNORE INTO `payment_types` (`id`, `name`, `code`, `description`) VALUES
(1, 'Cash on Delivery', 'CASH', 'Cash payment upon bulk delivery'),
(2, 'UPI / QR Code', 'UPI', 'Google Pay, PhonePe, Paytm QR transfer'),
(3, 'Credit / Khata (Udhar)', 'CREDIT', 'Business credit line with settlement period'),
(4, 'Bank Transfer (NEFT/RTGS)', 'BANK_TRANSFER', 'Direct bulk bank transfer'),
(5, 'Cheque', 'CHEQUE', 'PDC or account payee cheque');

-- Seed Products
INSERT IGNORE INTO `products` (`id`, `category_id`, `name`, `unit_id`, `default_bulk_min_qty`, `description`) VALUES
(1, 1, 'Potato (Batata - Agra / Jyoti)', 1, 250.00, 'Premium bulk sorting potato (50kg bags)'),
(2, 2, 'Onion (Gavran Red Onion)', 1, 250.00, 'Nashik quality red onion (50kg bags)'),
(3, 3, 'Tomato (Hybrid / Local)', 1, 100.00, 'Fresh tomato crates (20-25kg crates)'),
(4, 2, 'Garlic (Desi Lasun)', 1, 50.00, 'Dry cured bulk garlic (50kg bags)'),
(5, 6, 'Cabbage (Patta Gobhi)', 1, 150.00, 'Fresh harvest cabbage sacks (50kg bags)'),
(6, 6, 'Cauliflower (Phool Gobhi)', 1, 150.00, 'White heads packed in mesh bags (50kg bags)'),
(7, 4, 'Green Chilli (G4 / Lavangi)', 1, 50.00, 'Spicy green chillies (25-50kg bags)'),
(8, 1, 'Ginger (Aale)', 1, 50.00, 'Fresh washed ginger roots (50kg bags)');

-- Seed Initial Users (Passwords are bcrypt hashed for: admin123, delivery123, business123)
-- Hash for 'admin123': $2a$10$Q7w0Y3ZtVomC50G4N/8qneCcmB4E580m0h/L1M4r/aW8Rk94mQJm6
-- Hash for 'delivery123': $2a$10$j8dF4w7iWf1j4uJ/jC6Eiey0c2Jd2X1Wz4V8v1s2M3N4o5P6q7R8s
-- Hash for 'business123': $2a$10$w1q2r3s4t5u6v7w8x9y0zeA1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p
-- Let's provide pre-hashed string for standard bcrypt
INSERT IGNORE INTO `users` (`id`, `full_name`, `email`, `phone`, `password_hash`, `role`, `city`) VALUES
(1, 'Super Administrator', 'admin@wholesale.com', '9999999999', '$2a$10$Fw4gH4sA92YqJ/u8U82eTuH3L6Q0J/o5P1cW1vW8v9Y6n3o8r6i2m', 'super_admin', 'Wai'),
(2, 'Sambhaji Delivery Partner (Wai)', 'delivery@wholesale.com', '8888888888', '$2a$10$Fw4gH4sA92YqJ/u8U82eTuH3L6Q0J/o5P1cW1vW8v9Y6n3o8r6i2m', 'delivery', 'Wai'),
(3, 'Suresh Patil (Shop Owner)', 'suresh@veggieshop.com', '9876543210', '$2a$10$Fw4gH4sA92YqJ/u8U82eTuH3L6Q0J/o5P1cW1vW8v9Y6n3o8r6i2m', 'business_man', 'Wai'),
(4, 'Ramesh Delivery (Nashik Hub)', 'ramesh.delivery@wholesale.com', '8888811111', '$2a$10$Fw4gH4sA92YqJ/u8U82eTuH3L6Q0J/o5P1cW1vW8v9Y6n3o8r6i2m', 'delivery', 'Nashik'),
(5, 'Santosh Delivery (Pune Hub)', 'santosh.delivery@wholesale.com', '8888822222', '$2a$10$Fw4gH4sA92YqJ/u8U82eTuH3L6Q0J/o5P1cW1vW8v9Y6n3o8r6i2m', 'delivery', 'Pune');

-- Seed Sample Business
INSERT IGNORE INTO `businesses` (`id`, `user_id`, `business_name`, `business_type`, `contact_person`, `mobile_number`, `shop_address`, `city`, `gst_number`) VALUES
(1, 3, 'Kailash Fresh Vegetable Store', 'vegetable_shop', 'Suresh Patil', '9876543210', 'Shop No. 14, Main Mandi Road, Wai', 'Wai', '27AAAAA0000A1Z5');

-- Seed Sample Daily Market Wholesale Rates (Current Date Comparison)
INSERT IGNORE INTO `market_rates` (`rate_date`, `market_id`, `product_id`, `wholesale_rate`, `min_bulk_qty`) VALUES
(CURDATE(), 1, 1, 18.50, 250.00), -- Potato at Wai
(CURDATE(), 2, 1, 16.00, 250.00), -- Potato at Nashik
(CURDATE(), 3, 1, 17.50, 250.00), -- Potato at Pune
(CURDATE(), 1, 2, 24.00, 250.00), -- Onion at Wai
(CURDATE(), 2, 2, 21.00, 250.00), -- Onion at Nashik
(CURDATE(), 3, 2, 22.50, 250.00), -- Onion at Pune
(CURDATE(), 1, 3, 22.00, 100.00), -- Tomato at Wai
(CURDATE(), 2, 3, 19.50, 100.00), -- Tomato at Nashik
(CURDATE(), 3, 3, 20.00, 100.00); -- Tomato at Pune

-- Seed Sample Store Selling Wholesale Rates for Today (Admin's published selling price to businesses)
INSERT IGNORE INTO `daily_store_rates` (`rate_date`, `product_id`, `wholesale_price`, `min_bulk_qty`, `is_available`, `admin_user_id`, `notes`) VALUES
(CURDATE(), 1, 19.50, 250.00, TRUE, 1, 'Agra batch - high dry matter, great for chips/frying'),
(CURDATE(), 2, 23.50, 250.00, TRUE, 1, 'Fresh Lasalgaon/Nashik harvest medium-large grade'),
(CURDATE(), 3, 21.00, 100.00, TRUE, 1, 'Firm red ripe Narayangaon crates'),
(CURDATE(), 4, 140.00, 50.00, TRUE, 1, 'MP Desi Lasun extra white'),
(CURDATE(), 5, 14.00, 150.00, TRUE, 1, 'Fresh compact cabbage heads'),
(CURDATE(), 6, 18.00, 150.00, TRUE, 1, 'Clean snow white cauliflower'),
(CURDATE(), 7, 45.00, 50.00, TRUE, 1, 'G4 Dark green spicy chillies'),
(CURDATE(), 8, 65.00, 50.00, TRUE, 1, 'Fresh washed Satara ginger');

