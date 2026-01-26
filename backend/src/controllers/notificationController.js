const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const {
  createUserNotification,
  createBroadcastNotification,
} = require('../utils/notificationService');

const listNotificationsUser = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {
      $or: [{ audience: 'broadcast' }, { user: req.user._id }],
    };

    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Notification.countDocuments(filter),
    ]);

    const data = notifications.map((notification) => {
      const doc = notification.toObject();
      const isRead =
        doc.audience === 'broadcast'
          ? (doc.readBy || []).some((id) => id.toString() === req.user._id.toString())
          : Boolean(doc.readAt);
      return { ...doc, isRead };
    });

    res.json({
      data,
      pagination: {
        total,
        page,
        limit,
        hasMore: skip + data.length < total,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const markNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid notification id' });
    }

    const notification = await Notification.findById(id);
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    if (notification.audience === 'user') {
      if (!notification.user || notification.user.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Not allowed' });
      }
      notification.readAt = notification.readAt || new Date();
    } else {
      const readBy = notification.readBy || [];
      if (!readBy.some((uid) => uid.toString() === req.user._id.toString())) {
        notification.readBy = [...readBy, req.user._id];
      }
    }

    await notification.save();
    res.json(notification);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const listNotificationsAdmin = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.type) {
      filter.type = req.query.type;
    }
    if (req.query.audience) {
      filter.audience = req.query.audience;
    }
    if (req.query.userId && mongoose.Types.ObjectId.isValid(req.query.userId)) {
      filter.user = req.query.userId;
    }

    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email mobile')
        .populate('createdBy', 'name email'),
      Notification.countDocuments(filter),
    ]);

    res.json({
      data: notifications,
      pagination: {
        total,
        page,
        limit,
        hasMore: skip + notifications.length < total,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const createNotificationAdmin = async (req, res) => {
  try {
    const { title, message, type, userId } = req.body || {};
    if (!title || !message) {
      return res.status(400).json({ message: 'title and message are required' });
    }

    if (userId) {
      const notification = await createUserNotification({
        userId,
        title,
        message,
        type,
        metadata: req.body?.metadata,
      });
      return res.status(201).json(notification);
    }

    const notification = await createBroadcastNotification({
      title,
      message,
      type,
      createdBy: req.user._id,
      metadata: req.body?.metadata,
    });

    return res.status(201).json(notification);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  listNotificationsUser,
  markNotificationRead,
  listNotificationsAdmin,
  createNotificationAdmin,
};
