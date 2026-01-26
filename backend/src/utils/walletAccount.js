const WalletAccount = require('../models/WalletAccount');

const getOrCreateWalletAccount = async (userId) => {
  let wallet = await WalletAccount.findOne({ user: userId });
  if (!wallet) {
    wallet = await WalletAccount.create({ user: userId });
  }
  return wallet;
};

module.exports = {
  getOrCreateWalletAccount,
};
