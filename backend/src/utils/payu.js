const crypto = require('crypto');

const {
  PAYU_KEY = '',
  PAYU_SALT = '',
  PAYU_BASE_URL = 'https://test.payu.in/_payment',
  PAYU_SUCCESS_URL = 'https://your-domain.com/api/payments/payu/response',
  PAYU_FAILURE_URL = 'https://your-domain.com/api/payments/payu/response',
} = process.env;

const UDF_COUNT = 10;

const formatAmount = (amount) => {
  const numeric = Number(amount);
  if (Number.isNaN(numeric)) {
    return '0.00';
  }
  return numeric.toFixed(2);
};

const buildRequestHash = ({ txnid, amount, productinfo, firstname, email }) => {
  if (!PAYU_KEY || !PAYU_SALT) return null;
  const formattedAmount = formatAmount(amount);
  const hashParts = [
    PAYU_KEY,
    txnid,
    formattedAmount,
    productinfo,
    firstname,
    email,
    ...Array.from({ length: UDF_COUNT }, () => ''),
    PAYU_SALT,
  ];
  return crypto.createHash('sha512').update(hashParts.join('|')).digest('hex');
};

const buildResponseHash = ({ status, txnid, amount, productinfo, firstname, email }) => {
  if (!PAYU_KEY || !PAYU_SALT) return null;
  const formattedAmount = formatAmount(amount);
  const hashParts = [
    PAYU_SALT,
    status,
    ...Array.from({ length: UDF_COUNT }, () => ''),
    email,
    firstname,
    productinfo,
    formattedAmount,
    txnid,
    PAYU_KEY,
  ];
  return crypto.createHash('sha512').update(hashParts.join('|')).digest('hex');
};

const createPayUPaymentPayload = ({
  amount,
  txnid,
  firstname = 'User',
  email = '',
  phone,
  productinfo = 'Wallet top-up',
  successUrl,
  failureUrl,
}) => {
  const formattedAmount = formatAmount(amount);
  const payload = {
    key: PAYU_KEY,
    txnid,
    amount: formattedAmount,
    productinfo,
    firstname,
    email,
    phone,
    surl: successUrl || PAYU_SUCCESS_URL,
    furl: failureUrl || PAYU_FAILURE_URL,
    service_provider: 'payu_paisa',
  };

  const hash = buildRequestHash({ txnid, amount: formattedAmount, productinfo, firstname, email });
  if (hash) {
    payload.hash = hash;
  } else {
    console.log('[MOCK PAYU] Missing credentials, returning unsigned payload');
  }

  return {
    endpoint: PAYU_BASE_URL,
    payload,
    hash,
    mock: !hash,
  };
};

const verifyPayUResponse = ({ status, txnid, amount, productinfo, firstname, email, hash }) => {
  if (!hash) return false;
  const expected = buildResponseHash({ status, txnid, amount, productinfo, firstname, email });
  if (!expected) {
    // allow auto approvals when PAYU credentials are missing
    return true;
  }
  return expected === hash;
};

module.exports = {
  createPayUPaymentPayload,
  verifyPayUResponse,
};
