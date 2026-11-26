# Wallet authentication

Set `JWT_SECRET` to a high-entropy secret shared by all backend replicas. Set
`REDIS_URL` to the shared Redis instance.

1. Request `GET /api/auth/challenge`. The response contains a 32-byte hex
   `challenge` and an ISO 8601 `expiresAt` timestamp. The challenge is valid
   for five minutes and can be consumed once.
2. Decode the challenge into bytes and sign those bytes with the Stellar
   wallet. Send `{ "walletPublicKey", "challenge", "signature" }` to
   `POST /api/auth/verify`, with the signature encoded as base64.
3. Send the returned `accessToken` as `Authorization: Bearer <accessToken>`.
   Use it for API tasks, agents, payments, webhooks, and audit requests.
4. When the access token expires after 15 minutes, send `{ "refreshToken" }`
   to `POST /api/auth/refresh`. Store the returned replacement refresh token
   and discard the previous one. Refresh tokens expire after seven days.

Each sign-in client must implement this flow before calling protected routes.
The pre-existing session endpoints remain available for legacy session
management. Payment history is scoped to tasks owned by the authenticated
wallet.
