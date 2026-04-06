# Deployment Runbook (Phase 10)

This runbook provides one path from **git push** to **live frontend + platform API**.

## 1) Build and verify locally

### Frontend

```bash
cd frontend
npm ci
npm run build
```

### Backend

```bash
cd backend
npm ci
npm run db:generate
node -e "require('./src/routes/auth'); require('./src/routes/user'); require('./src/routes/billing'); require('./src/routes/stripeWebhook'); require('./src/routes/affiliate'); require('./src/routes/twilio'); require('./src/routes/usage');"
```

## 2) Database migration in target environment

Run from `backend/` on deploy:

```bash
npm run db:migrate
npm run db:generate
```

## 3) Frontend deployment

- Build output: `frontend/dist`
- Must serve static files over HTTPS.
- Ensure `robots.txt`, `sitemap.xml`, and `og-image.svg` are reachable from the public root.

## 4) Backend deployment

- Start command: `node src/index.js`
- Health check: `GET /health`
- CORS must allow your frontend origin (`FRONTEND_ORIGIN`).

## 5) Stripe webhook setup

- Endpoint: `POST https://<api-host>/api/v1/stripe/webhook`
- Events:
  - `checkout.session.completed`
  - `invoice.paid`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
  - `payment_intent.payment_failed`

## 6) Twilio webhook setup (platform)

- Inbound SMS (STOP/START): `POST https://<api-host>/api/v1/twilio/sms`

## 7) Voice server → platform integration (Phase 8 contract)

Voice side posts usage events:

- Endpoint: `POST https://<api-host>/api/v1/usage/report`
- Header: `x-usage-secret: <USAGE_WEBHOOK_SECRET>`
- Body (minimum):

```json
{
  "userId": "optional-user-id",
  "callerNumber": "+13205551234",
  "secondsConsumed": 10
}
```

Optional reconcile task:

- `POST /api/v1/usage/sms-reconcile` with same auth header

## 8) Post-deploy smoke checks

1. `GET /health` returns `200`.
2. Login works and cookie session is set.
3. Billing checkout and webhook update user status.
4. Dashboard calls/transcripts/numbers endpoints return data.
5. Affiliate referral (`/ref/:code`) sets cookie and conversion is tracked.
6. Usage report decreases balance and triggers SMS thresholds (if Twilio configured).

## 9) Rollback note

- If deploy fails after migration, roll back app first, then run a forward-fix migration.
- Avoid destructive DB rollback in production without a backup snapshot.
