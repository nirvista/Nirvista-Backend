const mongoose = require('mongoose');
const path = require('path');
const User = require('./src/models/User');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const identifier = process.argv[2];

if (!identifier) {
  console.error('Usage: node promote_admin.js <email-or-mobile>');
  process.exit(1);
}

const buildQuery = (value) => {
  const trimmed = value.trim();
  if (trimmed.includes('@')) {
    return { email: trimmed.toLowerCase() };
  }
  return { mobile: trimmed };
};

(async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI missing in environment');
    }

    await mongoose.connect(process.env.MONGO_URI);
    const query = buildQuery(identifier);
    const user = await User.findOne(query);

    if (!user) {
      console.error('User not found for provided identifier');
      process.exit(1);
    }

    user.role = 'admin';
    await user.save();

    console.log(`User ${user._id.toString()} promoted to admin.`);
    process.exit(0);
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
})();
