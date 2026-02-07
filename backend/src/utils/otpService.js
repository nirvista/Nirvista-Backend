const nodemailer = require('nodemailer');
const twilio = require('twilio');

const OTP_MOBILE_PROVIDER = process.env.OTP_MOBILE_PROVIDER || 'twilio';

const hasSMTPConfig = () =>
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;

// Gmail-style auth (supports either EMAIL_* or SMTP_* for convenience)
const hasGmailConfig = () =>
  (process.env.EMAIL_USER || process.env.SMTP_USER) &&
  (process.env.EMAIL_PASS || process.env.SMTP_PASS);

const createSMTPTransport = () => {
  if (!hasSMTPConfig()) {
    return null;
  }

  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === 'true'
    : port === 465;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

const createGmailTransport = () => {
  if (!hasGmailConfig()) {
    return null;
  }

  const user = process.env.EMAIL_USER || process.env.SMTP_USER;
  const pass = process.env.EMAIL_PASS || process.env.SMTP_PASS;

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user,
      pass,
    },
  });
};

// Generate a 6-digit numeric OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP via email using SMTP credentials (Render/Gmail etc.)
const sendEmailOTP = async (email, otp) => {
  const subject = 'Your OTP Code';
  const text = `Your OTP code is: ${otp}. It expires in 10 minutes.`;

  if (hasSMTPConfig()) {
    try {
      const transporter = createSMTPTransport();
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: email,
        subject,
        text,
      });
      console.log(`OTP sent via SMTP to email: ${email}`);
      return true;
    } catch (error) {
      console.error('Error sending email OTP via SMTP:', error);
      // fall back to Gmail if configured
    }
  }

  if (hasGmailConfig()) {
    try {
      const transporter = createGmailTransport();
      const fromUser = process.env.EMAIL_USER || process.env.SMTP_USER;
      await transporter.sendMail({
        from: `"nirvistra" <${fromUser}>`,
        to: email,
        subject,
        text,
      });
      console.log(`OTP sent via Gmail SMTP to email: ${email}`);
      return true;
    } catch (error) {
      console.error('Error sending email OTP via Gmail SMTP:', error);
    }
  }

  throw new Error('Email transport is not configured');
};

// Send OTP via SMS using Twilio
const sendSmsOTP = async (mobile, otp) => {
  try {
    // Ensure mobile number includes country code (fallback to +91 for 10-digit local numbers)
    let formattedMobile = String(mobile || '').trim();
    const digitsOnly = formattedMobile.replace(/\D/g, '');
    if (!formattedMobile.startsWith('+')) {
      formattedMobile = digitsOnly.length > 10
        ? `+${digitsOnly}`
        : `+91${digitsOnly}`;
    }

    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN,
    );
    const message = await client.messages.create({
      body: `Your OTP code is: ${otp}. It expires in 10 minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedMobile,
    });

    console.log(`SMS sent successfully! Message SID: ${message.sid}`);
    console.log(`OTP sent to mobile: ${formattedMobile}`);
    return true;
  } catch (error) {
    console.error('Error sending SMS OTP:', error);
    // Fallback: log OTP to console so the flow does not break
    console.log(`\n[FALLBACK - MOCK SMS] OTP for ${mobile}: ${otp}\n`);
    return true;
  }
};
// Unified OTP sender - type can be 'email', 'mobile' or 'sms'
const sendOTP = async (destination, otp, type = 'email') => {
  if (type === 'email') {
    if (!hasSMTPConfig() && !hasGmailConfig()) {
      console.log(`[MOCK EMAIL] OTP for ${destination}: ${otp}`);
      return true;
    }
    return await sendEmailOTP(destination, otp);
  } else if (type === 'mobile' || type === 'sms') {
    if (OTP_MOBILE_PROVIDER === 'firebase') {
      console.log(`[Firebase OTP] Skipping server SMS send for ${destination}.`);
      return true;
    }
    if (
      !process.env.TWILIO_ACCOUNT_SID ||
      process.env.TWILIO_ACCOUNT_SID.includes('your_twilio')
    ) {
      console.log(`[MOCK SMS] OTP for ${destination}: ${otp}`);
      return true;
    }
    return await sendSmsOTP(destination, otp);
  }
};

module.exports = { generateOTP, sendOTP };
