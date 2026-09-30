const express = require('express');
const router = express.Router();
const marketRateController = require('../controllers/marketRateController');
const { verifyToken, authorizeRoles } = require('../middleware/auth');

// Public / Customer live wholesale rates
router.get('/', marketRateController.getMarketRates);
router.get('/consolidated', marketRateController.getConsolidatedRates);
router.get('/today', marketRateController.getTodayCustomerRates);
router.get('/price-trend', marketRateController.getPriceTrendHistory);

// Store Admin & Shop Owner Daily Pricing Management (Both can change prices according to market)
router.get('/store-sheet', verifyToken, authorizeRoles('super_admin', 'business_man'), marketRateController.getDailyStorePriceSheet);
router.post('/save-store-sheet', verifyToken, authorizeRoles('super_admin', 'business_man'), marketRateController.saveDailyStorePriceSheet);


// APMC Market Mandi Benchmark Rates
router.post('/save-rates', verifyToken, authorizeRoles('super_admin'), marketRateController.saveMarketRates);

module.exports = router;

