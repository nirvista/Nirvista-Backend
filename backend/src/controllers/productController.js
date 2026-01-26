const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');

const buildQueryFilters = (query = {}) => {
  const filters = { isActive: true };

  if (query.category) {
    filters.category = query.category;
  }

  if (query.search) {
    filters.name = { $regex: query.search, $options: 'i' };
  }

  if (query.minPrice || query.maxPrice) {
    filters.price = {};
    if (query.minPrice) filters.price.$gte = Number(query.minPrice);
    if (query.maxPrice) filters.price.$lte = Number(query.maxPrice);
  }

  return filters;
};

const getProducts = async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 12;

  try {
    const filters = buildQueryFilters(req.query);
    const total = await Product.countDocuments(filters);
    const products = await Product.find(filters)
      .populate('category', 'name slug')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      data: products,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getProduct = async (req, res) => {
  const { idOrSlug } = req.params;

  try {
    const filters = [{ slug: idOrSlug }];

    if (mongoose.Types.ObjectId.isValid(idOrSlug)) {
      filters.unshift({ _id: idOrSlug });
    }

    const product = await Product.findOne({
      $or: filters,
      isActive: true,
    }).populate('category', 'name slug description');

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getCategoriesPublic = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ name: 1 });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getProducts,
  getProduct,
  getCategoriesPublic,
};
