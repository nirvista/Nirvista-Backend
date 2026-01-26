const Category = require('../models/Category');
const Product = require('../models/Product');
const slugify = require('../utils/slugify');

const buildSlug = (base, providedSlug) => {
  return slugify(providedSlug || base);
};

const createCategory = async (req, res) => {
  const { name, description, slug } = req.body;

  if (!name) {
    return res.status(400).json({ message: 'Category name is required' });
  }

  try {
    const category = await Category.create({
      name,
      description,
      slug: buildSlug(name, slug),
    });

    res.status(201).json(category);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateCategory = async (req, res) => {
  const { id } = req.params;
  const { name, description, isActive, slug } = req.body;

  try {
    const category = await Category.findById(id);

    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    if (name) category.name = name;
    if (description !== undefined) category.description = description;
    if (isActive !== undefined) category.isActive = isActive;
    if (slug || name) category.slug = buildSlug(name || category.name, slug);

    await category.save();

    res.json(category);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteCategory = async (req, res) => {
  const { id } = req.params;

  try {
    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    await category.deleteOne();
    res.json({ message: 'Category deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const listCategories = async (req, res) => {
  try {
    const categories = await Category.find().sort({ createdAt: -1 });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const listProductsAdmin = async (req, res) => {
  try {
    const products = await Product.find()
      .populate('category', 'name slug')
      .sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const createProduct = async (req, res) => {
  const {
    name,
    description,
    price,
    salePrice,
    currency,
    stock,
    sku,
    category,
    attributes,
    images,
    isActive,
    slug,
  } = req.body;

  if (!name || price === undefined) {
    return res.status(400).json({ message: 'Product name and price are required' });
  }

  try {
    let categoryId = null;
    if (category) {
      const foundCategory = await Category.findById(category);
      if (!foundCategory) {
        return res.status(400).json({ message: 'Invalid category' });
      }
      categoryId = foundCategory._id;
    }

    const product = await Product.create({
      name,
      description,
      price,
      salePrice,
      currency,
      stock,
      sku,
      category: categoryId,
      attributes,
      images,
      isActive,
      slug: buildSlug(name, slug),
    });

    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateProduct = async (req, res) => {
  const { id } = req.params;
  const update = req.body || {};

  try {
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (update.category) {
      const foundCategory = await Category.findById(update.category);
      if (!foundCategory) {
        return res.status(400).json({ message: 'Invalid category' });
      }
      product.category = foundCategory._id;
    }

    Object.keys(update).forEach((key) => {
      if (['category', 'slug'].includes(key)) {
        return;
      }
      product[key] = update[key];
    });

    if (update.slug || update.name) {
      product.slug = buildSlug(update.name || product.name, update.slug);
    }

    await product.save();
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteProduct = async (req, res) => {
  const { id } = req.params;

  try {
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    await product.deleteOne();
    res.json({ message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createCategory,
  updateCategory,
  deleteCategory,
  listCategories,
  listProductsAdmin,
  createProduct,
  updateProduct,
  deleteProduct,
};
