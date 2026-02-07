const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { getOrCreateWalletAccount } = require('../utils/walletAccount');
const { sendOtpForUser, verifyUserOtp } = require('../utils/otpHelpers');
const { normalizeMobileNumber, getSmsDestination } = require('../utils/mobileNormalizer');
const { findUserByMobile, ensureActiveUser } = require('../utils/userHelpers');

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
    if (user && user.role !== 'admin') {
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

    if (!user || user.role !== 'admin') {
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

    if (!user || user.role !== 'admin') {
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

module.exports = {
  adminSignupInit,
  adminLoginOtpInit,
  adminLoginOtpVerify,
};
