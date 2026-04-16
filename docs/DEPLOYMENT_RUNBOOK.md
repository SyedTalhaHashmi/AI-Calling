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

## 10) Deployment target options (AWS vs hybrid)

Open question 8 resolved: pick one primary path; both are valid.

### A) AWS (aligned with `websitebuilderfeature.md` §11 / §17)

- **API + workers:** EC2 Auto Scaling behind an ALB, or ECS/Fargate, or Elastic Beanstalk — Node runs `backend/src/index.js`.
- **Database:** RDS PostgreSQL (private subnets, Multi-AZ for production).
- **Cache (optional):** ElastiCache Redis if you add session/rate-limit storage there later.
- **Secrets:** AWS Secrets Manager or SSM Parameter Store; inject into task/EC2 at boot.
- **Email:** Amazon SES (production sending domain verified; same vars as `ENV_MATRIX.md`: `AWS_REGION`, `SES_FROM_EMAIL`).
- **Static site:** S3 + CloudFront for `frontend/dist`, or CloudFront origin to the host that serves the SPA.
- **DNS + TLS:** Route 53 + ACM certificates on ALB/CloudFront.

### B) Hybrid (common for smaller teams)

- **Frontend:** Vercel, Netlify, Cloudflare Pages, or S3+CloudFront — build `frontend`, set `VITE_PUBLIC_SITE_URL` to the live marketing URL.
- **API:** Railway, Render, Fly.io, or a single VPS — run `node src/index.js` from `backend/`, set `FRONTEND_ORIGIN`, `DATABASE_URL`, Stripe/Twilio/SES secrets.
- **Database:** Managed Postgres (Neon, Supabase, RDS) — same Prisma migrations from `backend/`.
- **Webhooks:** Stripe and Twilio must reach your public API URL; use HTTPS and document the exact paths in sections 5–7 above.

### C) What must be true in every environment

- HTTPS for the API and the marketing site.
- `FRONTEND_ORIGIN` matches the browser origin that calls the API (CORS + cookies).
- Voice server (`server.js` at repo root) reachable by Twilio; `PUBLIC_BASE_URL` set; `PLATFORM_API_*` secrets match the platform API.
- Login notification and transcript-related email: platform uses **SES when configured** (`SES_FROM_EMAIL`, `AWS_REGION`); voice server uses root `.env` **SMTP or sendmail** for transcripts (and falls back to `EMAIL_TO` when the platform does not return a line-specific `transcriptEmail`).
