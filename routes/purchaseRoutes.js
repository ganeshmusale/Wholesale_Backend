const express = require('express');
const router = express.Router();
const purchaseController = require('../controllers/purchaseController');
const { verifyToken, authorizeRoles } = require('../middleware/auth');

// All purchase routes require super_admin authorization
router.use(verifyToken);
router.use(authorizeRoles('super_admin'));

// Summary endpoint must be placed before /:id parameter route
router.get('/summary', purchaseController.getPurchaseSummary);

// Standard CRUD endpoints
router.get('/', purchaseController.getPurchases);
router.post('/', purchaseController.createPurchase);
router.put('/:id', purchaseController.updatePurchase);
router.delete('/:id', purchaseController.deletePurchase);

module.exports = router;
