const crypto = require('crypto');

const {
  PHONEPE_BASE_URL = 'https://api-preprod.phonepe.com/apis/pg-sandbox',
  PHONEPE_MERCHANT_ID = '',
  PHONEPE_SALT_KEY = '',
  PHONEPE_SALT_INDEX = '1',
} = process.env;

const PHONEPE_PAY_ENDPOINT = '/pg/v1/pay';

const buildChecksum = (payloadBase64) => {
  const signatureData = payloadBase64 + PHONEPE_PAY_ENDPOINT + PHONEPE_SALT_KEY;
  const hash = crypto.createHash('sha256').update(signatureData).digest('hex');
  return `${hash}###${PHONEPE_SALT_INDEX}`;
};

const createPhonePePaymentPayload = ({
  amount,
  orderId,
  merchantUserId,
  callbackUrl,
  redirectUrl,
  paymentInstrument = { type: 'PAY_PAGE' },
}) => {
  const payload = {
    merchantId: PHONEPE_MERCHANT_ID,
    merchantTransactionId: orderId,
    merchantUserId,
    amount: Math.round(amount * 100), // PhonePe expects paise
    redirectUrl: redirectUrl || callbackUrl,
    callbackUrl,
    paymentInstrument,
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const checksum = PHONEPE_MERCHANT_ID && PHONEPE_SALT_KEY ? buildChecksum(payloadBase64) : null;

  if (!PHONEPE_MERCHANT_ID || !PHONEPE_SALT_KEY) {
    console.log('[MOCK PHONEPE] Missing credentials, returning payload without checksum');
  }

  return {
    payload,
    payloadBase64,
    checksum,
    endpoint: `${PHONEPE_BASE_URL}${PHONEPE_PAY_ENDPOINT}`,
  };
};

module.exports = {
  createPhonePePaymentPayload,
};
