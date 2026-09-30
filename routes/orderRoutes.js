const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { verifyToken, authorizeRoles } = require('../middleware/auth');

router.post('/', verifyToken, orderController.createOrder);
router.get('/', verifyToken, orderController.getOrders);
router.get('/:id', verifyToken, orderController.getOrderById);
router.put('/:id/edit', verifyToken, authorizeRoles('business_man', 'super_admin'), orderController.editOrder);
router.put('/:id/status', verifyToken, authorizeRoles('super_admin', 'delivery'), orderController.updateOrderStatus);
router.put('/:id/respond-delivery', verifyToken, authorizeRoles('delivery', 'super_admin'), orderController.respondDeliveryRequest);
router.post('/:id/payment', verifyToken, authorizeRoles('super_admin', 'delivery'), orderController.recordPayment);

module.exports = router;
