# Flutter Admin Staking Guide

This guide is for the Flutter admin app implementation of the staking module.

Required flow:

1. Admin opens `Staking` tab.
2. App shows list of all users who have staking.
3. Admin taps one user.
4. App opens new staking detail page for that user.
5. App shows all staking details of that user.

## 1) Base API Setup

- Base URL: `{{API_BASE_URL}}`
- All admin staking APIs need admin JWT token.
- Header:

```http
Authorization: Bearer <admin_jwt_token>
Content-Type: application/json
```

## 2) APIs To Use

### A. Staking users list

- Method: `GET`
- URL: `/api/admin/panel/staking/users`

Optional query params:

- `page`
- `limit`
- `search`
- `status`
- `type` = `fixed` or `flexible`
- `durationMonths`

Example:

```http
GET /api/admin/panel/staking/users?page=1&limit=20&search=rohan
```

Response:

```json
{
  "data": [
    {
      "userId": "USER_ID",
      "fullName": "User Name",
      "email": "user@mail.com",
      "mobile": "919999999999",
      "referralCode": "NIR123",
      "totalStakes": 3,
      "activeStakes": 2,
      "closedStakes": 1,
      "totalStakedTokens": 5000,
      "totalRewardTokens": 900,
      "totalExpectedReturn": 5900,
      "fixedStakedTokens": 3000,
      "flexibleStakedTokens": 2000,
      "latestStakeAt": "2026-03-25T10:00:00.000Z",
      "stakeStatuses": ["active", "paid"],
      "actions": {
        "viewDetails": true
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

### B. One staking user full detail

- Method: `GET`
- URL: `/api/admin/panel/staking/users/:userId`

Example:

```http
GET /api/admin/panel/staking/users/USER_ID
```

Response:

```json
{
  "user": {
    "userId": "USER_ID",
    "fullName": "User Name",
    "email": "user@mail.com",
    "mobile": "919999999999",
    "referralCode": "NIR123",
    "accountStatus": "active",
    "joinedAt": "2026-01-10T08:00:00.000Z",
    "lastLoginAt": "2026-03-24T12:00:00.000Z",
    "tokenWalletBalance": 1200,
    "bankDetails": {
      "accountHolderName": "User Name",
      "accountNumber": "XXXXXX",
      "ifsc": "HDFC0001234",
      "bankName": "HDFC"
    }
  },
  "summary": {
    "totalStakes": 2,
    "activeStakes": 1,
    "closedStakes": 1,
    "fixedPlans": 1,
    "flexiblePlans": 1,
    "totalStakedTokens": 3000,
    "totalRewardTokens": 360,
    "totalRewardPaid": 120,
    "totalRewardPending": 240,
    "totalExpectedReturn": 3360,
    "availableDurationsMonths": [3, 12],
    "statuses": ["active", "paid"]
  },
  "positions": [
    {
      "stakeId": "STAKE_ID",
      "tokenAmount": 1000,
      "stakingType": "fixed",
      "durationMonths": 12,
      "interestRate": 2,
      "monthlyInterestAmount": 20,
      "interestAmount": 240,
      "expectedReturn": 1240,
      "rewardPaid": 60,
      "rewardPending": 180,
      "status": "active",
      "startedAt": "2026-01-01T00:00:00.000Z",
      "maturesAt": "2027-01-01T00:00:00.000Z",
      "claimedAt": null,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-03-25T00:00:00.000Z",
      "withdrawal": {
        "noticeDays": 0
      },
      "vestingSchedule": [
        {
          "paymentNo": 1,
          "label": "Month 1",
          "amount": 20,
          "status": "withdrawn",
          "dueAt": "2026-02-01T00:00:00.000Z"
        }
      ],
      "timeline": [
        {
          "label": "created",
          "at": "2026-01-01T00:00:00.000Z",
          "status": "completed"
        }
      ],
      "metadata": {
        "stackPlan": "fixed"
      }
    }
  ]
}
```

## 3) Recommended Flutter Screen Flow

### Screen 1: `AdminStakingUsersPage`

Purpose:

- Show all users who have staking.
- Add search and filters.
- On tap open detail page.

Suggested UI:

- AppBar title: `Staking`
- Search field
- Filter chips/dropdown:
  - `All`
  - `Active`
  - `Paid`
  - `Fixed`
  - `Flexible`
- List items:
  - User name
  - Mobile
  - Total stakes
  - Total staked tokens
  - Total reward tokens
  - Latest stake date
  - Status badges

Tap action:

```dart
Navigator.push(
  context,
  MaterialPageRoute(
    builder: (_) => AdminStakingUserDetailPage(userId: item.userId),
  ),
);
```

### Screen 2: `AdminStakingUserDetailPage`

Purpose:

- Show every staking detail for one user.

Suggested sections:

1. User info card
2. Summary card
3. All staking plans list
4. Vesting schedule list
5. Timeline/activity list

User info card fields:

- Name
- Email
- Mobile
- Referral code
- Account status
- Joined date
- Last login
- Token wallet balance
- Bank details

Summary card fields:

- Total stakes
- Active stakes
- Closed stakes
- Fixed plans
- Flexible plans
- Total staked tokens
- Total reward tokens
- Total reward paid
- Total reward pending
- Total expected return

Each staking plan card:

- Stake ID
- Token amount
- Staking type
- Duration months
- Interest rate
- Monthly interest amount
- Total interest amount
- Expected return
- Reward paid
- Reward pending
- Status
- Started at
- Mature at
- Claimed at
- Withdrawal notice details

Each vesting row:

- Payment number
- Label
- Amount
- Status
- Due date

Each timeline row:

- Label
- Date
- Status

## 4) Flutter Model Mapping

### List models

```dart
class AdminStakingUserListResponse {
  final List<AdminStakingUserItem> data;
  final Pagination pagination;

  AdminStakingUserListResponse({
    required this.data,
    required this.pagination,
  });
}

class AdminStakingUserItem {
  final String userId;
  final String fullName;
  final String? email;
  final String? mobile;
  final String? referralCode;
  final int totalStakes;
  final num totalStakedTokens;
  final num totalRewardTokens;
  final num totalExpectedReturn;
  final num fixedStakedTokens;
  final num flexibleStakedTokens;
  final DateTime? latestStakeAt;
  final List<String> stakeStatuses;

  AdminStakingUserItem({
    required this.userId,
    required this.fullName,
    this.email,
    this.mobile,
    this.referralCode,
    required this.totalStakes,
    required this.totalStakedTokens,
    required this.totalRewardTokens,
    required this.totalExpectedReturn,
    required this.fixedStakedTokens,
    required this.flexibleStakedTokens,
    this.latestStakeAt,
    required this.stakeStatuses,
  });
}
```

### Detail models

```dart
class AdminStakingUserDetailResponse {
  final AdminStakingUserProfile user;
  final AdminStakingSummary summary;
  final List<AdminStakePosition> positions;

  AdminStakingUserDetailResponse({
    required this.user,
    required this.summary,
    required this.positions,
  });
}

class AdminStakingUserProfile {
  final String userId;
  final String fullName;
  final String? email;
  final String? mobile;
  final String? referralCode;
  final String accountStatus;
  final DateTime? joinedAt;
  final DateTime? lastLoginAt;
  final num tokenWalletBalance;

  AdminStakingUserProfile({
    required this.userId,
    required this.fullName,
    this.email,
    this.mobile,
    this.referralCode,
    required this.accountStatus,
    this.joinedAt,
    this.lastLoginAt,
    required this.tokenWalletBalance,
  });
}

class AdminStakingSummary {
  final int totalStakes;
  final int activeStakes;
  final int closedStakes;
  final int fixedPlans;
  final int flexiblePlans;
  final num totalStakedTokens;
  final num totalRewardTokens;
  final num totalRewardPaid;
  final num totalRewardPending;
  final num totalExpectedReturn;
  final List<int> availableDurationsMonths;
  final List<String> statuses;

  AdminStakingSummary({
    required this.totalStakes,
    required this.activeStakes,
    required this.closedStakes,
    required this.fixedPlans,
    required this.flexiblePlans,
    required this.totalStakedTokens,
    required this.totalRewardTokens,
    required this.totalRewardPaid,
    required this.totalRewardPending,
    required this.totalExpectedReturn,
    required this.availableDurationsMonths,
    required this.statuses,
  });
}

class AdminStakePosition {
  final String stakeId;
  final num tokenAmount;
  final String stakingType;
  final int durationMonths;
  final num interestRate;
  final num monthlyInterestAmount;
  final num interestAmount;
  final num expectedReturn;
  final num rewardPaid;
  final num rewardPending;
  final String status;
  final DateTime? startedAt;
  final DateTime? maturesAt;
  final DateTime? claimedAt;
  final List<AdminVestingScheduleItem> vestingSchedule;
  final List<AdminStakeTimelineItem> timeline;

  AdminStakePosition({
    required this.stakeId,
    required this.tokenAmount,
    required this.stakingType,
    required this.durationMonths,
    required this.interestRate,
    required this.monthlyInterestAmount,
    required this.interestAmount,
    required this.expectedReturn,
    required this.rewardPaid,
    required this.rewardPending,
    required this.status,
    this.startedAt,
    this.maturesAt,
    this.claimedAt,
    required this.vestingSchedule,
    required this.timeline,
  });
}

class AdminVestingScheduleItem {
  final int paymentNo;
  final String label;
  final num amount;
  final String status;
  final DateTime? dueAt;

  AdminVestingScheduleItem({
    required this.paymentNo,
    required this.label,
    required this.amount,
    required this.status,
    this.dueAt,
  });
}

class AdminStakeTimelineItem {
  final String label;
  final DateTime? at;
  final String status;

  AdminStakeTimelineItem({
    required this.label,
    this.at,
    required this.status,
  });
}
```

## 5) Flutter API Service Example

Example using `dio`:

```dart
class AdminStakingApi {
  final Dio dio;

  AdminStakingApi(this.dio);

  Future<Response> getStakingUsers({
    int page = 1,
    int limit = 20,
    String? search,
    String? status,
    String? type,
    int? durationMonths,
  }) {
    return dio.get(
      '/api/admin/panel/staking/users',
      queryParameters: {
        'page': page,
        'limit': limit,
        if (search != null && search.isNotEmpty) 'search': search,
        if (status != null && status.isNotEmpty) 'status': status,
        if (type != null && type.isNotEmpty) 'type': type,
        if (durationMonths != null) 'durationMonths': durationMonths,
      },
    );
  }

  Future<Response> getStakingUserDetail(String userId) {
    return dio.get('/api/admin/panel/staking/users/$userId');
  }
}
```

## 6) Flutter Controller / Provider Flow

For list page:

1. Call `getStakingUsers()` in `initState` or provider init.
2. Store list in state.
3. Show loader while fetching.
4. Show empty state if `data.isEmpty`.
5. On search/filter change, call API again.
6. On scroll end, load next page if `hasMore == true`.

For detail page:

1. Receive `userId` from previous page.
2. Call `getStakingUserDetail(userId)`.
3. Render user info first.
4. Render summary cards.
5. Render `positions` in expandable cards.
6. Under each position render `vestingSchedule` and `timeline`.

## 7) Suggested Widget Structure

List page:

- `AdminStakingUsersPage`
- `StakingSearchBar`
- `StakingFilterRow`
- `StakingUserCard`
- `PaginationLoader`

Detail page:

- `AdminStakingUserDetailPage`
- `StakingUserHeaderCard`
- `StakingSummaryCard`
- `StakePositionCard`
- `VestingScheduleList`
- `StakeTimelineList`

## 8) Important UI Notes

- Show `fixed` and `flexible` as colored badges.
- Show `active`, `paid`, `matured`, `closed` with separate colors.
- Format token values consistently.
- Format all dates from ISO string to local readable format.
- Handle `null` values safely.
- Do not assume bank details always exist.

## 9) Error Handling

Most API errors return:

```json
{ "message": "Human readable error message" }
```

Handle:

- `401`: token invalid or expired
- `403`: admin role missing
- `404`: user not found
- `500`: server issue

## 10) Implementation Order

1. Create API service.
2. Create staking list models.
3. Create staking detail models.
4. Build `Staking` tab screen.
5. Bind list API.
6. Add search and filters.
7. Add click navigation to detail screen.
8. Build detail page.
9. Bind detail API.
10. Show positions, vesting, and timeline.

## 11) Final Mapping For Your Requirement

Your requirement:

- `There is a staking tab`
  - Use `GET /api/admin/panel/staking/users`
- `Show all staked users`
  - Read response `data`
- `When click particular user`
  - Pass `userId`
- `Open new page`
  - Navigate to `AdminStakingUserDetailPage`
- `Show each and every detail related to staking`
  - Read `user`
  - Read `summary`
  - Read `positions`
  - For each position read `vestingSchedule`
  - For each position read `timeline`

## 12) Backend Reference

Backend routes:

- `backend/src/routes/adminRoutes.js`

Backend controller:

- `backend/src/controllers/adminPanelController.js`
