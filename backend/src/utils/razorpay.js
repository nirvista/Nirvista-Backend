const https = require('https');
const crypto = require('crypto');

const {
  RAZORPAY_KEY_ID = '',
  RAZORPAY_KEY_SECRET = '',
  RAZORPAY_BASE_URL = 'https://api.razorpay.com',
} = process.env;

const ORDERS_ENDPOINT = '/v1/orders';

const authHeader = () => {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) return null;
  const token = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
  return `Basic ${token}`;
};

const createOrder = ({
  amount,
  currency = 'INR',
  receipt,
  notes,
}) => new Promise((resolve, reject) => {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return resolve({
      mock: true,
      id: `order_${receipt || Date.now()}`,
      amount: Math.round(amount * 100),
      currency,
      receipt,
      status: 'created',
      notes,
    });
  }

  const payload = JSON.stringify({
    amount: Math.round(amount * 100),
    currency,
    receipt,
    notes,
    payment_capture: 1,
  });

  const options = {
    method: 'POST',
    hostname: RAZORPAY_BASE_URL.replace('https://', '').replace('http://', ''),
    path: ORDERS_ENDPOINT,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(json);
        } else {
          reject(new Error(json.error?.description || 'Razorpay order creation failed'));
        }
      } catch (err) {
        reject(err);
      }
    });
  });

  req.on('error', reject);
  req.write(payload);
  req.end();
});

const verifySignature = ({ orderId, paymentId, signature }) => {
  if (!orderId || !paymentId || !signature) return false;
  if (!RAZORPAY_KEY_SECRET) return true; // in mock mode, skip strict check
  const body = `${orderId}|${paymentId}`;
  const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(body).digest('hex');
  return expected === signature;
};

module.exports = {
  createOrder,
  verifySignature,
  RAZORPAY_KEY_ID,
};
