const AppSetting = require('../models/AppSetting');

const ICO_PRICE_KEY = 'ICO_PRICE_INR';
const DEFAULT_PRICE = Number(process.env.ICO_PRICE_INR || process.env.ICO_TOKEN_PRICE_INR || 10);

let cachedPrice = DEFAULT_PRICE;

const sanitizePrice = (value) => {
  const num = Number(value);
  if (Number.isNaN(num) || num <= 0) {
    return DEFAULT_PRICE;
  }
  return num;
};

const initTokenPrice = async () => {
  try {
    const setting = await AppSetting.findOne({ key: ICO_PRICE_KEY });
    if (setting) {
      cachedPrice = sanitizePrice(setting.value);
    } else {
      cachedPrice = sanitizePrice(DEFAULT_PRICE);
    }
  } catch (error) {
    console.error('Failed to load token price from settings', error);
    cachedPrice = sanitizePrice(DEFAULT_PRICE);
  }
};

const getTokenPrice = () => cachedPrice;

const setTokenPrice = async (value) => {
  const parsed = sanitizePrice(value);
  await AppSetting.findOneAndUpdate(
    { key: ICO_PRICE_KEY },
    { value: parsed },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  cachedPrice = parsed;
  return parsed;
};

const getTokenSymbol = () => process.env.ICO_TOKEN_SYMBOL || 'ICOX';

module.exports = {
  getTokenPrice,
  setTokenPrice,
  initTokenPrice,
  getTokenSymbol,
};
