const Notification = require('../models/Notification');
const User = require('../models/User');
const { getMessaging } = require('./firebaseAdmin');

const normalizeDataValue = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
};

const sendPushToUser = async ({ userId, title, message, type = 'general', metadata }) => {
  if (!userId) return;
  const messaging = getMessaging();
  if (!messaging) return;

  const user = await User.findById(userId).select('fcmTokens');
  const tokens = (user?.fcmTokens || [])
    .map((entry) => entry?.token)
    .filter(Boolean);

  if (!tokens.length) return;

  const data = {
    type: String(type),
  };

  if (metadata && typeof metadata === 'object') {
    Object.entries(metadata).forEach(([key, value]) => {
      data[key] = normalizeDataValue(value);
    });
  }

  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: String(title || 'Notification'),
      body: String(message || ''),
    },
    data,
  });

  const invalidTokens = [];
  response.responses.forEach((result, index) => {
    if (result.success) return;
    const code = result.error?.code || '';
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
      invalidTokens.push(tokens[index]);
    }
  });

  if (invalidTokens.length) {
    await User.updateOne(
      { _id: userId },
      {
        $pull: {
          fcmTokens: {
            token: { $in: invalidTokens },
          },
        },
      },
    );
  }
};

const createUserNotification = async ({
  userId,
  title,
  message,
  type = 'general',
  metadata,
}) => {
  if (!userId) return null;
  const notification = await Notification.create({
    audience: 'user',
    user: userId,
    title,
    message,
    type,
    metadata,
  });

  // Persisted notification should not fail when FCM is unavailable.
  sendPushToUser({ userId, title, message, type, metadata }).catch((error) => {
    console.error('Push notification send failed:', error.message);
  });

  return notification;
};

const createBroadcastNotification = async ({
  title,
  message,
  type = 'general',
  createdBy,
  metadata,
}) =>
  Notification.create({
    audience: 'broadcast',
    title,
    message,
    type,
    createdBy,
    metadata,
  });

module.exports = {
  createUserNotification,
  createBroadcastNotification,
  sendPushToUser,
};
