const admin = require('firebase-admin');
const { normalizeMobileNumber } = require('./mobileNormalizer');

const OTP_MOBILE_PROVIDER = process.env.OTP_MOBILE_PROVIDER || 'twilio';
const FIREBASE_OTP_MAX_AGE_SECONDS = Number(process.env.FIREBASE_OTP_MAX_AGE_SECONDS || 300);

let firebaseAppInstance;

const isFirebaseOtpEnabled = () => OTP_MOBILE_PROVIDER === 'firebase';

const buildFirebaseCredential = () => {
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    return null;
  }

  return admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  });
};

const getFirebaseApp = () => {
  if (!isFirebaseOtpEnabled()) {
    return null;
  }
  if (firebaseAppInstance) {
    return firebaseAppInstance;
  }

  const credential = buildFirebaseCredential();
  if (!credential) {
    return null;
  }

  firebaseAppInstance = admin.initializeApp({ credential });
  return firebaseAppInstance;
};

const verifyFirebaseToken = async (idToken) => {
  const app = getFirebaseApp();
  if (!app) {
    return { ok: false, message: 'Firebase admin is not configured' };
  }

  try {
    const decoded = await app.auth().verifyIdToken(idToken);
    return { ok: true, decoded };
  } catch (error) {
    console.warn('Firebase token verification failed', error.message || error);
    return { ok: false, message: 'Invalid Firebase token' };
  }
};

const normalizeDigits = (value) => {
  const { digits } = normalizeMobileNumber(value || '');
  return (digits || '').replace(/^0+/, '');
};

const isSamePhone = (userPhone, firebasePhone) => {
  const userDigits = normalizeDigits(userPhone);
  const firebaseDigits = normalizeDigits(firebasePhone);
  if (!userDigits || !firebaseDigits) {
    return false;
  }
  if (userDigits === firebaseDigits) {
    return true;
  }
  const sliceUser = userDigits.slice(-10);
  const sliceFirebase = firebaseDigits.slice(-10);
  return sliceUser && sliceFirebase && sliceUser === sliceFirebase;
};

const isTokenFresh = (decoded) => {
  if (!FIREBASE_OTP_MAX_AGE_SECONDS || !decoded.auth_time) {
    return true;
  }
  const issuedAtMs = decoded.auth_time * 1000;
  return Date.now() - issuedAtMs < FIREBASE_OTP_MAX_AGE_SECONDS * 1000;
};

const verifyFirebaseOtpForUser = async ({ user, firebaseToken, purpose }) => {
  if (!firebaseToken) {
    return { ok: false, message: 'Firebase OTP token is required' };
  }

  if (!isFirebaseOtpEnabled()) {
    return { ok: false, message: 'Firebase OTP provider is not enabled on the server' };
  }

  const { ok, decoded, message } = await verifyFirebaseToken(firebaseToken);
  if (!ok) {
    return { ok: false, message };
  }

  if (!decoded.phone_number) {
    return { ok: false, message: 'Firebase token does not contain a phone number' };
  }

  if (!isSamePhone(user.mobile, decoded.phone_number)) {
    return { ok: false, message: 'Firebase phone number does not match the user record' };
  }

  if (decoded.firebase?.sign_in_provider !== 'phone') {
    return { ok: false, message: 'Firebase token must originate from phone authentication' };
  }

  if (!isTokenFresh(decoded)) {
    return { ok: false, message: 'Firebase OTP session is too old' };
  }

  return { ok: true, decoded };
};

module.exports = {
  isFirebaseOtpEnabled,
  verifyFirebaseOtpForUser,
};
