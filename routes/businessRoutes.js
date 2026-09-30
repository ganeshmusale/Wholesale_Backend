const express = require('express');
const router = express.Router();
const businessController = require('../controllers/businessController');
const { verifyToken, authorizeRoles } = require('../middleware/auth');

router.get('/my-business', verifyToken, businessController.getMyBusiness);
router.post('/save-profile', verifyToken, businessController.saveBusinessProfile);
router.get('/all', verifyToken, authorizeRoles('super_admin', 'delivery'), businessController.getAllBusinesses);
router.post('/admin-create-shop-owner', verifyToken, authorizeRoles('super_admin'), businessController.adminCreateShopOwner);

module.exports = router;

