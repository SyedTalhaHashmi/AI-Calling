# BuddyCallAI — Implementation phases

This plan maps `docs/websitebuilderfeature.md` and `docs/websitelegalprivacy.md` (plus the existing repo: `backend/`, `frontend/`, root voice stack) into **sequential phases**. Each phase has acceptance criteria so nothing material is skipped.

**Rule:** The **root voice server** (`server.js`, `handlers/mediaStream.js`, `routes/calls.js`) stays unchanged unless a phase explicitly calls for a **documented integration point** (e.g. webhooks from core → platform API). Prefer new code in `backend/` and `frontend/`.

---

## Global prerequisites (before Phase 1)

Answer the **open questions** at the bottom of this file. Implementation order below assumes those answers.

---

## Phase 1 — Legal & policy surfaces (websitelegalprivacy.md)

**Goal:** Ship the full Privacy Policy and Terms of Service (and Cookie Policy if required) as first-class UI, with correct internal links and contact block.

**Includes:**

- Import or mirror full text from `docs/websitelegalprivacy.md` (Part I Privacy, Part II Terms, Part III Contact).
- Routes **or** modals per your choice (see questions): e.g. `/privacy`, `/terms`, optional `/cookies`.
- Footer + registration “Terms / Privacy” links wired to those surfaces (no dead `#` links).
- Optional: WhatsApp / email consistency with spec (`info@…`, `privacy@…`).

**Acceptance:**

- User can read complete legal copy without leaving the product domain.
- All links from footer and register form open the correct content.

---

## Phase 2 — Auth completeness (websitebuilderfeature §4.7, §14.1)

**Goal:** Match authentication flows the spec expects, without blocking later billing.

**Includes:**

- `POST /api/v1/auth/forgot-password` — token generation, email via **SES** (or dev logging if no SES).
- `POST /api/v1/auth/reset-password` — validate token, bcrypt update.
- Frontend: forgot-password + reset pages (or modal), link from login.
- Password policy alignment: min 8 chars, **1 uppercase, 1 number** (spec §4.2) on backend + frontend validation.
- Optional UX: keep `/login` + `/register` **or** rebuild **auth modal** on landing (your call — see questions).

**Acceptance:**

- End-to-end reset works in dev; production uses SES when configured.

---

## Phase 3 — Data model & locale hardening (§03, §10)

**Goal:** Enforce **USA + Canada only** everywhere the spec requires; clean language UX.

**Includes:**

- Prisma / validation: `countryCode` restricted to **US | CA** (schema comment today mentions GB — align with product).
- Registration + profile: dropdown only US/CA; reject others at API.
- Landing: language switcher **English + Spanish only** — remove French/German options from UI (spec §10).
- Optional: `preferredLanguage` sync for logged-in users (`PUT /user/profile`).
- Optional: marketing routes `/es` (and `/ca` if needed for hreflang) — see questions.

**Acceptance:**

- No stray countries in UI, API, or schema for new signups.
- hreflang/meta story documented if you add locale routes.

---

## Phase 4 — Stripe subscriptions & billing (§4.6, §6, §14.3)

**Goal:** Real monthly subscriptions, allocation of seconds per plan, webhooks, status transitions.

**Includes:**

- Stripe: Products/Prices for Starter / Pro / Gold (USD monthly) per spec.
- Checkout Session creation after registration (or embedded flow) — align with `pending_payment` → `active`.
- Webhooks: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`, `customer.subscription.updated`, `payment_intent.payment_failed` (behaviors per spec §6.2).
- Map plan → `totalSecondsAllocated` / renewal logic.
- Frontend: “Upgrade”, “Manage billing” (Stripe Customer Portal or custom).
- Env: `STRIPE_*` keys, webhook signing secret.

**Acceptance:**

- Test mode: full subscribe → active user with correct minute pool; cancel reflects in DB.

---

## Phase 5 — Coupon / promo system (§8, §2.10)

**Goal:** Server-side validation and Stripe application; homepage + signup.

**Includes:**

- `coupons` (or equivalent) table: code, type (percent / fixed / bonus minutes), Stripe coupon ID or internal rules.
- Validate on register and apply to Checkout.
- All listed codes: LAUNCH50, BUDDY30, FIRSTCALL, BRASH3D, AI2025 (per spec §8.2).
- Homepage section: success/error messages per spec (green/red); optional “open signup” behavior.
- Audit: `couponUsed` on `User` (already in schema).

**Acceptance:**

- Invalid codes rejected; valid codes change Stripe checkout or allocated minutes per definition.

---

## Phase 6 — Dashboard & user APIs (§5, §14.2)

**Goal:** Dashboard matches spec data, not placeholders.

**Includes:**

- `GET/PUT /user/profile` enhancements if missing fields (language, next billing from Stripe).
- `GET /user/time-balance` — already present; add **progress bar** UX (cyan / amber / red thresholds §5.3).
- `GET /user/calls` — pagination, “load more”; columns per spec (date, duration, called number, status, transcript link).
- `GET /user/transcripts` — list with `call_id` + email destination.
- `POST /user/add-number`, `DELETE /user/remove-number/:id` with plan slot checks.
- Platform UI: implement **Call History**, **Phone Numbers**, **Transcripts** pages (replace placeholders) using APIs.

**Acceptance:**

- Logged-in user sees real data and actions allowed by plan.

---

## Phase 7 — Affiliate program (§9, §14.x)

**Goal:** Track referrals, recurring commissions, affiliate-facing dashboard.

**Includes:**

- Tables: `affiliates`, `affiliate_clicks`, `affiliate_commissions` (or merged model), unique `affiliate_code`.
- Links: `buddycallai.com/ref/{code}` — middleware sets **90-day** cookie.
- On paid conversion: create commission rows (5% / 7% / 9% per plan).
- Monthly payout job (cron or documented manual export for MVP): threshold **$20**, PayPal/bank per spec.
- Frontend: `/app/affiliate` (and optional public `/affiliates`) with stats — clicks, conversions, pending/paid.
- Self-referral detection rule (spec §9.2).

**Acceptance:**

- Test referral path attributes subscription to affiliate; totals match formula.

---

## Phase 8 — SMS low-time alerts (§7)

**Goal:** Warn at 5 min, 2 min, expiry; recharge confirmation SMS.

**Includes:**

- Twilio Messaging API; store `sms_log`; respect **STOP** / opt-out.
- Use `alert5minSent`, `alert2minSent` on `User` (schema already has flags).
- **Integration note:** Spec ties alerts to **seconds remaining during live calls**. That requires the **voice pipeline** to decrement balance or emit events to the platform API. Phase 8 must define the **integration contract** (HTTP callback from core server, or shared DB, or queue) — see open questions.

**Acceptance:**

- In staging, triggering thresholds sends SMS; duplicates suppressed by flags.

---

## Phase 9 — SEO, schema.org, analytics (§12)

**Goal:** Full metadata and structured data as specified.

**Includes:**

- Complete **8 schema types** (Organization, WebSite, WebPage, SoftwareApplication, Service, HowTo, FAQPage, Affiliate WebPage/Service) — validate in Rich Results.
- `og-image` asset (1200×630) in `frontend/public`.
- Optional: GA4 with consent banner if spec requires analytics cookies.
- Sitemap / `robots.txt` if not present.

**Acceptance:**

- Linted JSON-LD; no duplicate invalid meta tags.

---

## Phase 10 — Infrastructure & deployment (§11, §17)

**Goal:** Production checklist: AWS (or chosen host), secrets, TLS, monitoring.

**Includes:**

- Document env matrix (Secrets Manager vs `.env` per environment).
- RDS, Redis (if used for rate limits/sessions), SES, WAF — as applicable.
- CI: build `frontend` + `backend`, migrate Prisma, smoke tests.
- Runbook: Stripe webhook URL, Twilio callbacks, CORS origins.

**Acceptance:**

- One documented path from “git push” to “live API + static site”.

---

## Dependency graph (short)

```
1 Legal → 2 Auth → 3 Locale/Country
                    ↓
              4 Stripe ──→ 5 Coupons
                    ↓
              6 Dashboard/APIs
                    ↓
         7 Affiliate (needs 4 for conversions)
                    ↓
         8 SMS (needs balance integration + 4/6)
                    ↓
         9 SEO (can partially parallelize after 1)
                    ↓
         10 Deploy (last)
```

---

## Open questions — **please answer before Phase 1**

Reply with numbers (e.g. `1a, 2b, …`).

1. **Legal UI:**  
   - (a) Dedicated routes only (`/privacy`, `/terms`)  
   - (b) Modals only (large scrollable)  
   - (c) Both routes + “quick view” modal  

2. **Auth UX:**  
   - (a) Keep current `/login` and `/register` pages  
   - (b) Rebuild landing **modal** auth like the reference HTML  

3. **Stripe:**  
   - (a) Implement everything in **test mode** first; production keys later  
   - (b) You already have live keys and want production-ready from day one  

4. **Affiliate payouts (MVP):**  
   - (a) Manual (export CSV / admin) until volume justifies automation  
   - (b) PayPal Payouts API  
   - (c) Stripe Connect  

5. **SMS / balance integration:**  
   - (a) Phase 8 only after we define a **minimal API** on the voice server (you approve a small additive change) to report usage  
   - (b) SMS only from **platform cron** checking DB `secondsRemaining` (no live call tie-in for v1)  
   - (c) Defer SMS to last; focus billing/dashboard first  

6. **Spanish URLs:**  
   - (a) Add `/es` (and `/ca` if needed) as real routes with same SPA  
   - (b) Client-only language toggle; URLs stay `/`  

7. **Email for auth:**  
   - (a) AWS SES from day one (you’ll provide verified domain)  
   - (b) Dev: log reset links to console; prod: SES later  

8. **Deployment target for Phase 10:**  
   - (a) AWS per spec  
   - (b) Hybrid (e.g. Vercel frontend + API on VPS/Railway)  
   - (c) Undecided — document options only in Phase 10  

---

## After you answer

We implement **Phase 1 only**, verify acceptance criteria, then repeat for Phase 2, etc. If any phase exposes new dependencies, this document can be amended with a short addendum.
