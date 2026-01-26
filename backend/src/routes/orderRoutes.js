const express = require('express');
const router = express.Router();
const {
  createOrder,
  getOrders,
  getOrderById,
  adminListOrders,
  adminUpdateOrderStatus,
} = require('../controllers/orderController');
const { protect, requireAdmin } = require('../middleware/authMiddleware');

router.use(protect);

router.post('/', createOrder);
router.get('/', getOrders);
router.get('/admin', requireAdmin, adminListOrders);
router.patch('/admin/:id', requireAdmin, adminUpdateOrderStatus);
router.get('/:id', getOrderById);

module.exports = router;
