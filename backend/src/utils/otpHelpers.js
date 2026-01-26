const { generateOTP, sendOTP } = require('./otpService');

const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);

const buildOtpPayload = (channel, purpose) => ({
  code: generateOTP(),
  expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
  channel,
  purpose,
});

const sendOtpForUser = async ({
  user,
  channel,
  purpose,
  destination,
}) => {
  const otpPayload = buildOtpPayload(channel, purpose);
  user.otp = otpPayload;
  await user.save();

  const otpChannel = channel === 'mobile' ? 'sms' : channel;
  await sendOTP(destination, otpPayload.code, otpChannel);
  return otpPayload;
};

const verifyUserOtp = ({ user, otp, purpose }) => {
  if (!user.otp || !user.otp.code) {
    return { ok: false, message: 'No OTP pending verification' };
  }
  const normalizedOtp = otp === undefined || otp === null
    ? ''
    : String(otp).trim();

  if (!normalizedOtp) {
    return { ok: false, message: 'OTP is required' };
  }

  if (user.otp.code !== normalizedOtp) {
    return { ok: false, message: 'Invalid OTP' };
  }
  if (user.otp.expiresAt && user.otp.expiresAt < new Date()) {
    return { ok: false, message: 'OTP expired' };
  }
  if (purpose && user.otp.purpose !== purpose) {
    return { ok: false, message: 'OTP purpose mismatch' };
  }
  return { ok: true };
};

module.exports = {
  buildOtpPayload,
  sendOtpForUser,
  verifyUserOtp,
};
