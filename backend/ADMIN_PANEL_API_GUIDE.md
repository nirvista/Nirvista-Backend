# Nirvista Admin Panel API Guide (Frontend Integration)

## 1) Base Setup

- Base URL: `{{API_BASE_URL}}`
- Admin API prefix: `/api/admin`
- Admin Auth prefix: `/api/admin/auth`
- Content-Type: `application/json`
- Auth header for protected routes:

```http
Authorization: Bearer <admin_jwt_token>
```

## 2) Roles and Access

- `super_admin`: full write access (critical user/financial/config updates)
- `admin`: operational write (approvals, processing flows)
- `support`: read-only/monitoring (no financial or identity-changing writes)

`/api/admin/*` routes are protected and require one of: `support`, `admin`, `super_admin`.

## 3) Admin Login APIs

### POST `/api/admin/auth/login` (same as `/login/email`)
- Body:
```json
{
  "email": "info@nirvista.in",
  "password": "12345678"
}
```
- Response:
```json
{
  "_id": "USER_ID",
  "name": "Admin",
  "email": "info@nirvista.in",
  "role": "admin",
  "token": "JWT_TOKEN"
}
```

### POST `/api/admin/auth/login/otp-init`
- Body:
```json
{
  "mobile": "9999999999",
  "countryCode": "IN"
}
```
- Response:
```json
{ "message": "OTP sent to admin mobile", "userId": "USER_ID" }
```

### POST `/api/admin/auth/login/otp-verify`
- Body:
```json
{
  "mobile": "9999999999",
  "countryCode": "IN",
  "otp": "123456"
}
```
- Response:
```json
{
  "_id": "USER_ID",
  "name": "Admin User",
  "mobile": "919999999999",
  "token": "JWT_TOKEN"
}
```

## 4) Main Admin Panel APIs (UI-first)

## 4.1 User Management

### GET `/api/admin/panel/users`
- Query: `page`, `limit`, `search`, `accountStatus(active|suspended)`
- Response: paginated user table for listing page
```json
{
  "data": [
    {
      "userId": "U1",
      "fullName": "User Name",
      "emailAddress": "u@mail.com",
      "phoneNumber": "919999999999",
      "emailVerificationStatus": "verified",
      "phoneVerificationStatus": "verified",
      "kycStatus": "verified",
      "accountStatus": "active",
      "registrationDate": "2026-03-01T12:00:00.000Z",
      "tokenBalance": 1200,
      "actions": {
        "viewDetails": true,
        "transactions": true,
        "referrals": true,
        "addTokens": true,
        "resetPassword": true,
        "verifyEmail": true,
        "activateSuspendToggle": true,
        "editProfile": true
      }
    }
  ],
  "pagination": { "total": 1, "page": 1, "limit": 20, "hasMore": false }
}
```

### GET `/api/admin/panel/users/:id`
- User detail dashboard payload:
  - `profile`
  - `kyc`
  - `bankDetails`
  - `tokenFinancialSummary` (includes dynamic 8% bonus)
  - `stakingVesting`
  - `rewardsEarnings`
  - `wallets`

### PATCH `/api/admin/panel/users/:id/status` (`super_admin`)
- Body:
```json
{ "isActive": false, "reason": "Fraud check" }
```
- Response:
```json
{ "id": "U1", "isActive": false, "disabledAt": "ISO_DATE", "disabledReason": "Fraud check" }
```

### POST `/api/admin/panel/users/:id/tokens` (`super_admin`)
- Body:
```json
{
  "tokenAmount": 500,
  "reason": "Manual bonus",
  "type": "bonus"
}
```
- `type`: `bonus | adjustment | manual_allocation`
- Response: updated balance + adjustment entry

### POST `/api/admin/panel/users/:id/password/reset` (`super_admin`)
- Body (auto generate):
```json
{ "mode": "auto_generate" }
```
- Body (manual):
```json
{ "mode": "auto_generate", "newPassword": "NewPass@123" }
```
- Body (link trigger):
```json
{ "mode": "send_link" }
```

### POST `/api/admin/panel/users/:id/email/verify` (`super_admin`)
- Marks email verified.

### PATCH `/api/admin/panel/users/:id/profile` (`super_admin`)
- Body example:
```json
{
  "name": "Updated Name",
  "email": "updated@mail.com",
  "phone": "919999999999",
  "address": {
    "line1": "Street 1",
    "city": "Delhi",
    "state": "Delhi",
    "postalCode": "110001",
    "country": "IN"
  },
  "bankDetails": {
    "accountHolderName": "Updated Name",
    "accountNumber": "1234567890",
    "ifsc": "HDFC0001234",
    "bankName": "HDFC"
  }
}
```

## 4.2 User Transactions + Referrals

### GET `/api/admin/panel/users/:id/transactions`
- Query: `limit`
- Returns merged timeline of fiat/token/staking/referral transactions.

### GET `/api/admin/panel/users/:id/referrals/direct`
- Returns direct referral users pre-filtered for selected user.

### GET `/api/admin/panel/users/:id/referrals/tree`
- Query: `maxDepth` (default 8)
- Returns `tree`, `levelCounts`, `totals(active/inactive)`.

### GET `/api/admin/panel/users/:id/wallet`
- Wallet module view:
  - available/locked balances
  - total tokens
  - token adjustments
  - wallet transaction history

## 4.3 Commission Withdrawal Requests

### GET `/api/admin/panel/commission-withdrawals`
- Query: `page`, `limit`, `status`
- Response row fields:
  - `requestId`
  - `userId/userName`
  - `amount`
  - `walletBalanceAtRequestTime`
  - `paymentMethod`
  - `status`
  - `requestedDate/approvedDate/rejectedDate/paidDate`

### GET `/api/admin/panel/commission-withdrawals/:requestId`
- Returns full detail:
  - request
  - user details
  - commission breakdown
  - bank/UPI info
  - withdrawal history references

### POST `/api/admin/panel/commission-withdrawals/:requestId/approve` (`admin+`)
- Marks request as `processed`.

### POST `/api/admin/panel/commission-withdrawals/:requestId/reject` (`admin+`)
- Body:
```json
{ "reason": "Invalid bank details" }
```
- Mandatory `reason`.

### POST `/api/admin/panel/commission-withdrawals/:requestId/mark-paid` (`admin+`)
- Body:
```json
{
  "transactionReference": "BANK_UTR_123",
  "paymentNote": "Paid via NEFT"
}
```
- Mandatory `transactionReference`.

## 4.4 Staking Closure + Unified Staking

### GET `/api/admin/panel/staking/closures`
- Query: `page`, `limit`, `status`, `stakingType(fixed|flexible)`, `userId`
- Returns closure queue rows with reward and maturity.

### POST `/api/admin/panel/staking/:stakeId/close` (`admin+`)
- Closes stake (`status -> closed`).

### POST `/api/admin/panel/staking/:stakeId/payout` (`admin+`)
- Triggers payout and marks paid.

### GET `/api/admin/panel/staking/accounts`
- Query: `status`, `type(fixed|flexible)`
- Unified staking+vesting management payload.

## 4.5 Monthly Vesting Module

### GET `/api/admin/panel/vesting/schedule`
- Query: `userId`, `status(pending|paid|overdue)`
- Returns month-wise payment schedule, due dates, remaining payments.

### POST `/api/admin/panel/vesting/:stakeId/payments/:paymentNo/paid` (`admin+`)
- Marks one monthly payment as paid.

## 4.6 Pre-ICO Stage Management

### GET `/api/admin/panel/stages`
- List stage configuration.

### GET `/api/admin/panel/stages/metrics`
- Per-stage dashboard metrics:
  - users participated
  - tokens sold
  - revenue/funds raised

### POST `/api/admin/panel/stages` (`super_admin`)
- Body:
```json
{
  "stageName": "Phase 1",
  "tokenPrice": 10,
  "bonusPercent": 8,
  "startDate": "2026-04-01T00:00:00.000Z",
  "endDate": "2026-04-30T23:59:59.000Z",
  "allocationLimit": 1000000,
  "isActive": true,
  "autoSwitch": true
}
```

### PATCH `/api/admin/panel/stages/:stageId` (`super_admin`)
- Partial update with same fields as create.

### POST `/api/admin/panel/stages/:stageId/activation` (`super_admin`)
- Body:
```json
{ "active": true }
```

## 4.7 Commission Issues Module

### GET `/api/admin/panel/commission-issues`
- Query: `status`, `userId`

### POST `/api/admin/panel/commission-issues` (`admin+`)
- Body:
```json
{
  "userId": "USER_ID",
  "description": "Missing level commission",
  "relatedTransaction": "TXN_123"
}
```

### PATCH `/api/admin/panel/commission-issues/:issueId` (`admin+`)
- Body:
```json
{
  "status": "in_progress",
  "note": "Investigating source transaction"
}
```

### POST `/api/admin/panel/commission-issues/:issueId/adjust` (`admin+`)
- Body:
```json
{
  "amount": 250,
  "note": "Manual override after verification"
}
```

## 4.8 Fiat Transactions Module

### GET `/api/admin/panel/fiat-transactions`
- Query:
  - `page`, `limit`
  - `type(deposits|withdrawals|refunds)`
  - `status`
  - `userId`

### PATCH `/api/admin/panel/fiat-transactions/:transactionId/verify` (`admin+`)
- Body:
```json
{
  "status": "completed",
  "note": "Gateway confirmed"
}
```
- Allowed status: `processed | completed | failed | cancelled`

## 4.9 Token Purchase Module

### GET `/api/admin/panel/token-purchases`
- Query: `page`, `limit`, `status`, `userId`
- Returns:
  - `tokensPurchased`
  - `pricePerToken`
  - `totalAmountPaid`
  - `bonusTokens` (dynamic)
  - `paymentSource`

## 4.10 Alerts + Audit

### GET `/api/admin/panel/reminders`
- Returns:
```json
{
  "withdrawalRequestAlerts": 4,
  "stakingMaturityAlerts": 2,
  "vestingPaymentReminders": 5
}
```

### GET `/api/admin/panel/audit-logs` (`admin+`)
- Query: `page`, `limit`, `entityType`, `entityId`, `actorId`

---

## 5) Existing Legacy Admin APIs (Still Available)

These are still active under `/api/admin` and can be used by UI where needed:

- Dashboard:
  - `GET /stats`
  - `GET /users/count`
  - `GET /users/latest`
  - `GET /ico/price`
  - `POST /ico/price` (`super_admin`)
- Users/KYC:
  - `POST /users` (`super_admin`)
  - `GET /users`
  - `GET /users/details`
  - `GET /users/:id`
  - `GET /users/:id/financials`
  - `PATCH /users/:id/status` (`super_admin`)
  - `PATCH /users/:id/activation/manual` (`super_admin`)
  - `PATCH /users/:id/email` (`super_admin`)
  - `PATCH /users/:id/pin` (`super_admin`)
  - `GET /kyc`
  - `GET /kyc/manual/users`
  - `PATCH /kyc/manual/users/:userId/verify` (`super_admin`)
  - `GET /kyc/:kycId`
  - `PATCH /kyc/:kycId/status` (`super_admin`)
- Referrals/Transactions:
  - `GET /ico/transactions`
  - `GET /transactions/recent`
  - `GET /referrals/earnings`
  - `PATCH /referrals/earnings/:id` (`super_admin`)
  - `GET /referrals/tree`
  - `GET /referrals/tree/:userId`
  - `GET /referrals/search`
- Change Requests:
  - `GET /bank/requests`
  - `PATCH /bank/requests/:id` (`super_admin`)
  - `GET /mobile/requests`
  - `PATCH /mobile/requests/:id` (`super_admin`)
- Wallet:
  - `GET /wallet/transactions`
  - `PATCH /wallet/transactions/:transactionId` (`super_admin`)
  - `POST /wallet/manual-credit` (`super_admin`)
- Notifications/Catalog:
  - `GET /notifications`
  - `POST /notifications` (`admin+`)
  - `GET/POST/PUT/DELETE /categories` (`admin+`)
  - `GET/POST/PUT/DELETE /products` (`admin+`)

## 6) Common Status Enums for UI

- Account: `active | suspended`
- KYC: `pending | verified | rejected`
- Wallet transaction: `initiated | pending | processed | completed | failed | cancelled`
- Staking: `active | withdrawal_requested | withdrawal_available | matured | closed | paid | claimed | cancelled`
- Commission issue: `open | in_progress | resolved`

## 7) Standard Error Format

Most APIs return:

```json
{ "message": "Human readable error message" }
```

Use HTTP code handling in UI:
- `400`: validation/input
- `401`: token missing/invalid
- `403`: role/permission denied
- `404`: not found
- `500`: server error

## 8) Frontend Integration Flow (Recommended)

1. Login admin and store JWT.
2. Load `GET /api/admin/panel/reminders` + `GET /api/admin/stats` on dashboard.
3. User table from `GET /api/admin/panel/users`.
4. User details page from `GET /api/admin/panel/users/:id`.
5. User sub-tabs:
   - transactions: `/panel/users/:id/transactions`
   - referrals direct/tree: `/panel/users/:id/referrals/*`
   - wallet: `/panel/users/:id/wallet`
6. Role-check action buttons using `actions` from listing payload and/or `role` from JWT response.

