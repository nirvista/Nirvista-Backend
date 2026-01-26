const Cart = require('../models/Cart');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { createPhonePePaymentPayload } = require('../utils/phonePe');

const CALLBACK_URL = process.env.PHONEPE_CALLBACK_URL || 'https://your-domain.com/api/payments/phonepe/callback';

const ensureCartIsValid = async (cart) => {
  for (const item of cart.items) {
    const product = await Product.findById(item.product);
    if (!product || !product.isActive) {
      throw new Error(`Product ${item.name || item.product} is unavailable`);
    }
    if (product.stock < item.quantity) {
      throw new Error(`Insufficient stock for ${product.name}`);
    }
  }
};

const snapshotItems = (cart) => {
  return cart.items.map((item) => ({
    product: item.product,
    name: item.name,
    sku: item.sku,
    image: item.image,
    price: item.price,
    currency: item.currency,
    quantity: item.quantity,
    subtotal: item.price * item.quantity,
  }));
};

const calculateTotals = (cart, shipping = 0, taxes = 0) => {
  const subtotal = cart.subtotal || cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  return {
    subtotal,
    shipping,
    taxes,
    grandTotal: subtotal + shipping + taxes,
    currency: cart.currency || 'INR',
  };
};


const createOrder = async (req, res) => {
  const { shippingAddress, billingAddress, paymentMethod = 'phonepe', shippingFee = 0, taxes = 0 } = req.body;

  if (!shippingAddress) {
    return res.status(400).json({ message: 'Shipping address is required' });
  }

  try {
    const cart = await Cart.findOne({ user: req.user._id });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    await ensureCartIsValid(cart);
    cart.recalculate();
    await cart.save();

    const totals = calculateTotals(cart, shippingFee, taxes);
    const orderPayload = {
      user: req.user._id,
      items: snapshotItems(cart),
      totals,
      shippingAddress,
      billingAddress: billingAddress || shippingAddress,
      paymentMethod,
      status: 'pending',
      paymentStatus: paymentMethod === 'cod' ? 'pending' : 'initiated',
    };

    const order = await Order.create(orderPayload);

    let paymentSession = null;

    if (paymentMethod === 'phonepe') {
      const phonePeSession = createPhonePePaymentPayload({
        amount: totals.grandTotal,
        orderId: order._id.toString(),
        merchantUserId: req.user._id.toString(),
        callbackUrl: CALLBACK_URL,
      });

      order.phonePeOrderId = order._id.toString();
      order.phonePePaymentLink = phonePeSession.endpoint;
      order.phonePePayload = phonePeSession;
      await order.save();

      paymentSession = {
        endpoint: phonePeSession.endpoint,
        request: phonePeSession.payloadBase64,
        checksum: phonePeSession.checksum,
      };
    }

    await Cart.updateOne({ _id: cart._id }, { items: [], subtotal: 0 });

    res.status(201).json({
      order,
      paymentSession,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};



const getOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getOrderById = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const adminListOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const orders = await Order.find(filter).populate('user', 'name email mobile').sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const adminUpdateOrderStatus = async (req, res) => {
  const { id } = req.params;
  const { status, paymentStatus } = req.body;

  try {
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (status) order.status = status;
    if (paymentStatus) order.paymentStatus = paymentStatus;

    await order.save();
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


module.exports = {
  createOrder,
  getOrders,
  getOrderById,
  adminListOrders,
  adminUpdateOrderStatus,
};
