# BuddyCallAI — Pre-Launch Audit Phases (Code)

**Source audits:** Pre-Launch QA/QC (July 24, 2026) + QA & SEO Re-Check (July 24, 2026)  
**Site:** https://buddycallai.com / https://www.buddycallai.com  
**Last updated:** 2026-07-25 (Phases A–G + follow-up polish)

Use Status: `TODO` · `IN PROGRESS` · `DONE` · `N/A` · `ALREADY DONE`

---

## Overall phase map

| Phase | Title | Priority | Status |
|-------|-------|----------|--------|
| **A** | Hero + How It Works copy | P0 | `DONE` |
| **B** | Affiliate calculator math | P1 | `DONE` |
| **C** | Coupons + Contact (client) | P1 | `DONE` (deployed per owner) |
| **D** | Call recording disclosure | P1 | `DONE` |
| **E** | Phone links + Play Voice | P2 | `DONE` |
| **F** | SEO polish | P2 | `DONE` |
| **G** | Footer / nav polish | P3 | `DONE` |

---

## Phase A — Hero + How It Works copy — `DONE`

| ID | Task | Status | Notes |
|----|------|--------|-------|
| A1 | Hero spacing (Intelligence as / Calling a) | `DONE` | Added `{" "}` between hero spans in `LandingContent.jsx` |
| A2 | How It Works → BuddyCallAI | `DONE` | EN + ES step2/step3 in `LandingLangContext.jsx` |
| A3 | Brash3D capitalization | `DONE` | Legal, footer, schema, Contact, landing copy |
| A4 | Worldwide tile vs USA/Canada | `DONE` | 2026-07-25 — feature tile + Coverage label aligned |
| A6 | Plan names → Silver / Gold / Platinum | `DONE` | 2026-07-25 — display names; IDs stay starter/pro/gold |

---

## Phase B — Affiliate calculator — `DONE`

| ID | Task | Status | Notes |
|----|------|--------|-------|
| B1–B2 | $20.30 / $243.60 at 10 Pro refs | `DONE` | Cent-safe math + 2 decimal display |

---

## Phase C — Coupons + Contact — `DONE`

Deployed earlier: no public Try: codes; no 661; no Bogotá.

---

## Phase D — Call recording disclosure — `DONE`

| ID | Task | Status | Notes |
|----|------|--------|-------|
| D1 | IVR greeting | `DONE` | `handlers/mediaStream.js` GREETING opens with AI/transcription notice |
| D2 | Privacy/Terms processors | `DONE` | Terms §3.3 two-party consent + Privacy AI processing |
| D3 | Site disclosure | `DONE` | Countries section + live Privacy Policy link |

---

## Phase E — Phone + Play Voice — `DONE`

| ID | Task | Status | Notes |
|----|------|--------|-------|
| E1 | `tel:` consistency | `DONE` | Hero toll line now `tel:+18665827524`; countries already had tel: |
| E2 | Play Voice binding | `DONE` | Confirmed: `/api/public/landing-demo-tts` + browser TTS fallback |

---

## Phase F — SEO polish — `DONE`

| ID | Task | Status | Notes |
|----|------|--------|-------|
| F1 | Short title | `DONE` | `BuddyCallAI — Talk to AI by Phone` |
| F2 | Short description | `DONE` | ~110 chars EN |
| F3 | Remove keywords | `DONE` | Dropped from `landingMetadata.js` + client `LandingHelmet.jsx` |
| F4 | robots + sitemap | `DONE` | `app/robots.js` + `app/sitemap.js` already present |
| F5 | Image alts | `DONE` | Steps, use-cases, robot, geography; no aria-hidden on informative imgs |
| F6 | Feature H3 | `DONE` | Feature + affiliate step cards use `h3` |

---

## Phase G — Footer — `DONE`

| ID | Task | Status | Notes |
|----|------|--------|-------|
| G1 | Fake Blog/Careers/About/Press | `DONE` | Company column → Contact, Status, Product, Affiliate |
| G2 | Legal links | `ALREADY DONE` | Privacy/Terms/Cookies/Contact |

---

## Still ops / manual (not code)

- Coolify `PLATFORM_API_URL` / `VOICE_API_URL` for health 500s  
- Stripe / Twilio prod + call all numbers + paid cycle  
- PageSpeed / real mobile devices  
- Deploy **this** batch (frontendnext + root voice `mediaStream.js`)

---

## Change log

| Date | Change |
|------|--------|
| 2026-07-25 | Created phased code plan |
| 2026-07-25 | Implemented Phases A–G |
| 2026-07-25 | Follow-up: Worldwide tile + phone/office consistency (removed CO WhatsApp) |
| | |
