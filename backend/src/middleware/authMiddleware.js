const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      req.user = await User.findById(decoded.id).select('-password -pin');
      if (!req.user) {
        return res.status(401).json({ message: 'Not authorized, user not found' });
      }

      if (req.user.isActive === false) {
        const reason = req.user.disabledReason ? ` Reason: ${req.user.disabledReason}` : '';
        return res.status(403).json({ message: `Account suspended. Contact support.${reason}` });
      }

      next();
    } catch (error) {
      console.error(error);
      res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};

const requireRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Insufficient permissions' });
  }
  next();
};

const requireAdmin = requireRoles('admin', 'super_admin');
const requirePrivileged = requireRoles('support', 'admin', 'super_admin');
const requireSuperAdmin = requireRoles('super_admin');

module.exports = { protect, requireAdmin, requireRoles, requirePrivileged, requireSuperAdmin };
