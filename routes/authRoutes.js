const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken, authorizeRoles } = require('../middleware/auth');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/login-mobile', authController.loginWithMobile);
router.post('/login-role', authController.loginByRole);
router.get('/me', verifyToken, authController.getProfile);
router.get('/users', verifyToken, authorizeRoles('super_admin'), authController.getAllUsers);

// Dedicated Role-Specific APIs
router.post('/admin/login', authController.loginAdmin);
router.post('/shop/login', authController.loginShop);
router.post('/shop/register', authController.registerShop);
router.post('/delivery/login', authController.loginDelivery);
router.post('/delivery/register', authController.registerDelivery);

module.exports = router;

