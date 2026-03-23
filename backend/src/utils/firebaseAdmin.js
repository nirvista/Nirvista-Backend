let initialized = false;
let adminModule = null;

const getAdmin = () => {
  if (adminModule) return adminModule;
  try {
    // Lazy load so backend can run even when firebase-admin is not installed yet.
    adminModule = require('firebase-admin');
    return adminModule;
  } catch (_error) {
    return null;
  }
};

const parseServiceAccount = () => {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    try {
      return JSON.parse(rawJson);
    } catch (error) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', error.message);
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKeyRaw) {
    return null;
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKeyRaw.replace(/\\n/g, '\n'),
  };
};

const initFirebase = () => {
  const admin = getAdmin();
  if (!admin) return false;
  if (initialized) return true;
  if (admin.apps.length) {
    initialized = true;
    return true;
  }

  const serviceAccount = parseServiceAccount();
  if (!serviceAccount) return false;

  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    initialized = true;
    return true;
  } catch (error) {
    console.error('Firebase Admin initialization failed:', error.message);
    return false;
  }
};

const getMessaging = () => {
  const admin = getAdmin();
  if (!admin) return null;
  if (!initFirebase()) return null;
  return admin.messaging();
};

module.exports = {
  getMessaging,
  initFirebase,
};
