const mongoose = require('mongoose');
const User = require('../models/User');
const ReferralEarning = require('../models/ReferralEarning');
const { ensureReferralCode } = require('../utils/referralService');
const bcrypt = require('bcryptjs');
const KycApplication = require('../models/KycApplication');
const BankChangeRequest = require('../models/BankChangeRequest');
const MobileChangeRequest = require('../models/MobileChangeRequest');
const IcoHolding = require('../models/IcoHolding');
const StakingPosition = require('../models/StakingPosition');
const { sendOtpForUser, verifyUserOtp } = require('../utils/otpHelpers');
const { buildReferralTree } = require('../utils/referralTree');
const { uploadImageBuffer, isCloudinaryConfigured } = require('../utils/cloudinary');

const REQUIRED_FIELDS = ['line1', 'city', 'state', 'postalCode'];
const ADDRESS_FIELDS = [
  'label',
  'fullName',
  'phone',
  'line1',
  'line2',
  'city',
  'state',
  'postalCode',
  'country',
  'landmark',
];

const BANK_FIELDS = ['accountHolderName', 'accountNumber', 'ifsc', 'bankName'];
const OTP_PURPOSES = ['withdrawal', 'bank_add', 'upi_add', 'change_email', 'ico_sell'];

const sanitizeAddressInput = (payload = {}) => {
  const address = {};
  ADDRESS_FIELDS.forEach((field) => {
    if (payload[field] !== undefined) {
      address[field] = typeof payload[field] === 'string'
        ? payload[field].trim()
        : payload[field];
    }
  });
  return address;
};

const sanitizeBankInput = (payload = {}) => {
  const bank = {};
  BANK_FIELDS.forEach((field) => {
    if (payload[field] !== undefined) {
      bank[field] = typeof payload[field] === 'string'
        ? payload[field].trim()
        : payload[field];
    }
  });
  return bank;
};

const validateBankInput = (bank) => {
  const missing = ['accountHolderName', 'accountNumber', 'ifsc'].filter((field) => {
    const value = bank[field];
    return value === undefined || value === null || value === '';
  });
  if (missing.length) {
    const error = new Error(`Missing required bank fields: ${missing.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
};

const sanitizeUpiInput = (payload = {}) => {
  const upiId = payload.upiId;
  return upiId ? String(upiId).trim().toLowerCase() : '';
};

const pruneReferralTree = (node, maxDepth) => {
  if (!node || !node.children) return;
  node.children = node.children.filter((child) => child.depth <= maxDepth);
  node.children.forEach((child) => pruneReferralTree(child, maxDepth));
};

const COUNTRY_LIST = [
  { code: 'IN', name: 'India', status: 'active' },
  { code: 'US', name: 'USA', status: 'coming_soon' },
  { code: 'VN', name: 'Vietnam', status: 'coming_soon' },
  { code: 'AE', name: 'UAE', status: 'coming_soon' },
];

const PROFILE_FOLDER =
  (process.env.CLOUDINARY_PROFILE_FOLDER || 'profiles').replace(/^\/+|\/+$/g, '') || 'profiles';

const validateRequiredFields = (address) => {
  const missing = REQUIRED_FIELDS.filter((field) => {
    const value = address[field];
    return value === undefined || value === null || value === '';
  });
  if (missing.length) {
    const fieldList = missing.join(', ');
    const error = new Error(`Missing required address fields: ${fieldList}`);
    error.statusCode = 400;
    throw error;
  }
};

const ensureUserExists = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }
  return user;
};

const ensureAddressIdentifiers = (user) => {
  let mutated = false;
  user.addresses.forEach((address) => {
    if (!address._id) {
      address._id = new mongoose.Types.ObjectId();
      mutated = true;
    }
  });
  if (mutated) {
    user.markModified('addresses');
  }
  return mutated;
};

const ensureDefaultAddress = (addresses = []) => {
  if (!addresses.length) {
    return;
  }
  const hasDefault = addresses.some((address) => address.isDefault);
  if (!hasDefault) {
    addresses[0].isDefault = true;
  }
};

const setDefaultById = (addresses, addressId) => {
  const targetId = addressId?.toString();
  let updated = false;
  addresses.forEach((address) => {
    if (address._id?.toString() === targetId) {
      address.isDefault = true;
      updated = true;
    } else {
      address.isDefault = false;
    }
  });
  return updated;
};

const getAddresses = async (req, res) => {
  try {
    const user = await ensureUserExists(req.user._id);
    const mutated = ensureAddressIdentifiers(user);
    if (mutated) {
      await user.save();
    }
    res.json(user.addresses || []);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

const addAddress = async (req, res) => {
  try {
    const user = await ensureUserExists(req.user._id);
    ensureAddressIdentifiers(user);
    const addressInput = sanitizeAddressInput(req.body);
    validateRequiredFields(addressInput);

    const address = addressInput;
    address.isDefault = Boolean(req.body.isDefault || user.addresses.length === 0);

    if (address.isDefault) {
      user.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
    }

    user.addresses.push(address);
    ensureDefaultAddress(user.addresses);
    await user.save();

    res.status(201).json(user.addresses);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

const updateAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const user = await ensureUserExists(req.user._id);
    ensureAddressIdentifiers(user);
    const address = user.addresses.id(addressId);

    if (!address) {
      return res.status(404).json({ message: 'Address not found' });
    }

    const updates = sanitizeAddressInput(req.body);
    Object.assign(address, updates);

    if (req.body.isDefault !== undefined) {
      if (req.body.isDefault) {
        setDefaultById(user.addresses, address._id);
      } else {
        address.isDefault = false;
        ensureDefaultAddress(user.addresses);
      }
    }

    validateRequiredFields({
      line1: address.line1,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
    });

    await user.save();
    res.json(user.addresses);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

const deleteAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const user = await ensureUserExists(req.user._id);
    ensureAddressIdentifiers(user);
    const address = user.addresses.id(addressId);

    if (!address) {
      return res.status(404).json({ message: 'Address not found' });
    }

    address.deleteOne();
    ensureDefaultAddress(user.addresses);
    await user.save();

    res.json(user.addresses);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

const setDefaultAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const user = await ensureUserExists(req.user._id);
    ensureAddressIdentifiers(user);

    const updated = setDefaultById(user.addresses, addressId);
    if (!updated) {
      return res.status(404).json({ message: 'Address not found' });
    }

    await user.save();
    res.json(user.addresses);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await ensureUserExists(req.user._id);
    const [kyc, holding, stakingAgg] = await Promise.all([
      KycApplication.findOne({ user: req.user._id }).select('status selfieUrl'),
      IcoHolding.findOne({ user: req.user._id }),
      StakingPosition.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(req.user._id) } },
        { $group: { _id: null, stakedBalance: { $sum: '$tokenAmount' } } },
      ]),
    ]);

    const kycStatus = kyc ? kyc.status : 'not_submitted';
    const accountLevel = kycStatus === 'verified' ? 2 : 1;
    const accountStatus = kycStatus === 'verified' ? 'active' : 'inactive';

    res.json({
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      country: user.country,
      profileImageUrl: user.profileImageUrl,
      profileLocks: {
        name: Boolean(user.nameUpdatedAt),
        profileImage: Boolean(user.profileImageUrl),
        bankDetails: Boolean(user.bankDetails && user.bankDetails.accountNumber),
      },
      selfieUrl: kyc?.selfieUrl,
      verification: {
        email: user.isEmailVerified,
        mobile: user.isMobileVerified,
        kycStatus,
      },
      accountLevel: {
        level: accountLevel,
        status: accountStatus,
      },
      wallets: {
        token: holding?.balance || 0,
        referral: user.referralWalletBalance || 0,
        rewards: user.rewardsWalletBalance || 0,
        staking: stakingAgg?.[0]?.stakedBalance || 0,
      },
      bankDetails: user.bankDetails || null,
      upiDetails: user.upiDetails || null,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

const updateProfileName = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ message: 'name is required' });
    }

    const user = await ensureUserExists(req.user._id);
    if (user.nameUpdatedAt) {
      return res.status(400).json({ message: 'Name already set. Contact support to change it.' });
    }

    user.name = name;
    user.nameUpdatedAt = new Date();
    await user.save();

    return res.json({ name: user.name, nameUpdatedAt: user.nameUpdatedAt });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ message: error.message });
  }
};

const uploadProfileImage = async (req, res) => {
  try {
    const user = await ensureUserExists(req.user._id);
    if (user.profileImageUrl) {
      return res.status(400).json({ message: 'Profile image already set. Contact support to change it.' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    if (!isCloudinaryConfigured()) {
      return res.status(500).json({ message: 'Cloudinary is not configured on the server' });
    }

    const folder = `${PROFILE_FOLDER}/${req.user._id}`;
    const uploadResult = await uploadImageBuffer(req.file.buffer, {
      folder,
      publicId: `profile-${Date.now()}`,
    });

    user.profileImageUrl = uploadResult.secure_url;
    user.profileImagePublicId = uploadResult.public_id;
    user.profileImageSetAt = new Date();
    await user.save();

    return res.status(201).json({
      profileImageUrl: user.profileImageUrl,
      profileImageSetAt: user.profileImageSetAt,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ message: error.message });
  }
};

const getOnboardingStatus = async (req, res) => {
  try {
    const user = await ensureUserExists(req.user._id);
    const kyc = await KycApplication.findOne({ user: req.user._id }).select('status');
    const kycStatus = kyc ? kyc.status : 'not_submitted';

    res.json({
      hasPin: Boolean(user.pin),
      emailVerified: user.isEmailVerified,
      mobileVerified: user.isMobileVerified,
      kycStatus,
      canAccessDashboard: user.isEmailVerified && kycStatus === 'verified',
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

const requestActionOtp = async (req, res) => {
  try {
    const { purpose, channel, newEmail } = req.body || {};
    const normalizedPurpose = String(purpose || '').trim();
    if (!OTP_PURPOSES.includes(normalizedPurpose)) {
      return res.status(400).json({ message: 'Invalid OTP purpose' });
    }

    const normalizedChannel = channel === 'mobile' ? 'mobile' : 'email';
    const user = await ensureUserExists(req.user._id);

    let destination = normalizedChannel === 'mobile' ? user.mobile : user.email;

    if (normalizedPurpose === 'change_email') {
      if (normalizedChannel !== 'email') {
        return res.status(400).json({ message: 'Email change OTP must use email channel' });
      }
      const nextEmail = String(newEmail || '').trim().toLowerCase();
      if (!nextEmail) {
        return res.status(400).json({ message: 'newEmail is required' });
      }
      const existing = await User.findOne({ email: nextEmail, _id: { $ne: user._id } });
      if (existing) {
        return res.status(400).json({ message: 'Email already in use' });
      }
      user.pendingEmail = nextEmail;
      user.pendingEmailRequestedAt = new Date();
      destination = nextEmail;
    }

    if (!destination) {
      return res.status(400).json({ message: 'No destination available for OTP' });
    }

    const otpPayload = await sendOtpForUser({
      user,
      channel: normalizedChannel,
      purpose: normalizedPurpose,
      destination,
    });

    res.json({
      message: 'OTP sent',
      purpose: normalizedPurpose,
      expiresAt: otpPayload.expiresAt,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

const verifyActionOtp = async (req, res) => {
  try {
    const { purpose, otp } = req.body || {};
    const normalizedPurpose = String(purpose || '').trim();

    if (!OTP_PURPOSES.includes(normalizedPurpose)) {
      return res.status(400).json({ message: 'Invalid OTP purpose' });
    }

    if (!otp) {
      return res.status(400).json({ message: 'OTP is required' });
    }

    const user = await ensureUserExists(req.user._id);
    const otpCheck = verifyUserOtp({ user, otp, purpose: normalizedPurpose });

    if (!otpCheck.ok) {
      return res.status(400).json({ message: otpCheck.message });
    }

    res.json({
      message: 'OTP verified',
      purpose: normalizedPurpose,
      expiresAt: user.otp?.expiresAt,
      channel: user.otp?.channel,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

const confirmEmailChange = async (req, res) => {
  try {
    const { otp } = req.body || {};
    if (!otp) {
      return res.status(400).json({ message: 'OTP is required' });
    }
    const user = await ensureUserExists(req.user._id);
    if (!user.pendingEmail) {
      return res.status(400).json({ message: 'No email change pending' });
    }

    const otpCheck = verifyUserOtp({ user, otp, purpose: 'change_email' });
    if (!otpCheck.ok) {
      return res.status(400).json({ message: otpCheck.message });
    }

    user.email = user.pendingEmail;
    user.pendingEmail = undefined;
    user.pendingEmailRequestedAt = undefined;
    user.isEmailVerified = true;
    user.otp = undefined;
    await user.save();

    res.json({ email: user.email, isEmailVerified: user.isEmailVerified });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

const changePin = async (req, res) => {
  try {
    const { newPin, confirmPin, otp } = req.body || {};
    const user = await ensureUserExists(req.user._id);

    if (!otp) {
      const destination = user.mobile;
      if (!destination) {
        return res.status(400).json({ message: 'Mobile number not available for OTP' });
      }

      const otpPayload = await sendOtpForUser({
        user,
        channel: 'mobile',
        purpose: 'pin_change',
        destination,
      });

      return res.status(202).json({
        message: 'OTP sent',
        purpose: 'pin_change',
        expiresAt: otpPayload.expiresAt,
      });
    }

    if (!newPin) {
      return res.status(400).json({ message: 'newPin is required' });
    }
    if (!confirmPin) {
      return res.status(400).json({ message: 'confirmPin is required' });
    }
    const newPinString = String(newPin);
    if (newPinString !== String(confirmPin)) {
      return res.status(400).json({ message: 'PIN confirmation does not match' });
    }

    const otpCheck = verifyUserOtp({ user, otp, purpose: 'pin_change' });
    if (!otpCheck.ok) {
      return res.status(400).json({ message: otpCheck.message });
    }

    const salt = await bcrypt.genSalt(10);
    user.pin = await bcrypt.hash(newPinString, salt);
    user.otp = undefined;
    await user.save();

    res.json({ message: 'PIN updated' });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

const requestMobileChange = async (req, res) => {
  try {
    const newMobile = String(req.body?.newMobile || '').trim();
    if (!newMobile) {
      return res.status(400).json({ message: 'newMobile is required' });
    }
    const user = await ensureUserExists(req.user._id);
    if (user.mobile === newMobile) {
      return res.status(400).json({ message: 'New mobile matches current mobile' });
    }

    const existingUser = await User.findOne({ mobile: newMobile });
    if (existingUser) {
      return res.status(400).json({ message: 'Mobile number already in use' });
    }

    const existingRequest = await MobileChangeRequest.findOne({
      user: req.user._id,
      status: 'pending',
    });

    if (existingRequest) {
      return res.status(400).json({ message: 'Mobile change request already pending' });
    }

    const request = await MobileChangeRequest.create({
      user: req.user._id,
      newMobile,
    });

    res.status(201).json(request);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }

};

const addBankDetails = async (req, res) => {

  try {

    const user = await ensureUserExists(req.user._id);
    const otp = req.body?.otp;
    const bankInput = sanitizeBankInput(req.body);
    validateBankInput(bankInput);

    if (!otp) {
      return res.status(400).json({ message: 'OTP is required to add or update bank details' });
    }

    const otpCheck = verifyUserOtp({ user, otp, purpose: 'bank_add' });
    if (!otpCheck.ok) {
      return res.status(400).json({ message: otpCheck.message });
    }

    const isUpdate = Boolean(user.bankDetails && user.bankDetails.accountNumber);
    user.bankDetails = {
      ...bankInput,
      verified: true,
      addedAt: new Date(),
      addedBy: 'user',
    };
    user.otp = undefined;
    await user.save();

    return res.status(201).json({
      message: `Bank details ${isUpdate ? 'updated' : 'added'}`,
      status: isUpdate ? 'updated' : 'added',
      bankDetails: user.bankDetails,
    });

  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

const addUpiDetails = async (req, res) => {
  try {
    const user = await ensureUserExists(req.user._id);
    const otp = req.body?.otp;
    const upiId = sanitizeUpiInput(req.body);

    if (!upiId) {
      return res.status(400).json({ message: 'upiId is required' });
    }

    if (user.upiDetails && user.upiDetails.upiId) {
      const existing = await BankChangeRequest.findOne({
        user: req.user._id,
        type: 'upi',
        status: 'pending',
      });
      if (existing) {
        return res.status(400).json({ message: 'UPI change request already pending' });
      }
      const request = await BankChangeRequest.create({
        user: req.user._id,
        type: 'upi',
        payload: { upiId },
      });
      return res.status(201).json({ request, status: 'pending' });
    }

    const otpCheck = verifyUserOtp({ user, otp, purpose: 'upi_add' });
    if (!otpCheck.ok) {
      return res.status(400).json({ message: otpCheck.message });
    }

    user.upiDetails = {
      upiId,
      verified: true,
      addedAt: new Date(),
      addedBy: 'user',
    };
    user.otp = undefined;
    await user.save();

    return res.status(201).json(user.upiDetails);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

const listBankChangeRequests = async (req, res) => {
  try {
    const requests = await BankChangeRequest.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const listMobileChangeRequests = async (req, res) => {
  try {
    const requests = await MobileChangeRequest.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getReferralTree = async (req, res) => {
  try {
    const maxDepth = Math.min(Number(req.query.maxDepth) || 8, 8);
    const users = await User.find({
      $or: [{ _id: req.user._id }, { referralPath: req.user._id }],
    })
      .select('name email mobile referralCode referredBy referralPath referralLevel createdAt')
      .lean();

    const tree = buildReferralTree(users, req.user._id);
    pruneReferralTree(tree, maxDepth);
    res.json(tree || {});
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const listCountries = async (_req, res) => {
  res.json({
    data: COUNTRY_LIST,
    active: COUNTRY_LIST.filter((country) => country.status === 'active'),
  });
};

const updateCountry = async (req, res) => {
  try {
    const code = String(req.body?.country || '').trim().toUpperCase();
    if (!code) {
      return res.status(400).json({ message: 'country is required' });
    }

    const selected = COUNTRY_LIST.find((country) => country.code === code);
    if (!selected) {
      return res.status(400).json({ message: 'Unsupported country' });
    }
    if (selected.status !== 'active') {
      return res.status(403).json({ message: 'Country is coming soon' });
    }

    const user = await ensureUserExists(req.user._id);
    user.country = code;
    await user.save();

    res.json({ country: user.country });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

const getReferralSummary = async (req, res) => {
  try {
    const user = await ensureUserExists(req.user._id);
    res.json({
      referralCode: user.referralCode,
      referredBy: user.referredBy,
      referralLevel: user.referralLevel || 0,
      referralDownlineCounts: user.referralDownlineCounts || [],
      referralWalletBalance: user.referralWalletBalance || 0,
      referralTotalEarned: user.referralTotalEarned || 0,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

const listReferralEarnings = async (req, res) => {
  try {
    const earnings = await ReferralEarning.find({ earner: req.user._id })
      .sort({ createdAt: -1 })
      .limit(200);
    res.json(earnings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getReferralCode = async (req, res) => {
  try {
    const user = await ensureUserExists(req.user._id);
    const created = await ensureReferralCode(user);
    if (created) {
      await user.save();
    }
    res.json({ referralCode: user.referralCode });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

// List downline users at a given depth (0 = direct referrals, 1 = second level, etc.)
const listReferralDownline = async (req, res) => {
  try {
    const depth = Number(req.query.depth ?? 0);
    if (Number.isNaN(depth) || depth < 0 || depth > 8) {
      return res.status(400).json({ message: 'depth must be between 0 and 8' });
    }

    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const pathField = `referralPath.${depth}`;
    const filter = { [pathField]: req.user._id };

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('name email mobile referralCode referralLevel referralWalletBalance referralTotalEarned referredBy createdAt'),
      User.countDocuments(filter),
    ]);

    res.json({
      depth,
      users,
      pagination: {
        total,
        page,
        limit,
        hasMore: skip + users.length < total,
      },
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};

module.exports = {
  getAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  getProfile,
  updateProfileName,
  uploadProfileImage,
  getOnboardingStatus,
  requestActionOtp,
  verifyActionOtp,
  confirmEmailChange,
  changePin,
  requestMobileChange,
  addBankDetails,
  addUpiDetails,
  listBankChangeRequests,
  listMobileChangeRequests,
  getReferralTree,
  listCountries,
  updateCountry,
  getReferralSummary,
  listReferralEarnings,
  getReferralCode,
  listReferralDownline,
};
