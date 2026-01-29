const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

// Load env vars (if not loaded in server.js, but good to have here or there)
// dotenv.config() is usually called in server.js

const app = express();

// CORS Configuration - Allow all origins for global accessibility
const corsOptions = {
  origin: (origin, callback) => callback(null, true), // reflect requesting origin
  credentials: false, // no cookies; Authorization header is allowed
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 86400
};

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors(corsOptions));

// Additional CORS headers for extra compatibility
app.use((req, res, next) => {
  const origin = req.get('Origin') || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Routes Placeholder
app.get('/', (req, res) => {
  res.json({ 
    message: 'ICO Authentication API is running',
    version: '1.0.0',
    status: 'healthy'
  });
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/api/health', (req, res) => {
  // Mirror /health for platforms or clients that prefix routes with /api
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Define Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/products', require('./routes/productRoutes'));
app.use('/api/cart', require('./routes/cartRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/admin/auth', require('./routes/adminAuthRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/ico', require('./routes/icoRoutes'));
app.use('/api/user', require('./routes/userRoutes'));
app.use('/api/wallet', require('./routes/walletRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/kyc', require('./routes/kycRoutes'));

module.exports = app;
