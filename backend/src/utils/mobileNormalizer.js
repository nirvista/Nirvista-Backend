const MOBILE_ALIAS_DOMAIN = process.env.MOBILE_ALIAS_DOMAIN || 'mobile.local';

const normalizeChannel = (channel = '') => {
  if (!channel) {
    return '';
  }

  const normalized = channel.toLowerCase();
  if (normalized === 'sms') return 'mobile';
  if (normalized === 'mobile') return 'mobile';
  if (normalized === 'email') return 'email';
  return '';
};

const normalizeCountryCode = (countryCode = '') => {
  const raw = String(countryCode || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  return digits.replace(/^00/, '');
};

const normalizeMobileNumber = (mobile = '', countryCode = '') => {
  const raw = String(mobile || '').trim();
  const countryDigits = normalizeCountryCode(countryCode);
  if (!raw) {
    return {
      raw: '',
      normalized: '',
      variants: [],
      digits: '',
      isValid: false,
      minDigits: countryDigits ? 6 : 10,
    };
  }

  const digitsOnly = raw.replace(/\D/g, '');
  const hasExplicitCountry = raw.startsWith('+') || Boolean(countryDigits);
  let e164 = '';

  if (raw.startsWith('+') && digitsOnly) {
    e164 = `+${digitsOnly}`;
  } else if (countryDigits && digitsOnly) {
    const alreadyHasCountry = digitsOnly.startsWith(countryDigits)
      && digitsOnly.length > countryDigits.length + 5;
    e164 = `+${alreadyHasCountry ? digitsOnly : countryDigits + digitsOnly}`;
  } else if (digitsOnly) {
    e164 = digitsOnly.length > 10 ? `+${digitsOnly}` : `+91${digitsOnly}`;
  }

  const normalized = e164 || digitsOnly || raw;
  const normalizedDigits = normalized.replace(/\D/g, '');
  const minDigits = hasExplicitCountry ? 6 : 10;
  const isValid = normalizedDigits.length >= minDigits;

  const variants = new Set();
  if (raw) variants.add(raw);
  if (digitsOnly) variants.add(digitsOnly);
  if (normalized) variants.add(normalized);
  if (e164) {
    variants.add(e164);
    variants.add(e164.replace(/^\+/, ''));
  }

  const core10 = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : '';
  const looksIndian = digitsOnly.startsWith('91') && digitsOnly.length >= 12;
  const includeIndiaVariants = countryDigits === '91'
    || (!countryDigits && (digitsOnly.length <= 10 || looksIndian));
  if (core10 && includeIndiaVariants) {
    variants.add(core10);
    variants.add(`+91${core10}`);
    variants.add(`91${core10}`);
    variants.add(`0${core10}`);
  }

  return {
    raw,
    normalized,
    variants: Array.from([...variants].filter(Boolean)),
    digits: normalizedDigits,
    isValid,
    minDigits,
  };
};

const getSmsDestination = ({ variants = [], normalized = '', raw = '' }) => {
  const plusVariant = variants.find((value) => /^\+\d+$/.test(value));
  if (plusVariant) return plusVariant;
  const numericVariant = variants.find((value) => /^\d+$/.test(value));
  return numericVariant || normalized || raw;
};

const buildMobileAliasEmail = (mobile) => {
  const { normalized } = normalizeMobileNumber(mobile);
  const cleaned = String(normalized || '').trim();
  if (!cleaned) return undefined;
  return `${cleaned}@${MOBILE_ALIAS_DOMAIN}`;
};

module.exports = {
  normalizeChannel,
  normalizeCountryCode,
  normalizeMobileNumber,
  getSmsDestination,
  buildMobileAliasEmail,
};
