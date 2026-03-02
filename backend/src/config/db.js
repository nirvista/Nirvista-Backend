const mongoose = require('mongoose');

let connectPromise = null;
let isConnected = false;

mongoose.connection.on('connected', () => {
  isConnected = true;
});

mongoose.connection.on('disconnected', () => {
  isConnected = false;
});

const isDbConnected = () => isConnected || mongoose.connection.readyState === 1;

const connectDB = async () => {
  if (isDbConnected()) {
    return mongoose.connection;
  }

  if (connectPromise) {
    return connectPromise;
  }

  try {
    connectPromise = mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 8000),
      socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000),
      maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 10),
    });

    const conn = await connectPromise;
    isConnected = true;
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return conn.connection;
  } catch (error) {
    isConnected = false;
    console.error(`Error: ${error.message}`);
    throw error;
  } finally {
    connectPromise = null;
  }
};

module.exports = {
  connectDB,
  isDbConnected,
};
