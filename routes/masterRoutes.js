const express = require('express');
const router = express.Router();
const masterController = require('../controllers/masterController');
const { verifyToken, authorizeRoles } = require('../middleware/auth');

// All Masters summary (public or authenticated)
router.get('/all', masterController.getAllMastersSummary);

// Units Master
router.get('/units', masterController.getUnits);
router.post('/units', verifyToken, authorizeRoles('super_admin'), masterController.createUnit);
router.put('/units/:id', verifyToken, authorizeRoles('super_admin'), masterController.updateUnit);

// Categories Master
router.get('/categories', masterController.getCategories);
router.post('/categories', verifyToken, authorizeRoles('super_admin'), masterController.createCategory);
router.put('/categories/:id', verifyToken, authorizeRoles('super_admin'), masterController.updateCategory);
router.delete('/categories/:id', verifyToken, authorizeRoles('super_admin'), masterController.deleteCategory);

// Markets Master (Wai, Nashik, etc.)
router.get('/markets', masterController.getMarkets);
router.post('/markets', verifyToken, authorizeRoles('super_admin'), masterController.createMarket);
router.put('/markets/:id', verifyToken, authorizeRoles('super_admin'), masterController.updateMarket);

// Products Master
router.get('/products', masterController.getProducts);
router.post('/products', verifyToken, authorizeRoles('super_admin'), masterController.createProduct);
router.put('/products/:id', verifyToken, authorizeRoles('super_admin'), masterController.updateProduct);
router.delete('/products/:id', verifyToken, authorizeRoles('super_admin'), masterController.deleteProduct);

// Payment Types Master
router.get('/payment-types', masterController.getPaymentTypes);
router.post('/payment-types', verifyToken, authorizeRoles('super_admin'), masterController.createPaymentType);

// Business Types Master (Commercial buyer establishments)
router.get('/business-types', masterController.getBusinessTypes);
router.post('/business-types', verifyToken, authorizeRoles('super_admin'), masterController.createBusinessType);
router.put('/business-types/:id', verifyToken, authorizeRoles('super_admin'), masterController.updateBusinessType);
router.delete('/business-types/:id', verifyToken, authorizeRoles('super_admin'), masterController.deleteBusinessType);

module.exports = router;
