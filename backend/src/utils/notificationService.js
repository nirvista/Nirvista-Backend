const Notification = require('../models/Notification');

const createUserNotification = async ({
  userId,
  title,
  message,
  type = 'general',
  metadata,
}) => {
  if (!userId) return null;
  return Notification.create({
    audience: 'user',
    user: userId,
    title,
    message,
    type,
    metadata,
  });
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
};
