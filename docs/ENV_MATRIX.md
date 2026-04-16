# Environment Matrix

This matrix covers the **platform** stack (`backend/` + `frontend/`) and integration with the root voice server.

## Backend (required)

- `DATABASE_URL`
- `JWT_SECRET` (>= 32 chars)
- `FRONTEND_ORIGIN`
- `AUTH_COOKIE_NAME` (optional, default set)

## Billing (Stripe)

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Subscription amounts use **`DISPLAY_PRICE_STARTER_USD` / `PRO` / `GOLD`** in `backend` config; percent discounts use the **`Coupon`** table in the database (no Stripe Dashboard Price or Coupon IDs).

## Affiliate

- `REFERRAL_COOKIE_NAME` (optional, default set)

## SMS / Phase 8

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_SMS_FROM`
- `USAGE_WEBHOOK_SECRET` (required for `/api/v1/usage/*`)

## Auth email (SES)

- `AWS_REGION`
- `SES_FROM_EMAIL`
- AWS credentials via environment, profile, or role

Used for password reset, **and** optional “new sign-in” email on successful login (same `SES_FROM_EMAIL` → user’s registered account email).

## Frontend (optional)

- `VITE_GA4_ID` (analytics enabled only when consent is accepted)

## Root voice server (separate app)

Defined in root `.env.example`; minimum:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `OPENAI_API_KEY`
- `PUBLIC_BASE_URL`
