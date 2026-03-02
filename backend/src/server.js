const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const app = require('./app');
const { connectDB, isDbConnected } = require('./config/db');
const { initTokenPrice } = require('./utils/tokenPrice');

const PORT = process.env.PORT || 5000;
const DB_RETRY_DELAY_MS = Number(process.env.DB_RETRY_DELAY_MS || 5000);

const bootDatabase = async () => {
  while (!isDbConnected()) {
    try {
      await connectDB();
      await initTokenPrice();
      console.log('Database bootstrap complete');
      return;
    } catch (error) {
      console.error(`Database bootstrap retry in ${DB_RETRY_DELAY_MS}ms: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, DB_RETRY_DELAY_MS));
    }
  }
};

const startServer = async () => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Start DB bootstrap in background so health checks can respond quickly after cold starts.
  bootDatabase().catch((error) => {
    console.error('Database bootstrap failed', error);
  });
};

startServer().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
