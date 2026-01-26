const express = require('express');
const router = express.Router();
const {
  getProducts,
  getProduct,
  getCategoriesPublic,
} = require('../controllers/productController');

router.get('/', getProducts);
router.get('/categories/list', getCategoriesPublic);
router.get('/:idOrSlug', getProduct);

module.exports = router;
