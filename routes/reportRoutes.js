const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { verifyToken, authorizeRoles } = require('../middleware/auth');

router.get('/market-comparison', reportController.getMarketComparisonReport);
router.get('/dashboard-summary', verifyToken, authorizeRoles('super_admin'), reportController.getDashboardSummary);
router.get('/sales', verifyToken, authorizeRoles('super_admin'), reportController.getSalesReport);
router.get('/procurement', verifyToken, authorizeRoles('super_admin'), reportController.getProcurementReport);
router.get('/purchases', verifyToken, authorizeRoles('super_admin'), reportController.getPurchasesReport);
router.get('/delivery', verifyToken, authorizeRoles('super_admin'), reportController.getDeliveryReport);
router.get('/khata-ledger', verifyToken, authorizeRoles('super_admin'), reportController.getKhataLedgerReport);

module.exports = router;
