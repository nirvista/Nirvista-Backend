# Referral Withdrawal API Guide

This guide is for referral income withdrawal from the user app and admin panel.

Flow:

1. User earns referral income.
2. User checks withdrawable referral amount.
3. User adds bank or UPI details.
4. User requests referral withdrawal.
5. Request appears in admin panel.
6. Admin approves or rejects.
7. Admin marks paid and can upload proof image.
8. User sees final status in withdrawal history.

## 1) User APIs

### A. Get referral withdrawal summary

- Method: `GET`
- URL: `/api/wallet/referral/withdrawal-summary`

Response:

```json
{
  "withdrawableAmount": 1500,
  "pendingAmount": 500,
  "pendingRequests": 1,
  "totalEarned": 3000,
  "minWithdrawalAmount": 100,
  "payoutOptions": {
    "bank": {
      "available": true,
      "details": {
        "accountHolderName": "User Name",
        "accountNumber": "1234567890",
        "ifsc": "HDFC0001234",
        "bankName": "HDFC",
        "verified": true
      }
    },
    "upi": {
      "available": false,
      "details": null
    }
  },
  "recentRequests": []
}
```

### B. Add bank details

- Method: `POST`
- URL: `/api/user/bank`
- Body:

```json
{
  "accountHolderName": "User Name",
  "accountNumber": "1234567890",
  "ifsc": "HDFC0001234",
  "bankName": "HDFC",
  "otp": "123456"
}
```

### C. Add UPI details

- Method: `POST`
- URL: `/api/user/upi`
- Body:

```json
{
  "upiId": "user@upi",
  "otp": "123456"
}
```

### D. Create referral withdrawal request

- Method: `POST`
- URL: `/api/wallet/referral/withdraw`
- Body:

```json
{
  "amount": 500,
  "payoutMethod": "bank",
  "otp": "123456",
  "note": "Withdraw referral income"
}
```

- `payoutMethod`: `bank | upi`
- Uses referral wallet balance, not main wallet balance.

Response:

```json
{
  "message": "Referral withdrawal request created",
  "referral": {
    "withdrawableAmount": 1000,
    "totalEarned": 3000
  },
  "transaction": {
    "_id": "REQUEST_ID",
    "category": "withdrawal",
    "status": "pending",
    "amount": 500,
    "metadata": {
      "withdrawalSource": "referral",
      "payoutMethod": "bank"
    }
  }
}
```

### E. List user referral withdrawal history

- Method: `GET`
- URL: `/api/wallet/referral/withdrawals`
- Query: `page`, `limit`, `status`

Response:

```json
{
  "transactions": [
    {
      "_id": "REQUEST_ID",
      "category": "withdrawal",
      "status": "processed",
      "amount": 500,
      "metadata": {
        "withdrawalSource": "referral",
        "payoutMethod": "bank",
        "transactionReference": "UTR123",
        "proofImageUrl": "https://..."
      }
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "hasMore": false
  }
}
```

## 2) Admin APIs

### A. List referral withdrawal requests

- Method: `GET`
- URL: `/api/admin/panel/commission-withdrawals`
- Query: `page`, `limit`, `status`

### B. Get one referral withdrawal request detail

- Method: `GET`
- URL: `/api/admin/panel/commission-withdrawals/:requestId`

### C. Approve request

- Method: `POST`
- URL: `/api/admin/panel/commission-withdrawals/:requestId/approve`

Response:

```json
{
  "message": "Withdrawal request approved"
}
```

### D. Reject request

- Method: `POST`
- URL: `/api/admin/panel/commission-withdrawals/:requestId/reject`
- Body:

```json
{
  "reason": "Invalid bank details"
}
```

If admin rejects, amount is returned to user referral wallet.

### E. Mark paid with proof image

- Method: `POST`
- URL: `/api/admin/panel/commission-withdrawals/:requestId/mark-paid`
- Content-Type: `multipart/form-data`

Fields:

- `transactionReference` required
- `paymentNote` optional
- `proofImage` optional image file

Response:

```json
{
  "message": "Withdrawal request marked as paid",
  "request": {
    "_id": "REQUEST_ID",
    "status": "completed",
    "metadata": {
      "transactionReference": "UTR123",
      "paymentNote": "Paid via IMPS",
      "proofImageUrl": "https://..."
    }
  },
  "proofImageUrl": "https://..."
}
```

## 3) OTP Note

Before creating withdrawal or bank details:

- Call user OTP init endpoint:
  - `POST /api/user/otp/init`

Example:

```json
{
  "purpose": "withdrawal",
  "channel": "mobile"
}
```

For bank details:

```json
{
  "purpose": "bank_add",
  "channel": "mobile"
}
```

For UPI:

```json
{
  "purpose": "upi_add",
  "channel": "mobile"
}
```

## 4) Status Flow

- `pending`: user created request
- `processed`: admin approved request
- `failed`: admin rejected request
- `completed`: admin paid user

## 5) Important Notes

- Referral withdrawal is separate from main wallet withdrawal.
- Referral withdrawal uses `metadata.withdrawalSource = referral`.
- Main wallet withdrawal uses `metadata.withdrawalSource = wallet`.
- Admin commission withdrawal queue now shows only referral withdrawal requests.
