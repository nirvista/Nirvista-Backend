const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { generateOTP, sendOTP } = require('../utils/otpService');
const { ensureReferralCode, applyReferralCodeOnSignup } = require('../utils/referralService');
const bcrypt = require('bcryptjs');
const { getOrCreateWalletAccount } = require('../utils/walletAccount');
const {
  normalizeChannel,
  normalizeMobileNumber,
  getSmsDestination,
  buildMobileAliasEmail,
} = require('../utils/mobileNormalizer');
const { ensureActiveUser, findUserByMobile } = require('../utils/userHelpers');

const OTP_TTL_MINUTES = 10;
// Hardcoded admin login for testing.
const ADMIN_LOGIN_EMAIL = 'info@nirvista.in';
const ADMIN_LOGIN_PASSWORD = '12345678';

const isHardcodedAdminLogin = (email, password) =>
  email === ADMIN_LOGIN_EMAIL && password === ADMIN_LOGIN_PASSWORD;

const buildOTP = (channel, purpose) => ({
  code: generateOTP(),
  expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
  channel,
  purpose,
});

// Normalize identifier to detect email vs mobile
const parseIdentifier = (identifier = '', countryCode = '', fallbackMobile = '') => {
  const trimmed = String(identifier || fallbackMobile || '').trim();
  if (!trimmed) {
    return {
      type: '',
      value: '',
      variants: [],
      raw: '',
      digits: '',
      isValid: false,
      minDigits: 10,
    };
  }
  if (trimmed.includes('@')) {
    const email = trimmed.toLowerCase();
    return {
      type: 'email',
      value: email,
      variants: [email],
      raw: email,
      digits: '',
      isValid: true,
      minDigits: 0,
    };
  }

  const {
    normalized,
    variants,
    raw,
    digits,
    isValid,
    minDigits,
  } = normalizeMobileNumber(trimmed, countryCode);

  return {
    type: 'mobile',
    value: normalized,
    variants,
    raw,
    digits,
    isValid,
    minDigits,
  };
};

// @desc    Combined signup (email + mobile) with OTP to both
// @route   POST /api/auth/signup/combined-init
// @access  Public
const signupCombinedInit = async (req, res) => {
  const {
    name,
    email,
    mobile,
    countryCode,
    password,
    referralCode,
  } = req.body;

  if (!name || !email || !mobile) {
    return res.status(400).json({ message: 'Name, email, and mobile are required' });
  }

  const normalizedEmail = email.toLowerCase();
  const {
    normalized: normalizedMobile,
    variants: mobileVariants,
    raw: rawMobile,
    isValid: isMobileValid,
  } = normalizeMobileNumber(mobile, countryCode);
  const smsDestination = getSmsDestination({ variants: mobileVariants, normalized: normalizedMobile, raw: rawMobile });

  if (!isMobileValid) {
    return res.status(400).json({ message: 'Valid mobile number is required' });
  }

  try {
    const existingUser = await User.findOne({
      $or: [{ email: normalizedEmail }, { mobile: { $in: mobileVariants } }],
    });

    const salt = password ? await bcrypt.genSalt(10) : null;
    const hashedPassword = password && salt ? await bcrypt.hash(password, salt) : undefined;
    const otpPayload = buildOTP('email', 'signup'); // stored as email, but OTP is sent to both channels

    if (existingUser) {
      if (existingUser.isEmailVerified && existingUser.isMobileVerified) {
        return res.status(400).json({ message: 'User already exists with this email or mobile' });
      }

      existingUser.name = name || existingUser.name;
      existingUser.email = normalizedEmail;
      existingUser.mobile = normalizedMobile;
      if (hashedPassword) existingUser.password = hashedPassword;
      existingUser.otp = otpPayload;

      const ensuredCode = await ensureReferralCode(existingUser);
      if (ensuredCode) {
        await existingUser.save();
      }
      if (referralCode) {
        try {
          await applyReferralCodeOnSignup(existingUser, referralCode);
        } catch (err) {
          return res.status(err.statusCode || 400).json({ message: err.message });
        }
      }

      await existingUser.save();
      await sendOTP(existingUser.email, otpPayload.code, 'email');
      await sendOTP(smsDestination, otpPayload.code, 'sms');

      return res.status(200).json({
        message: 'Signup re-initiated. OTP sent to email and mobile.',
        userId: existingUser._id,
      });
    }

    const user = await User.create({
      name,
      email: normalizedEmail,
      mobile: normalizedMobile,
      password: hashedPassword,
      otp: otpPayload,
    });

    const ensuredCode = await ensureReferralCode(user);
    if (ensuredCode) {
      await user.save();
    }
    if (referralCode) {
      try {
        await applyReferralCodeOnSignup(user, referralCode);
      } catch (err) {
        return res.status(err.statusCode || 400).json({ message: err.message });
      }
    }

    await sendOTP(user.email, otpPayload.code, 'email');
    await sendOTP(smsDestination, otpPayload.code, 'sms');

    res.status(201).json({
      message: 'Signup initiated. OTP sent to email and mobile.',
      userId: user._id,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Register user with Email (Step 1)
// @route   POST /api/auth/signup/email-init
// @access  Public
const signupEmailInit = async (req, res) => {
  const { name, email, password, referralCode } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email, and password are required' });
  }

  const normalizedEmail = email.toLowerCase();

  try {
    const existingUser = await User.findOne({ email: normalizedEmail });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const otpPayload = buildOTP('email', 'signup');

    if (existingUser) {
      if (existingUser.isEmailVerified) {
        return res.status(400).json({ message: 'User already exists with this email' });
      }

      existingUser.name = name || existingUser.name;
      existingUser.email = normalizedEmail;
      existingUser.password = hashedPassword;
      existingUser.otp = otpPayload;

      const ensuredCode = await ensureReferralCode(existingUser);
      if (ensuredCode) {
        await existingUser.save();
      }
      if (referralCode) {
        try {
          await applyReferralCodeOnSignup(existingUser, referralCode);
        } catch (err) {
          return res.status(err.statusCode || 400).json({ message: err.message });
        }
      }

      await existingUser.save();
      await sendOTP(existingUser.email, otpPayload.code, 'email');

      return res.status(200).json({
        message: 'Signup re-initiated. OTP sent to email.',
        userId: existingUser._id,
      });
    }

    const user = await User.create({
      name,
      email: normalizedEmail,
      password: hashedPassword,
      otp: otpPayload,
    });

    const ensuredCode = await ensureReferralCode(user);
    if (ensuredCode) {
      await user.save();
    }
    if (referralCode) {
      try {
        await applyReferralCodeOnSignup(user, referralCode);
      } catch (err) {
        return res.status(err.statusCode || 400).json({ message: err.message });
      }
    }

    await sendOTP(user.email, otpPayload.code, 'email');

    res.status(201).json({
      message: 'Signup initiated. OTP sent to email.',
      userId: user._id,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Register user with Mobile (Step 1)
// @route   POST /api/auth/signup/mobile-init
// @access  Public
const signupMobileInit = async (req, res) => {
  const { name, mobile, countryCode, referralCode } = req.body;

  if (!name || !mobile || !referralCode) {
    return res.status(400).json({ message: 'Name, mobile, and referral code are required' });
  }

  const {
    normalized: normalizedMobile,
    variants: mobileVariants,
    raw: rawMobile,
    isValid: isMobileValid,
  } = normalizeMobileNumber(mobile, countryCode);
  const smsDestination = getSmsDestination({ variants: mobileVariants, normalized: normalizedMobile, raw: rawMobile });

  if (!isMobileValid) {
    return res.status(400).json({ message: 'Valid mobile number is required' });
  }

  try {
    const existingUser = await findUserByMobile(mobile, countryCode);
    const otpPayload = buildOTP('mobile', 'signup');
    const aliasEmail = buildMobileAliasEmail(normalizedMobile);

    if (existingUser) {
      if (existingUser.isMobileVerified) {
        return res.status(400).json({ message: 'User already exists with this mobile number' });
      }

      existingUser.name = name || existingUser.name;
      existingUser.mobile = normalizedMobile;
      // Ensure a non-null, unique email placeholder for uniqueness indexes
      if (!existingUser.email && aliasEmail) {
        existingUser.email = aliasEmail;
      }
      existingUser.otp = otpPayload;

      const ensuredCode = await ensureReferralCode(existingUser);
      if (ensuredCode) {
        await existingUser.save();
      }
      try {
        await applyReferralCodeOnSignup(existingUser, referralCode);
      } catch (err) {
        return res.status(err.statusCode || 400).json({ message: err.message });
      }

      await existingUser.save();
      await sendOTP(smsDestination, otpPayload.code, 'sms');

      return res.status(200).json({
        message: 'Signup re-initiated. OTP sent to mobile.',
        userId: existingUser._id,
      });
    }

    const user = await User.create({
      name,
      mobile: normalizedMobile,
      email: aliasEmail,
      otp: otpPayload,
    });

    const ensuredCode = await ensureReferralCode(user);
    if (ensuredCode) {
      await user.save();
    }
    try {
      await applyReferralCodeOnSignup(user, referralCode);
    } catch (err) {
      return res.status(err.statusCode || 400).json({ message: err.message });
    }

    await sendOTP(smsDestination, otpPayload.code, 'sms');

    res.status(201).json({
      message: 'Signup initiated. OTP sent to mobile.',
      userId: user._id,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Verify OTP and Finalize Signup
// @route   POST /api/auth/signup/verify
// @access  Public
const verifyOTP = async (req, res) => {
  const { userId, otp, type, pin } = req.body;

  if (!userId || !otp) {
    return res.status(400).json({ message: 'User ID and OTP are required' });
  }

  try {
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.otp || !user.otp.code) {
      return res.status(400).json({ message: 'No pending OTP found. Please request a new one.' });
    }

    const storedChannel = normalizeChannel(user.otp.channel);
    const requestedChannel = normalizeChannel(type);
    const verificationChannel = requestedChannel || storedChannel;

    if (user.otp.code !== otp || (user.otp.expiresAt && user.otp.expiresAt < new Date())) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    user.otp = undefined;
    const verifyBoth = Boolean(user.email && user.mobile);
    if (verifyBoth || verificationChannel === 'email') user.isEmailVerified = true;
    if (verifyBoth || verificationChannel === 'mobile') user.isMobileVerified = true;

    let pinSet = false;
    if (pin !== undefined && pin !== null) {
      const pinString = String(pin);
      if (pinString.length < 4) {
        return res.status(400).json({ message: 'PIN must be at least 4 characters long' });
      }
      const salt = await bcrypt.genSalt(10);
      user.pin = await bcrypt.hash(pinString, salt);
      pinSet = true;
    }

    if (!user.email && user.mobile) {
      const aliasEmail = buildMobileAliasEmail(user.mobile);
      if (aliasEmail) {
        user.email = aliasEmail;
      }
    }

    await ensureReferralCode(user);
    await user.save();
    await getOrCreateWalletAccount(user._id);

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      isEmailVerified: user.isEmailVerified,
      isMobileVerified: user.isMobileVerified,
      hasPin: Boolean(user.pin),
      pinUpdated: pinSet,
      token: generateToken(user._id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Setup PIN
// @route   POST /api/auth/pin/setup
// @access  Private
const setupPIN = async (req, res) => {
  const { pin } = req.body;

  if (pin === undefined || pin === null) {
    return res.status(400).json({ message: 'PIN is required' });
  }

  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.isEmailVerified && !user.isMobileVerified) {
      return res.status(400).json({ message: 'Verify email or mobile before setting a PIN' });
    }

    const pinString = String(pin);

    if (pinString.length < 4) {
      return res.status(400).json({ message: 'PIN must be at least 4 characters long' });
    }

    const salt = await bcrypt.genSalt(10);
    user.pin = await bcrypt.hash(pinString, salt);

    await user.save();

    res.json({ message: 'PIN setup successful' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Login with Email & Password
// @route   POST /api/auth/login/email
// @access  Public
const loginEmail = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const normalizedEmail = email.toLowerCase();

  try {
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
        token: generateToken(user._id),
      });
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user || !user.password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    if (!ensureActiveUser(user, res)) return;

    if (!user.isEmailVerified) {
      return res.status(403).json({ message: 'Email not verified' });
    }

    if (await user.matchPassword(password)) {
      await getOrCreateWalletAccount(user._id);
      return res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        token: generateToken(user._id),
      });
    }

    res.status(401).json({ message: 'Invalid email or password' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Login with Mobile (Request OTP)
// @route   POST /api/auth/login/mobile-init
// @access  Public
const loginMobileInit = async (req, res) => {
  const { mobile, countryCode } = req.body;

  if (!mobile) {
    return res.status(400).json({ message: 'Mobile number is required' });
  }

  const {
    normalized: normalizedMobile,
    variants: mobileVariants,
    raw: rawMobile,
    isValid: isMobileValid,
  } = normalizeMobileNumber(mobile, countryCode);
  const smsDestination = getSmsDestination({ variants: mobileVariants, normalized: normalizedMobile, raw: rawMobile });

  if (!isMobileValid) {
    return res.status(400).json({ message: 'Valid mobile number is required' });
  }

  try {
    const user = await findUserByMobile(mobile, countryCode);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (!ensureActiveUser(user, res)) return;

    if (!user.isMobileVerified) {
      return res.status(403).json({ message: 'Mobile number is not verified' });
    }

    const otpPayload = buildOTP('mobile', 'login');
    user.otp = otpPayload;

    await user.save();
    await sendOTP(smsDestination, otpPayload.code, 'sms');

    res.json({ message: 'OTP sent to mobile', userId: user._id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Login with Mobile (Verify OTP)
// @route   POST /api/auth/login/mobile-verify
// @access  Public
const loginMobileVerify = async (req, res) => {
  const { mobile, countryCode, otp } = req.body;

  if (!mobile || !otp) {
    return res.status(400).json({ message: 'Mobile number and OTP are required' });
  }

  const {
    normalized: normalizedMobile,
    isValid: isMobileValid,
  } = normalizeMobileNumber(mobile, countryCode);

  if (!isMobileValid) {
    return res.status(400).json({ message: 'Valid mobile number is required' });
  }

  try {
    const user = await findUserByMobile(mobile, countryCode);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (!ensureActiveUser(user, res)) return;

    if (!user.isMobileVerified) {
      return res.status(403).json({ message: 'Mobile number is not verified' });
    }

    if (!user.otp || !user.otp.code) {
      return res.status(400).json({ message: 'No OTP pending verification' });
    }

    const channel = normalizeChannel(user.otp.channel || 'mobile');

    if (channel !== 'mobile') {
      return res.status(400).json({ message: 'OTP verification type mismatch' });
    }

    if (user.otp.code !== otp || (user.otp.expiresAt && user.otp.expiresAt < new Date())) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    user.otp = undefined;
    await user.save();

    await getOrCreateWalletAccount(user._id);

    res.json({
      _id: user._id,
      name: user.name,
      mobile: user.mobile,
      hasPin: Boolean(user.pin),
      token: generateToken(user._id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Login with Mobile (one endpoint: send OTP, verify OTP, or login by PIN)
// @route   POST /api/auth/login/mobile
// @access  Public
const loginMobile = async (req, res) => {
  const { mobile, countryCode, otp, pin } = req.body;

  if (!mobile) {
    return res.status(400).json({ message: 'Mobile number is required' });
  }

  const {
    normalized: normalizedMobile,
    variants: mobileVariants,
    raw: rawMobile,
    isValid: isMobileValid,
  } = normalizeMobileNumber(mobile, countryCode);
  const smsDestination = getSmsDestination({ variants: mobileVariants, normalized: normalizedMobile, raw: rawMobile });

  if (!isMobileValid) {
    return res.status(400).json({ message: 'Valid mobile number is required' });
  }

  try {
    const user = await findUserByMobile(mobile, countryCode);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (!ensureActiveUser(user, res)) return;

    if (!user.isMobileVerified) {
      return res.status(403).json({ message: 'Mobile number is not verified' });
    }

    if (pin !== undefined && pin !== null) {
      if (!user.pin) {
        return res.status(400).json({ message: 'PIN not set for this user' });
      }
      const pinString = String(pin);
      if (await user.matchPin(pinString)) {
        await getOrCreateWalletAccount(user._id);
        return res.json({
          _id: user._id,
          name: user.name,
          mobile: user.mobile,
          hasPin: true,
          token: generateToken(user._id),
        });
      }
      return res.status(401).json({ message: 'Invalid PIN' });
    }

    if (otp) {
      if (!user.otp || !user.otp.code) {
        return res.status(400).json({ message: 'No OTP pending verification' });
      }

      const channel = normalizeChannel(user.otp.channel || 'mobile');
      if (channel !== 'mobile') {
        return res.status(400).json({ message: 'OTP verification type mismatch' });
      }

      if (user.otp.code !== otp || (user.otp.expiresAt && user.otp.expiresAt < new Date())) {
        return res.status(400).json({ message: 'Invalid or expired OTP' });
      }

      user.otp = undefined;
      await user.save();
      await getOrCreateWalletAccount(user._id);

      return res.json({
        _id: user._id,
        name: user.name,
        mobile: user.mobile,
        hasPin: Boolean(user.pin),
        token: generateToken(user._id),
      });
    }

    const otpPayload = buildOTP('mobile', 'login');
    user.otp = otpPayload;
    await user.save();
    await sendOTP(smsDestination, otpPayload.code, 'sms');

    return res.json({
      message: 'OTP sent to mobile',
      userId: user._id,
      otpExpiresAt: otpPayload.expiresAt,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Login with Email or Mobile (Request OTP)
// @route   POST /api/auth/login/otp-init
// @access  Public
const loginOtpInit = async (req, res) => {
  const { identifier, mobile, countryCode } = req.body;
  const input = identifier || mobile;

  if (!input) {
    return res.status(400).json({ message: 'Email or mobile is required' });
  }

  const { type, value, variants, raw, isValid } = parseIdentifier(input, countryCode);

  if (!type || !value) {
    return res.status(400).json({ message: 'Valid email or mobile is required' });
  }
  if (type === 'mobile' && !isValid) {
    return res.status(400).json({ message: 'Valid mobile number is required' });
  }

  try {
    const user = await User.findOne(
      type === 'email' ? { email: value } : { mobile: { $in: variants } },
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (!ensureActiveUser(user, res)) return;

    if (type === 'email' && !user.isEmailVerified) {
      return res.status(403).json({ message: 'Email not verified' });
    }

    if (type === 'mobile' && !user.isMobileVerified) {
      return res.status(403).json({ message: 'Mobile number is not verified' });
    }

    const otpPayload = buildOTP(type || 'email', 'login');
    user.otp = otpPayload;
    await user.save();

    const smsDestination = type === 'mobile'
      ? getSmsDestination({ variants, normalized: value, raw })
      : value;

    await sendOTP(smsDestination, otpPayload.code, type || 'email');

    res.json({ message: 'OTP sent for login', userId: user._id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Login with Email or Mobile (Verify OTP)
// @route   POST /api/auth/login/otp-verify
// @access  Public
const loginOtpVerify = async (req, res) => {
  const { identifier, mobile, countryCode, otp } = req.body;
  const input = identifier || mobile;

  if (!input || !otp) {
    return res.status(400).json({ message: 'Identifier and OTP are required' });
  }

  const { type, value, variants, isValid } = parseIdentifier(input, countryCode);

  if (!type || !value) {
    return res.status(400).json({ message: 'Valid email or mobile is required' });
  }
  if (type === 'mobile' && !isValid) {
    return res.status(400).json({ message: 'Valid mobile number is required' });
  }

  try {
    const user = await User.findOne(
      type === 'email' ? { email: value } : { mobile: { $in: variants } },
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (!ensureActiveUser(user, res)) return;

    if (!user.otp || !user.otp.code) {
      return res.status(400).json({ message: 'No OTP pending verification' });
    }

    if (user.otp.code !== otp || (user.otp.expiresAt && user.otp.expiresAt < new Date())) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    user.otp = undefined;
    await user.save();

    await getOrCreateWalletAccount(user._id);

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      token: generateToken(user._id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Login with PIN
// @route   POST /api/auth/login/pin
// @access  Public (but requires identifier)
const loginPIN = async (req, res) => {
  const { identifier, mobile, countryCode, pin } = req.body; // identifier can be email or mobile
  const input = identifier || mobile;

  if (!input || !pin) {
    return res.status(400).json({ message: 'Identifier and PIN are required' });
  }

  const { type, value, variants, isValid } = parseIdentifier(input, countryCode);

  if (!type || !value) {
    return res.status(400).json({ message: 'Valid email or mobile is required' });
  }
  if (type === 'mobile' && !isValid) {
    return res.status(400).json({ message: 'Valid mobile number is required' });
  }

  try {
    // Find user by email OR mobile
    const user = await User.findOne(
      type === 'email' ? { email: value } : { mobile: { $in: variants } },
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (!ensureActiveUser(user, res)) return;

    if (!user.pin) {
      return res.status(400).json({ message: 'PIN not set for this user' });
    }

    const identifierMatchedEmail = user.email && user.email === value;
    const identifierMatchedMobile = user.mobile && variants.includes(user.mobile);

    if (identifierMatchedEmail && !user.isEmailVerified) {
      return res.status(403).json({ message: 'Email not verified' });
    }

    if (identifierMatchedMobile && !user.isMobileVerified) {
      return res.status(403).json({ message: 'Mobile number not verified' });
    }

    if (!identifierMatchedEmail && !identifierMatchedMobile) {
      return res.status(400).json({ message: 'Identifier does not match user records' });
    }

    const pinString = String(pin);

    if (await user.matchPin(pinString)) {
      await getOrCreateWalletAccount(user._id);
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        hasPin: true,
        token: generateToken(user._id),
      });
    } else {
      res.status(401).json({ message: 'Invalid PIN' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  signupCombinedInit,
  signupEmailInit,
  signupMobileInit,
  verifyOTP,
  setupPIN,
  loginEmail,
  loginMobile,
  loginMobileInit,
  loginMobileVerify,
  loginOtpInit,
  loginOtpVerify,
  loginPIN,
};
