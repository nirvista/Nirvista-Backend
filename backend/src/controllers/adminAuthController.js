const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { getOrCreateWalletAccount } = require('../utils/walletAccount');
const { sendOtpForUser, verifyUserOtp } = require('../utils/otpHelpers');
const { normalizeMobileNumber, getSmsDestination } = require('../utils/mobileNormalizer');
const { findUserByMobile, ensureActiveUser } = require('../utils/userHelpers');
const bcrypt = require('bcryptjs');
const PRIVILEGED_ROLES = ['admin', 'super_admin', 'support'];

// Keep this aligned with the legacy admin login accepted in authController.
const ADMIN_LOGIN_EMAIL = 'info@nirvista.in';
const ADMIN_LOGIN_PASSWORD = '12345678';

const isHardcodedAdminLogin = (email, password) =>
  email === ADMIN_LOGIN_EMAIL && password === ADMIN_LOGIN_PASSWORD;

const adminSignupInit = async (req, res) => {
  try {
    const { name, mobile, countryCode } = req.body || {};
    if (!name || !mobile) {
      return res.status(400).json({ message: 'Name and mobile are required' });
    }
    const {
      normalized,
      variants,
      raw,
      isValid,
    } = normalizeMobileNumber(mobile, countryCode);

    if (!isValid) {
      return res.status(400).json({ message: 'Valid mobile number is required' });
    }

    const smsDestination = getSmsDestination({
      variants,
      normalized,
      raw,
    });

    if (!smsDestination) {
      return res.status(400).json({ message: 'Unable to generate a sendable mobile identifier' });
    }

    let user = await findUserByMobile(mobile, countryCode);
    if (user && !PRIVILEGED_ROLES.includes(user.role)) {
      return res.status(403).json({ message: 'Mobile already associated with a non-admin account' });
    }

    if (!user) {
      user = await User.create({
        name,
        mobile: normalized,
        role: 'admin',
        isActive: true,
      });
    } else {
      user.name = name || user.name;
      user.role = 'admin';
      user.isActive = true;
      user.disabledAt = undefined;
      user.disabledReason = undefined;
      user.mobile = normalized;
      await user.save();
    }

    await sendOtpForUser({
      user,
      channel: 'mobile',
      purpose: 'admin_signup',
      destination: smsDestination,
    });

    res.status(200).json({
      message: 'OTP sent to admin mobile',
      userId: user._id,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const adminLoginOtpInit = async (req, res) => {
  try {
    const { mobile, countryCode } = req.body || {};
    if (!mobile) {
      return res.status(400).json({ message: 'Mobile number is required' });
    }

    const {
      normalized,
      variants,
      raw,
      isValid,
    } = normalizeMobileNumber(mobile, countryCode);

    if (!isValid) {
      return res.status(400).json({ message: 'Valid mobile number is required' });
    }

    const user = await findUserByMobile(mobile, countryCode);

    if (!user || !PRIVILEGED_ROLES.includes(user.role)) {
      return res.status(404).json({ message: 'Admin user not found' });
    }
    if (!ensureActiveUser(user, res)) return;

    const smsDestination = getSmsDestination({
      variants,
      normalized,
      raw,
    });

    if (!smsDestination) {
      return res.status(400).json({ message: 'Unable to send OTP to this number' });
    }

    await sendOtpForUser({
      user,
      channel: 'mobile',
      purpose: 'admin_login',
      destination: smsDestination,
    });

    res.json({ message: 'OTP sent to admin mobile', userId: user._id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const adminLoginOtpVerify = async (req, res) => {
  try {
    const { mobile, countryCode, otp } = req.body || {};
    if (!mobile || !otp) {
      return res.status(400).json({ message: 'Mobile number and OTP are required' });
    }

    const user = await findUserByMobile(mobile, countryCode);

    if (!user || !PRIVILEGED_ROLES.includes(user.role)) {
      return res.status(404).json({ message: 'Admin user not found' });
    }
    if (!ensureActiveUser(user, res)) return;

    const verification = verifyUserOtp({ user, otp, purpose: 'admin_login' });
    if (!verification.ok) {
      return res.status(400).json({ message: verification.message });
    }

    user.otp = undefined;
    user.isMobileVerified = true;
    await user.save();

    await getOrCreateWalletAccount(user._id);

    res.json({
      _id: user._id,
      name: user.name,
      mobile: user.mobile,
      token: generateToken(user._id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const adminLoginEmail = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // Backward-compatible hardcoded admin bootstrap for environments using legacy login.
    if (isHardcodedAdminLogin(normalizedEmail, password)) {
      let user = await User.findOne({ email: normalizedEmail });
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(ADMIN_LOGIN_PASSWORD, salt);

      if (!user) {
        user = await User.create({
          name: 'Admin',
          email: normalizedEmail,
          password: hashedPassword,
          role: 'admin',
          isEmailVerified: true,
          isActive: true,
        });
      } else {
        user.password = hashedPassword;
        user.role = 'admin';
        user.isEmailVerified = true;
        user.isActive = true;
        user.disabledAt = undefined;
        user.disabledReason = undefined;
        await user.save();
      }

      await getOrCreateWalletAccount(user._id);
      return res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        token: generateToken(user._id),
      });
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user || !user.password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    if (!ensureActiveUser(user, res)) return;

    if (!PRIVILEGED_ROLES.includes(user.role)) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    if (!user.isEmailVerified) {
      return res.status(403).json({ message: 'Email not verified' });
    }

    if (!(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    await getOrCreateWalletAccount(user._id);

    return res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  adminSignupInit,
  adminLoginEmail,
  adminLoginOtpInit,
  adminLoginOtpVerify,
};
