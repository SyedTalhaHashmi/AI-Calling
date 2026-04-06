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
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_PRO`
- `STRIPE_PRICE_GOLD`

Optional coupon IDs:

- `STRIPE_COUPON_LAUNCH50`
- `STRIPE_COUPON_BUDDY30`
- `STRIPE_COUPON_BRASH3D`
- `STRIPE_COUPON_AI2025`

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

## Frontend (optional)

- `VITE_GA4_ID` (analytics enabled only when consent is accepted)

## Root voice server (separate app)

Defined in root `.env.example`; minimum:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `OPENAI_API_KEY`
- `PUBLIC_BASE_URL`
