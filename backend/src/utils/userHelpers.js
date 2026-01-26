const User = require('../models/User');
const { normalizeMobileNumber } = require('./mobileNormalizer');

const ensureActiveUser = (user, res) => {
  if (user && user.isActive === false) {
    res.status(403).json({ message: 'Account is disabled' });
    return false;
  }
  return true;
};

const findUserByMobile = async (mobile, countryCode = '') => {
  const { variants } = normalizeMobileNumber(mobile, countryCode);
  if (!variants.length) return null;
  return User.findOne({ mobile: { $in: variants } });
};

module.exports = {
  ensureActiveUser,
  findUserByMobile,
};
