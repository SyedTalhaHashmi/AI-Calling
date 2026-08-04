# BuddyCallAI — QA Launch Phases

**Source:** Quality Assurance Report (July 24, 2026) + codebase audit of `frontendnext/`, `backend/`, and root voice server.  
**Site:** https://www.buddycallai.com  
**Last updated:** 2026-07-25 (live re-verify vs QA re-test)

Use this file to track launch readiness. Check boxes as work lands; update the **Status** column and **Notes** when something changes.

---

## Status legend

| Status | Meaning |
|--------|---------|
| `TODO` | Not started |
| `IN PROGRESS` | Actively being worked |
| `BLOCKED` | Waiting on decision, env, or external dependency |
| `DONE` | Complete and verified |
| `N/A` | Intentionally skipped (document why in Notes) |

---

## Product decisions (locked 2026-07-24)

| ID | Decision | Choice | Status |
|----|----------|--------|--------|
| A | Plan names | **Starter / Pro / Gold** (align homepage to backend + Terms) | `DONE` |
| B | Coverage copy | **Works worldwide** — call from anywhere; dedicated numbers live in USA & Canada | `DONE` |
| C | Public coupon chips | **Removed** from homepage (codes still work if entered privately) | `DONE` |
| D | Contact number `+1 661 422 6105` | **Removed** from Contact (AI numbers stay on homepage Countries) | `DONE` |
| E | Bogotá office | **Removed** from Contact; keep Orlando HQ + Toronto only | `DONE` |

---

## Overall progress

| Phase | Title | Status | Owner | Notes |
|-------|-------|--------|-------|-------|
| 1 | Revenue unblock (register smoke) | `DONE` | | Live re-verified 2026-07-25: `/register` form renders |
| 2 | Content consistency | `DONE` | | Live: Starter/Pro/Gold + worldwide copy |
| 3 | Legal / ops surfaces | `DONE` | | `/status` live in register footer |
| 4 | Paid + telephony smoke | `IN PROGRESS` | | Code gaps fixed; ops/manual smoke remains |
| 5 | Polish & launch gate | `TODO` | | 5.4 README number fixed early |

**Suggested order:** Phase 1 → 2 → 3 → 4 → 5

---

## Phase 1 — Revenue unblock (smoke + register)

**Goal:** Confirm signup is not broken before anything else.

| # | Task | Location | Status | Notes |
|---|------|----------|--------|-------|
| 1.1 | Browser smoke `/register` — form renders (not stuck on “Loading…”) | Live | `DONE` | Confirmed in browser automation + **manual UI by owner** (includes plan selection). |
| 1.2 | Confirm `POST /api/v1/auth/register` | Live rewrite + `backend/` | `DONE` | Owner confirmed register works from UI. Earlier probe saw `/api/v1/*` 500 — keep Coolify `PLATFORM_API_URL` checklist below if regressions appear. |
| 1.3 | Fix register if stuck (Suspense / hydrate) | `frontendnext/src/app/register/` | `N/A` | Not needed — form hydrates correctly |

**Exit criteria:** Register works in a real browser **and** can reach a healthy register API.

- [x] Form renders in real browser (1.1)
- [x] Register works via manual UI (1.2) — owner confirmed
- [ ] Optional: confirm Coolify `PLATFORM_API_URL` if API 500 returns

### Phase 1 blocker — ops checklist

Next.js same-origin rewrites (`frontendnext/next.config.mjs`):

- `/api/v1/:path*` → `${PLATFORM_API_URL}/api/v1/:path*`
- `/api/public/:path*` → `${VOICE_API_URL}/api/public/:path*`

On the **frontend Coolify** service, confirm runtime env:

1. `PLATFORM_API_URL` = reachable platform API base (e.g. `http://<backend-service>:4000` or public HTTPS API URL) — **not** left defaulting to `http://127.0.0.1:4000` inside the Next container
2. `VOICE_API_URL` = reachable voice server base
3. Backend is up: `GET <PLATFORM_API_URL>/health` returns OK
4. Backend `FRONTEND_ORIGIN` includes `https://www.buddycallai.com`
5. Re-test: `POST https://www.buddycallai.com/api/v1/auth/register` with invalid body should return **400** (validation), not **500**

---

## Phase 2 — Content consistency (QA FAILs)

**Goal:** One consistent story across homepage, Terms, Contact, and schema.

| # | Task | Location | Status | Notes |
|---|------|----------|--------|-------|
| 2.1 | Unify plan names (Decision A) | Landing copy, affiliates, register UI, pricing links | `DONE` | Homepage + affiliates + register now **Starter / Pro / Gold**. Pricing CTAs → `/register?plan=…` |
| 2.2 | Fix coverage contradiction (Decision B) | Landing EN/ES, SEO, schema, Terms §3.1 | `DONE` | **Worldwide** calling; dedicated numbers still listed for USA & Canada; signup remains US/CA in `countries.js` + backend |
| 2.3 | Reconcile phone lists (Decision D) | `ContactPage.jsx` | `DONE` | Removed `+1 661 422 6105` from Contact (client requirement) |
| 2.4 | Align office disclosure (Decision E) | Contact | `DONE` | Removed Bogotá; Orlando + Toronto only |

**Exit criteria:** QA §3 Content consistency → all PASS.

- [x] Exit criteria met (content aligned; deploy `frontendnext` to go live)

---

## Phase 3 — Legal / ops surfaces

**Goal:** Close Terms gaps and make contact reliable.

| # | Task | Location | Status | Notes |
|---|------|----------|--------|-------|
| 3.1 | Add `/status` **or** remove Terms link | `app/status/`, `StatusPage.jsx`, sitemap, footers | `DONE` | Live health checks for website / platform API / voice; Terms §4 link now resolves |
| 3.2 | Contact form notify email | `backend` `contact.js` + `mail.js` | `DONE` | Emails `CONTACT_NOTIFY_EMAIL` (default `support@buddycallai.com`); DB save still succeeds if mail fails |
| 3.3 | Align Privacy security claims with reality | `legal/privacy.md` | `DONE` | Softened AES-256 / column encrypt / MFA claims; §9 aligned with worldwide calling |
| 3.4 | Coupon visibility (Decision C) | Homepage | `DONE` | Public “Try:” code chips **removed** (client requirement); coupon input kept |

**Exit criteria:** Legal cross-links valid; contact delivers; Privacy claims honest.

- [x] Exit criteria met (deploy frontendnext + backend for live)

---

## Phase 4 — Paid + telephony smoke (manual + env)

**Goal:** Prove money path and AI numbers before sending traffic.

### Code prep (done 2026-07-25)

| Fix | Status | Notes |
|-----|--------|-------|
| Recharge confirmation SMS | `DONE` | Sent after Stripe recharge credit; soft idempotent via `SmsLog.providerSid = session.id` |
| FIRSTCALL bonus wipe on `invoice.paid` | `DONE` | `subscription_create` no longer overwrites checkout pool |
| Low-balance threshold jump | `DONE` | Marks both 5-min and 2-min flags; SMS sends most urgent only |
| Checkout / reset link origin | `DONE` | Uses `PUBLIC_WEB_URL` / `appPublicUrl` (not `FRONTEND_ORIGIN[0]`) |
| Stale README number | `DONE` | Was +1 833… → +1 (866) 582-7524 |

**Known limitation:** 5-min / 2-min SMS fire on **call-end usage report** (and optional `/sms-reconcile`), not mid-call ticks.

### Ops / manual tasks

| # | Task | Owner | Status | Notes |
|---|------|-------|--------|-------|
| 4.1 | Prod Stripe keys + webhook | Ops | `TODO` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; events per runbook §5. Local `backend/.env` currently has **no** Stripe keys. |
| 4.2 | Prod Twilio voice + SMS env | Ops | `TODO` | Platform needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM`. Root voice already has Twilio voice vars. |
| 4.3 | Point all marketed numbers at voice app | Twilio console | `TODO` | Voice webhooks → same voice app for: 866 (toll-free), 320, 414 (ES), 581 (CA). Support 661 stays support-only. |
| 4.4 | Full cycle: register → pay → call → minutes drop | Manual | `TODO` | |
| 4.5 | Confirm 5-min / 2-min low-balance SMS | Manual | `TODO` | Expect at call end when balance crosses thresholds |
| 4.6 | Forgot-password email + contact inbox | Manual | `TODO` | SMTP already set in local backend; confirm prod + `CONTACT_NOTIFY_EMAIL` |

### Phase 4 smoke checklist (run after deploy)

- [ ] `GET /status` shows platform + voice healthy (or known outage)
- [ ] Register → Stripe Checkout completes → `/app/billing` shows active + minutes
- [ ] FIRSTCALL (if used) minutes = plan pool + bonus (not wiped)
- [ ] Call a marketed number → AI answers → hang up → `secondsRemaining` drops
- [ ] Drive balance under 5 min then under 2 min → SMS received (STOP works)
- [ ] Recharge minutes → balance up + recharge SMS
- [ ] Forgot-password email arrives; contact form reaches support inbox

**Exit criteria:** Core product launch checklist PASS (or known limitations documented).

- [ ] Exit criteria met

---

## Phase 5 — Polish & launch gate

| # | Task | Status | Notes |
|---|------|--------|-------|
| 5.1 | Mobile (iOS Safari, Android Chrome) + one older desktop | `TODO` | |
| 5.2 | PageSpeed Insights baseline | `TODO` | Critical fixes only |
| 5.3 | Quick a11y pass (alt text / axe) | `TODO` | |
| 5.4 | Fix stale docs (e.g. old README number if present) | `DONE` | README demo number updated to 866 toll-free |

**Exit criteria:** Ready to send traffic.

- [ ] Exit criteria met

---

## Already done in code (reference)

These were flagged or untested in QA but are implemented in repo — still need live smoke where noted.

| Item | Status in code | Live verify? |
|------|----------------|--------------|
| `/register` page + form | Done (Suspense “Loading…” is fallback only) | Yes — Phase 1 |
| `/forgot-password` + `/reset-password` | Done | Yes — Phase 4.6 |
| `/app/billing` | Done (auth-gated) | Yes — Phase 4.4 |
| Terms / Privacy / Cookies | Done | Optional re-read after Phase 2–3 edits |
| SEO / metadata | Done | Optional |
| Coupon validate + seed (5 codes) | Done | Yes — with checkout |
| Register / billing / usage APIs | Done | Yes — Phase 4 |
| bcrypt 12 salt rounds | Done | N/A |

---

## Change log

| Date | Change |
|------|--------|
| 2026-07-24 | Created from QA report + codebase audit; phases 1–5 defined |
| 2026-07-24 | Locked decisions A–E (recommended defaults) |
| 2026-07-24 | Phase 1.1 DONE (live register form OK); 1.2 BLOCKED (prod `/api/v1/*` → 500); 1.3 N/A |
| 2026-07-24 | Decision B flipped to **worldwide**; Phase 1 marked DONE after owner manual UI confirm |
| 2026-07-24 | Phase 2 DONE: Starter/Pro/Gold, worldwide copy, support-line label, register `?plan=` |
| 2026-07-24 | Phase 3 DONE: `/status` page, contact notify email, Privacy §7/§9 honesty pass, coupons kept |
| 2026-07-25 | Phase 4 code prep: recharge SMS, FIRSTCALL fix, SMS threshold flags, `appPublicUrl`, README number; ops smoke checklist added |
| 2026-07-25 | QA re-test rebuttal: live crawl shows register OK, Starter/Pro/Gold, worldwide copy |
| 2026-07-25 | Client requirement: removed public coupon chips, Contact +1 661, and Bogotá office |
| | |

---

## QA Re-Test rebuttal (July 24 follow-up) — verified live 2026-07-25

Automated re-test claimed “none of the five items fixed.” **Live browser check of www.buddycallai.com shows otherwise.**

| Re-test claim | Live status | Notes |
|---------------|-------------|-------|
| `/register` only “Loading…” | **FIXED / false alarm** | Form renders (multi-step: Account → Plan → Lines → Confirm). Crawlers without JS often see Suspense fallback only. |
| Plan names Silver/Gold/Platinum | **FIXED** | Homepage pricing + affiliate table use **Starter / Pro / Gold** |
| “Works Worldwide” vs USA/Canada body | **FIXED** | Tile body: “Call from anywhere in the world…”; countries section: dial worldwide, local numbers USA & Canada |
| Public coupon codes | **FIXED** | Removed public “Try:” codes from homepage |
| Contact `+1 661…` + Bogotá | **FIXED** | 661 and Bogotá removed; Orlando + Toronto only |

**Still open (manual/ops only):** phone-call smoke, paid cycle, SMS, mobile/perf — unchanged from Phase 4 checklist.
