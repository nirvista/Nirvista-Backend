const cloudinary = require('../config/cloudinary');

const isCloudinaryConfigured = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET,
  );

const uploadImageBuffer = (buffer, { folder, publicId } = {}) =>
  new Promise((resolve, reject) => {
    if (!isCloudinaryConfigured()) {
      return reject(new Error('Cloudinary is not configured. Please set CLOUDINARY_* env vars.'));
    }

    const uploadOptions = {
      folder,
      public_id: publicId,
      overwrite: true,
      resource_type: 'image',
    };

    const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
      if (error) return reject(error);
      return resolve(result);
    });

    stream.end(buffer);
  });

const deleteFromCloudinary = async (publicId) => {
  if (!publicId || !isCloudinaryConfigured()) return null;
  return cloudinary.uploader.destroy(publicId);
};

module.exports = {
  uploadImageBuffer,
  deleteFromCloudinary,
  isCloudinaryConfigured,
};
