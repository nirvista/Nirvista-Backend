const mongoose = require('mongoose');
const KycApplication = require('../models/KycApplication');
const User = require('../models/User');
const {
  uploadImageBuffer,
  deleteFromCloudinary,
  isCloudinaryConfigured,
} = require('../utils/cloudinary');
const { createUserNotification } = require('../utils/notificationService');

const REQUIRED_DOC_FIELDS = ['aadhaarFrontUrl', 'aadhaarBackUrl', 'panUrl', 'selfieUrl'];
const DOC_TYPE_MAP = {
  aadhaar_front: { field: 'aadhaarFrontUrl', publicIdField: 'aadhaarFrontPublicId' },
  aadhaar_back: { field: 'aadhaarBackUrl', publicIdField: 'aadhaarBackPublicId' },
  pan: { field: 'panUrl', publicIdField: 'panPublicId' },
  selfie: { field: 'selfieUrl', publicIdField: 'selfiePublicId' },
};

const baseFolder =
  (process.env.CLOUDINARY_KYC_FOLDER || 'kyc').replace(/^\/+|\/+$/g, '') || 'kyc';

const buildStatusPayload = (kyc) => {

  if (!kyc) {
    return { status: 'not_submitted' };
  }
  return {
    status: kyc.status,
    rejectionReason: kyc.rejectionReason,
    submittedAt: kyc.submittedAt,
    verifiedAt: kyc.verifiedAt,
    rejectedAt: kyc.rejectedAt,
    documents: {
      aadhaarFrontUrl: kyc.aadhaarFrontUrl,
      aadhaarBackUrl: kyc.aadhaarBackUrl,
      panUrl: kyc.panUrl,
      selfieUrl: kyc.selfieUrl,
    },
  };

};

const mergeDocuments = (payload, existing) => {
  const docs = {};
  REQUIRED_DOC_FIELDS.forEach((field) => {
    docs[field] = payload[field] || existing?.[field] || null;
  });
  return docs;
};

// Upload a single KYC document to Cloudinary and store the URL on the KYC record
const uploadKycDocument = async (req, res) => {
  try {
    const documentType = (req.body.documentType || req.query.documentType || '')
      .trim()
      .toLowerCase();
    const docConfig = DOC_TYPE_MAP[documentType];
    if (!docConfig) {
      return res.status(400).json({
        message: 'Invalid documentType. Allowed values: aadhaar_front, aadhaar_back, pan, selfie',
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: 'No document uploaded' });
    }

    if (!isCloudinaryConfigured()) {
      return res.status(500).json({ message: 'Cloudinary is not configured on the server' });
    }

    const folder = `${baseFolder}/${req.user._id}`;
    const [existingKyc, uploadResult] = await Promise.all([
      KycApplication.findOne({ user: req.user._id }),
      uploadImageBuffer(req.file.buffer, {
        folder,
        publicId: `${documentType}-${Date.now()}`,
      }),
    ]);


    if (existingKyc && existingKyc[docConfig.publicIdField]) {
      try {
        await deleteFromCloudinary(existingKyc[docConfig.publicIdField]);
      } catch (cloudErr) {
        console.warn('Cloudinary cleanup failed', cloudErr.message || cloudErr);
      }
    }


    const updates = {
      [docConfig.field]: uploadResult.secure_url,
      [docConfig.publicIdField]: uploadResult.public_id,
    };


    const kyc = await KycApplication.findOneAndUpdate(
      { user: req.user._id },
      { $set: updates },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );


    return res.status(201).json({
      documentType,
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      kyc: buildStatusPayload(kyc),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }

};

// User submits or resubmits KYC details (uses uploaded Cloudinary URLs if present)
const submitKyc = async (req, res) => {

  try {
    const payload = req.body || {};
    const existing = await KycApplication.findOne({ user: req.user._id });
    const docs = mergeDocuments(payload, existing);

    const missing = REQUIRED_DOC_FIELDS.filter((field) => !docs[field]);
    if (missing.length) {
      return res.status(400).json({ message: `Missing documents: ${missing.join(', ')}` });
    }

    const metadata = payload.metadata || existing?.metadata;

    const kyc = await KycApplication.findOneAndUpdate(
      { user: req.user._id },
      {
        ...docs,
        metadata,
        user: req.user._id,
        status: 'pending',
        rejectionReason: undefined,
        reviewer: undefined,
        submittedAt: new Date(),
        verifiedAt: undefined,
        rejectedAt: undefined,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    return res.status(201).json(buildStatusPayload(kyc));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Get the logged-in user's KYC status
const getKycStatus = async (req, res) => {
  try {
    const kyc = await KycApplication.findOne({ user: req.user._id });
    return res.json(buildStatusPayload(kyc));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Admin review: approve or reject a KYC
const adminReviewKyc = async (req, res) => {
  try {
    const { decision, reason } = req.body || {};
    if (!['verified', 'rejected'].includes(decision)) {
      return res.status(400).json({ message: 'decision must be verified or rejected' });
    }

    const kyc = await KycApplication.findById(req.params.kycId);
    if (!kyc) {
      return res.status(404).json({ message: 'KYC application not found' });
    }

    kyc.status = decision;
    kyc.reviewer = req.user._id;
    kyc.rejectionReason = decision === 'rejected' ? (reason || 'Incomplete or invalid documents') : undefined;
    kyc.verifiedAt = decision === 'verified' ? new Date() : undefined;
    kyc.rejectedAt = decision === 'rejected' ? new Date() : undefined;
    await kyc.save();

    await createUserNotification({
      userId: kyc.user,
      title: `KYC ${decision}`,
      message:
        decision === 'verified'
          ? 'Your KYC has been approved.'
          : `Your KYC was rejected. ${kyc.rejectionReason}`,
      type: 'kyc',
      metadata: { kycId: kyc._id, status: kyc.status },
    });

    return res.json(buildStatusPayload(kyc));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Admin: get full KYC detail including document URLs
const getKycDetailAdmin = async (req, res) => {
  try {
    const kyc = await KycApplication.findById(req.params.kycId).populate(
      'user',
      'name email mobile referralCode role',
    );

    if (!kyc) {
      return res.status(404).json({ message: 'KYC application not found' });
    }

    return res.json({
      ...kyc.toObject(),
      documents: {
        aadhaarFrontUrl: kyc.aadhaarFrontUrl,
        aadhaarBackUrl: kyc.aadhaarBackUrl,
        panUrl: kyc.panUrl,
        selfieUrl: kyc.selfieUrl,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Admin: search users and inspect KYC status for manual verification flow
const adminSearchUsersForManualKyc = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { role: 'user' };
    if (q) {
      const regex = new RegExp(q, 'i');
      filter.$or = [{ name: regex }, { email: regex }, { mobile: regex }, { referralCode: regex }];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('name email mobile referralCode isActive isEmailVerified isMobileVerified createdAt'),
      User.countDocuments(filter),
    ]);

    const userIds = users.map((user) => user._id);
    const kycs = await KycApplication.find({ user: { $in: userIds } }).select(
      'user status verifiedAt submittedAt rejectedAt rejectionReason',
    );
    const kycMap = new Map(kycs.map((kyc) => [kyc.user.toString(), kyc]));

    const data = users.map((user) => {
      const kyc = kycMap.get(user._id.toString());
      return {
        user,
        kyc: kyc
          ? {
              _id: kyc._id,
              status: kyc.status,
              verifiedAt: kyc.verifiedAt,
              submittedAt: kyc.submittedAt,
              rejectedAt: kyc.rejectedAt,
              rejectionReason: kyc.rejectionReason,
            }
          : { status: 'not_submitted' },
      };
    });

    return res.json({
      data,
      pagination: {
        total,
        page,
        limit,
        hasMore: skip + data.length < total,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Admin: manually mark a user as KYC verified, including users with no KYC submission
const adminManualVerifyKyc = async (req, res) => {
  try {
    const { userId } = req.params;
    const { adminNote } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const user = await User.findById(userId).select('name email mobile role');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (user.role !== 'user') {
      return res.status(400).json({ message: 'Manual KYC verification is only allowed for user accounts' });
    }

    let kyc = await KycApplication.findOne({ user: user._id });
    if (!kyc) {
      kyc = new KycApplication({
        user: user._id,
        submittedAt: new Date(),
      });
    }

    const metadata = typeof kyc.metadata === 'object' && kyc.metadata !== null ? { ...kyc.metadata } : {};
    metadata.manualVerification = true;
    metadata.manualVerifiedBy = req.user._id.toString();
    metadata.manualVerifiedAt = new Date().toISOString();
    if (adminNote !== undefined) {
      metadata.adminNote = String(adminNote).trim();
    }

    kyc.status = 'verified';
    kyc.reviewer = req.user._id;
    kyc.rejectionReason = undefined;
    kyc.rejectedAt = undefined;
    kyc.verifiedAt = new Date();
    kyc.metadata = metadata;
    await kyc.save();

    await createUserNotification({
      userId: user._id,
      title: 'KYC verified',
      message: 'Your KYC has been manually approved by admin.',
      type: 'kyc',
      metadata: { kycId: kyc._id, status: kyc.status, manualVerification: true },
    });

    return res.json({
      message: 'User KYC marked as verified',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
      },
      kyc: buildStatusPayload(kyc),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};


module.exports = {
  submitKyc,
  getKycStatus,
  uploadKycDocument,
  adminReviewKyc,
  getKycDetailAdmin,
  adminSearchUsersForManualKyc,
  adminManualVerifyKyc,
};
