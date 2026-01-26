const multer = require('multer');
const path = require('path');

const parsedMax = Number(process.env.KYC_UPLOAD_MAX_MB);
const MAX_MB = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 5;
const storage = multer.memoryStorage();

const ALLOWED_IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif',
  'svg',
  'avif',
  'ico',
]);

const imageFileFilter = (_req, file, cb) => {
  const mime = (file.mimetype || '').toLowerCase();
  if (mime.startsWith('image/')) {
    return cb(null, true);
  }

  const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '');
  if (ext && ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    return cb(null, true);
  }

  return cb(new Error('Only image uploads are allowed'));
};

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

// Wrap multer to provide consistent JSON errors instead of crashing the request
const singleImageUpload = (fieldName = 'document') => (req, res, next) => {
  const handler = upload.single(fieldName);
  handler(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ message: err.message });
    }
    return next();
  });
};

module.exports = {
  singleImageUpload,
};
