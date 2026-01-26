const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const app = require('./app');
const connectDB = require('./config/db');
const { initTokenPrice } = require('./utils/tokenPrice');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  await initTokenPrice();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
