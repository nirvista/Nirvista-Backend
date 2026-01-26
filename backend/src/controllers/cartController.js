const Cart = require('../models/Cart');
const Product = require('../models/Product');

const populateCart = (cart) => cart.populate('items.product', 'name images stock price salePrice currency');

const loadCart = async (userId) => {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) {
    cart = await Cart.create({ user: userId, items: [] });
  }
  return populateCart(cart);
};

const itemMatchesProduct = (item, productId) => {
  if (!item) return false;
  const populatedId = item.product?._id ? item.product._id.toString() : null;
  const referenceId = typeof item.product === 'string' ? item.product : null;
  return populatedId === productId || referenceId === productId;
};

const getCart = async (req, res) => {
  try {
    const cart = await loadCart(req.user._id);
    cart.recalculate();
    await cart.save();
    await populateCart(cart);
    res.json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const addItemToCart = async (req, res) => {
  const { productId, quantity = 1 } = req.body;

  if (!productId) {
    return res.status(400).json({ message: 'Product ID is required' });
  }

  const parsedQuantity = Number(quantity);

  if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
    return res.status(400).json({ message: 'Quantity must be greater than zero' });
  }

  try {
    const product = await Product.findById(productId);

    if (!product || !product.isActive) {
      return res.status(404).json({ message: 'Product not available' });
    }

    const cart = await loadCart(req.user._id);
    const existingItem = cart.items.find((item) => itemMatchesProduct(item, productId));
    const newQuantity = (existingItem ? existingItem.quantity : 0) + parsedQuantity;

    if (product.stock !== undefined && product.stock < newQuantity) {
      return res.status(400).json({ message: 'Insufficient stock' });
    }

    if (existingItem) {
      existingItem.quantity = newQuantity;
      existingItem.price = product.salePrice || product.price;
      existingItem.currency = product.currency || 'INR';
      existingItem.name = product.name;
      existingItem.image = product.images?.[0]?.url;
      existingItem.sku = product.sku;
    } else {
      cart.items.push({
        product: product._id,
        name: product.name,
        image: product.images?.[0]?.url,
        price: product.salePrice || product.price,
        currency: product.currency || 'INR',
        sku: product.sku,
        quantity: parsedQuantity,
      });
    }

    cart.recalculate();
    await cart.save();
    await populateCart(cart);

    res.status(201).json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateCartItem = async (req, res) => {
  const { itemId } = req.params;
  const { quantity } = req.body;

  const parsedQuantity = Number(quantity);

  if (!Number.isFinite(parsedQuantity)) {
    return res.status(400).json({ message: 'Quantity is required' });
  }

  try {
    const cart = await loadCart(req.user._id);
    const item = cart.items.id(itemId);

    if (!item) {
      return res.status(404).json({ message: 'Cart item not found' });
    }

    if (parsedQuantity <= 0) {
      item.deleteOne();
    } else {
      const product = await Product.findById(item.product);
      if (!product || !product.isActive) {
        return res.status(400).json({ message: 'Product unavailable' });
      }
      if (product.stock < parsedQuantity) {
        return res.status(400).json({ message: 'Insufficient stock' });
      }
      item.quantity = parsedQuantity;
      item.price = product.salePrice || product.price;
      item.currency = product.currency || 'INR';
    }

    cart.recalculate();
    await cart.save();
    await populateCart(cart);

    res.json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const removeCartItem = async (req, res) => {
  const { itemId } = req.params;

  try {
    const cart = await loadCart(req.user._id);
    const item = cart.items.id(itemId);

    if (!item) {
      return res.status(404).json({ message: 'Cart item not found' });
    }

    item.deleteOne();
    cart.recalculate();
    await cart.save();
    await populateCart(cart);

    res.json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const clearCart = async (req, res) => {
  try {
    const cart = await loadCart(req.user._id);
    cart.items = [];
    cart.recalculate();
    await cart.save();
    await populateCart(cart);

    res.json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getCart,
  addItemToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
};
