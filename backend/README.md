# Auth Backend - Node.js + Express + MongoDB

Complete authentication backend with Email/Mobile signup, OTP verification, and PIN login.

## Features

- **Email Signup**: Register with email, password, and OTP verification
- **Mobile Signup**: Register with mobile number and OTP verification
- **Multiple Login Methods**:
  - Email + Password
  - Mobile + OTP
  - PIN (after setup)
- **Verification Enforcement**: Email/password, mobile OTP, and PIN logins require the corresponding email or mobile number to be verified via OTP.
- **Secure OTP Resend**: Re-running signup init regenerates OTPs for unverified users without creating duplicates.
- **Security**: JWT authentication, bcrypt password hashing
- **OTP Delivery**: SMTP (email) and Twilio (SMS) integration
- **Ecommerce Backend**: Category/product management, public catalog APIs, carts, checkout, and order tracking with admin tooling.
- **Payments**: PhonePe payment session utility + callback endpoint (supply real credentials via env vars).
- **ICO Module**: Token price from env, PhonePe-powered buy flow, sell requests, holdings & transaction history APIs.

## Tech Stack

- Node.js
- Express.js
- MongoDB (Mongoose)
- JWT (jsonwebtoken)
- Bcrypt
- Nodemailer (SMTP)
- Twilio (SMS)

## Installation

1. Clone the repository
```bash
git clone https://github.com/dsofts-it/ico.git
cd ico/backend
```

2. Install dependencies
```bash
npm install
```

3. Configure environment variables
```bash
cp .env.example .env
```
Edit `.env` and add your credentials:
- MongoDB URI
- JWT Secret
- SMTP credentials (for email OTP)
- Twilio credentials (for SMS OTP)

4. Start the server
```bash
npm run dev
```

Server will run on `http://localhost:5000`

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup/email-init` | Initiate email signup |
| POST | `/api/auth/signup/mobile-init` | Initiate mobile signup |
| POST | `/api/auth/signup/verify` | Verify OTP (email/mobile) |
| POST | `/api/auth/pin/setup` | Setup PIN (requires auth) |
| POST | `/api/auth/login/email` | Login with email/password |
| POST | `/api/auth/login/mobile-init` | Request mobile OTP |
| POST | `/api/auth/login/mobile-verify` | Verify mobile OTP & login |
| POST | `/api/auth/login/pin` | Login with PIN |

Notes:
- Mobile auth endpoints accept optional `countryCode` (for example `+91` or `91`) along with `mobile`.
- You can also pass a full E.164 number in `mobile`/`identifier` (for example `+14155550123`).

### Catalog & Ecommerce
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/products` | List products with filters/pagination |
| GET | `/api/products/categories/list` | List active categories |
| GET | `/api/products/:idOrSlug` | Fetch product details |
| GET | `/api/cart` | Get authenticated user cart |
| POST | `/api/cart/items` | Add item to cart |
| PATCH | `/api/cart/items/:itemId` | Update cart item quantity |
| DELETE | `/api/cart/items/:itemId` | Remove cart item |
| DELETE | `/api/cart` | Clear cart |
| POST | `/api/orders` | Create order + PhonePe session |
| GET | `/api/orders` | List user orders |
| GET | `/api/orders/:id` | Order details |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/categories` | List categories |
| POST | `/api/admin/categories` | Create category |
| PUT | `/api/admin/categories/:id` | Update category |
| DELETE | `/api/admin/categories/:id` | Delete category |
| GET | `/api/admin/products` | List products (all) |
| POST | `/api/admin/products` | Create product |
| PUT | `/api/admin/products/:id` | Update product |
| DELETE | `/api/admin/products/:id` | Delete product |
| GET | `/api/orders/admin` | Admin order list |
| PATCH | `/api/orders/admin/:id` | Update order/payment status |

### ICO Token
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ico/price` | Public token price |
| GET | `/api/ico/summary` | User holdings + valuation |
| GET | `/api/ico/transactions` | User ICO transactions |
| POST | `/api/ico/buy` | Initiate PhonePe buy |
| POST | `/api/ico/sell` | Request sell/payout |

### Wallet
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/wallet/summary` | Wallet balance, stats, and recent activity |
| GET | `/api/wallet/transactions` | Paginated wallet transaction history |
| POST | `/api/wallet/topup` | Initiate PhonePe wallet top-up |
| POST | `/api/wallet/withdraw` | Request manual withdrawal/payout |
| GET | `/api/wallet/admin/transactions` | Admin wallet transaction list (requires admin) |
| PATCH | `/api/wallet/admin/transactions/:transactionId` | Admin update for withdrawal statuses |

### Payments
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/payments/phonepe/callback` | Webhook to update orders/ICO txs |

**Important:** Email/password login only works after the email is verified. Mobile OTP and PIN login require the mobile number to be verified. If an OTP expires, call the corresponding signup init endpoint again to regenerate a secure code instead of creating duplicate users.

## Testing

Import `POSTMAN_COLLECTION.json` into Postman for ready-to-use API tests.

See `API_TESTING_GUIDE.md` for detailed testing instructions.

## Configuration

### Twilio Setup
For SMS OTP delivery, configure Twilio:
1. Create account at https://www.twilio.com
2. Get Account SID, Auth Token, and Phone Number
3. Add to `.env` file
4. For trial accounts, verify recipient numbers

See `TWILIO_SETUP.md` for detailed setup instructions.

### PhonePe Setup
1. Obtain a PhonePe Merchant account + sandbox credentials.
2. Populate `PHONEPE_MERCHANT_ID`, `PHONEPE_SALT_KEY`, `PHONEPE_SALT_INDEX`, and `PHONEPE_BASE_URL`.
3. Set `PHONEPE_CALLBACK_URL` to the deployed `/api/payments/phonepe/callback` endpoint.
4. Mobile app will receive `paymentSession` data (base64 payload + checksum) to redirect users to PhonePe.

### ICO Token Config
Set `ICO_TOKEN_SYMBOL` and `ICO_PRICE_INR` in env vars. The price is read on every request so you can adjust value without redeploying.

## Project Structure

```
backend/
├── src/
│   ├── config/
│   │   └── db.js              # MongoDB connection
│   ├── controllers/
│   │   └── authController.js  # Auth logic
│   ├── middleware/
│   │   └── authMiddleware.js  # JWT verification
│   ├── models/
│   │   └── User.js            # User schema
│   ├── routes/
│   │   └── authRoutes.js      # API routes
│   ├── utils/
│   │   ├── generateToken.js   # JWT generator
│   │   └── otpService.js      # OTP service
│   ├── app.js                 # Express app
│   └── server.js              # Entry point
├── .env.example               # Environment template
├── package.json
└── README.md
```

## License

ISC
