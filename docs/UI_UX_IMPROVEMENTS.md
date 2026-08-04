# BuddyCallAI — UI/UX Improvement Phases (Non-Landing)

**Scope:** Public, auth, and authenticated (`/app/*`) pages only.  
**Out of scope:** Landing page (`/`, `/es`) — already aligned with client requirements.  
**Date:** 2026-07-25  
**Goal:** Make every other surface feel UX/UI-friendly, consistent, and mobile-ready.

Use this file to track work. Check Status to `DONE` as items land. Start at **Phase 1**.

---

## Status legend

| Status | Meaning |
|--------|---------|
| `TODO` | Not started |
| `IN PROGRESS` | Actively being worked |
| `DONE` | Fixed and verified |
| `N/A` | Intentionally skipped (note why) |

| Priority | Meaning |
|----------|---------|
| **High** | Hurts trust, usability, or mobile |
| **Medium** | Clear UX friction |
| **Low** | Nice-to-have consistency / fine detail |

---

## Overall progress

| Phase | Title | Focus | Status | Notes |
|-------|-------|-------|--------|-------|
| **1** | Foundations | Shared forms, focus, alerts, tokens, StatusBadge | `DONE` | 2026-07-25 — `ui-*` primitives + token aliases |
| **2** | Auth flows | Split layout, Login/Register, Forgot/Reset/Verify | `DONE` | 2026-07-25 — multi-step register + recovery UX |
| **3** | Public pages | Contact, Status, Legal, 404, Referral chrome | `DONE` | 2026-07-25 — constrained widths + honest status |
| **4** | Platform shell | Mobile drawer, nav, logout, loading chrome | `DONE` | 2026-07-25 — accessible drawer + boot screen |
| **5** | Platform core | Dashboard, Billing, Calls, Transcripts, Numbers | `DONE` | 2026-07-25 — fonts + loading/mobile/billing |
| **6** | Platform extras | Coupons, Affiliate, Settings polish | `DONE` | 2026-07-25 — copy feedback + settings UX |

**Suggested order:** Phase 1 → 2 → 3 → 4 → 5 → 6

---

## Phase 1 — Foundations

**Goal:** One shared form language + fixed tokens so later phases don’t reinvent styles.  
**Status:** `DONE` (2026-07-25)

### Approach (shipped)

| Layer | Decision |
|-------|----------|
| Tokens | `index.css` is the global source; `platform-shell.css` keeps product chrome (Syne + slightly different greens) but **aliases** `--danger`, `--text`, `--muted`, `--text1`, `--font-body` so both surfaces stay compatible |
| Forms | Shared `ui-*` CSS (`styles/forms.css`) + small React primitives in `components/ui/` — not a heavy design-system package |
| A11y | Focus rings, `role="alert"`, password toggle labels, required markers, pending `aria-busy` |
| Typography | Marketing/auth: Sora + DM Sans. Platform: Syne titles (intentional product vs marketing split) |

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| C1 | High | Duplicated `inputStyle` / `btnPrimary` across auth + Contact | Shared CSS/module with hover, focus, disabled, error | `DONE` |
| C2 | High | Errors/success are plain `<p>`; no field `aria-invalid` | `role="alert"` / `aria-live` + wire field errors | `DONE` |
| C3 | Medium | No password show/hide | Eye toggle component | `DONE` |
| C4 | Medium | Tiny muted labels; inconsistent required `*` | Stronger labels + consistent required markers | `DONE` |
| C5 | Low | Pending buttons — opacity only | Spinner + `aria-busy` | `DONE` |
| C6 | High | Platform vs global token clash (`Syne`/`Sora`, `--red`/`--danger`) | One token set + aliases | `DONE` |
| C7 | Medium | `.data-table`, `.skeleton`, `.card`, `.progress-*` unused | Document + start using in later phases | `DONE` |
| C9 | Low | `--text3` contrast likely weak | Lighten secondary text | `DONE` |
| SC1 | High | `StatusBadge` bg broken (`var(--green)1a`) | `color-mix` or rgba map | `DONE` |
| SC2 | Medium | `InfoBanner` dismiss a11y + alerts | `aria-label` + `role="alert"` | `DONE` |
| SC3 | Low | `SectionHeader` uses undefined `--text1` | Use real token | `DONE` |

**Phase 1 exit criteria**
- [x] Auth + Contact can use shared input/button classes (`FormField`, `PasswordInput`, `Button`, `FormAlert`)
- [x] Keyboard focus rings visible on dark UI (`.ui-input` / `.ui-btn` + platform `.form-input`)
- [x] `StatusBadge` chips show tinted backgrounds correctly (rgba map)
- [x] Token aliases prevent `--danger` / `--text2` breakage

---

## Phase 2 — Auth flows

**Goal:** Sign-in / sign-up / password / verify feel trustworthy on mobile and don’t leave dead ends.  
**Status:** `DONE` (2026-07-25)  
**Depends on:** Phase 1 (shared forms)

### 2A — Auth layout

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| A1 | High | `minmax(360px)` overflows small phones | `minmax(0, 1fr)` + padding | `DONE` |
| A2 | High | Aside image 150% + contain looks broken | Full-bleed `cover` | `DONE` |
| A3 | Medium | Mobile image panel ~360px tall | Hide or shrink below breakpoint | `DONE` |
| A4 | Medium | Suspense “Loading…” layout jump | Spinner matching auth column | `DONE` |

### 2B — Login

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| L1 | Medium | Resend verification hierarchy weak | Secondary style; submit stays primary | `DONE` |
| L2 | Medium | “Forgot password?” small tap target | Larger hit area | `DONE` |
| L3 | Low | Form max-width uneven in layout | Align widths | `DONE` |

### 2C — Register

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| R1 | High | Long single form (up to 6 lines) | Steps: Account → Plan → Lines → Confirm | `DONE` |
| R2 | High | Name/plan grids crush on mobile | Stack under ~480px | `DONE` |
| R3 | High | Password rules only in label | Hint + live checklist | `DONE` |
| R4 | Medium | Plan change silently changes line count | Explain extra/hidden lines | `DONE` |
| R5 | Medium | Plan buttons lack pressed/radio semantics | Radiogroup pattern | `DONE` |
| R6 | Medium | Legal checkbox error not highlighted | Highlight row on error | `DONE` |
| R7 | Low | Missing name autocomplete attrs | `given-name` / `family-name` | `DONE` |

### 2D — Forgot / Reset / Verify

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| F1 | High | Forgot success still shows form (spam resubmit) | Success panel + Back to sign in | `DONE` |
| F2 | Medium | Intro + back link compete | Separate secondary link | `DONE` |
| RP1 | High | Missing reset token = dead end | CTA to forgot-password + expired copy | `DONE` |
| RP2 | High | Success auto-redirect only | “Continue now” button | `DONE` |
| RP3 | Medium | Confirm mismatch only on submit | Inline match indicator | `DONE` |
| V1 | High | “Verifying…” styled green (looks like success) | Neutral + spinner | `DONE` |
| V2 | Medium | Verify failure has no resend | Resend / go to login | `DONE` |
| V3 | Medium | Missing token vs API failure identical | Distinct copy + actions | `DONE` |

**Phase 2 exit criteria**
- [x] Auth pages usable on ~360px width without horizontal scroll
- [x] Register stacks / steps cleanly on mobile
- [x] Forgot / Reset / Verify have clear success and recovery paths

---

## Phase 3 — Public pages

**Goal:** Contact, Status, Legal, 404, Referral feel like one product (not three shells).  
**Status:** `DONE` (2026-07-25)  
**Depends on:** Phase 1 forms (Contact)

**Layout rule applied:** form max ~480px, public content ~680px, auth split shell ~960px — never stretch inputs full-bleed.

### 3A — Shared public chrome

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| C8 | Medium | AppShell ≠ LegalLayout ≠ bare `/ref` | One public header/footer pattern | `DONE` |
| RF1 | High | Referral has no shell/footer | Wrap in public chrome | `DONE` |
| LG5 | Medium | Legal logo 62 vs AppShell 72 | Match brand size | `DONE` |
| S4 | Low | Status max-width 640 vs Contact 720 | Align content widths | `DONE` |

### 3B — Contact

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| CT1 | High | Form buried under locations + SLA table | Lead with WhatsApp + form | `DONE` |
| CT2 | High | Truncated emails (`billing@`, `legal@`) | Full addresses | `DONE` |
| CT3 | Medium | Emoji flags as primary visual | Country text / SVG | `DONE` |
| CT4 | Medium | Success only clears message | Clear form or success panel | `DONE` |
| CT5 | Medium | No min-20 char counter | Live counter | `DONE` |
| CT6 | Medium | WhatsApp is plain text link | Button-style CTA | `DONE` |
| CT7 | Low | Bottom legal notices duplicate footer | Shorten or remove | `DONE` |

### 3C — Status

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| S1 | High | Website always hard-coded operational | Real probe or honest label | `DONE` |
| S2 | Medium | No refresh / poll | Refresh button or interval | `DONE` |
| S3 | Medium | Rows squeeze on narrow screens | Stack on mobile | `DONE` |

### 3D — Legal

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| LG1 | High | No active nav among Privacy/Terms/Cookies | Active link style | `DONE` |
| LG2 | High | Double footer top border | One border only | `DONE` |
| LG3 | High | Long policies — no TOC | Jump links from headings | `DONE` |
| LG4 | Medium | Sticky nav wraps heavily on mobile | Compact / overflow menu | `DONE` |
| LG6 | Low | No skip to content | Skip link | `DONE` |

### 3E — 404 & Referral

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| N1 | High | Dead `views/NotFoundPage.jsx` (react-router) | Delete or migrate | `DONE` |
| N2 | Medium | 404 only “Back to homepage” | Add Contact + Sign in | `DONE` |
| N3 | Low | 404 CTA missing focus style | `:focus-visible` | `DONE` |
| RF2 | High | Referral error is a dead end | Continue to register / Contact | `DONE` |
| RF3 | Medium | Referral loading — no spinner | Spinner + height | `DONE` |
| RF4 | Low | H1 “Referral link” is developer-facing | “Applying your invite…” | `DONE` |

**Phase 3 exit criteria**
- [x] Contact leads with help actions + working form
- [x] Status doesn’t falsely claim website always up
- [x] Legal nav shows active page; no double footer border
- [x] Referral + 404 match public chrome and have recovery CTAs

---

## Phase 4 — Platform shell

**Goal:** `/app` navigation feels solid on mobile and matches product polish.  
**Status:** `DONE` (2026-07-25)  
**Depends on:** Phase 1 tokens / StatusBadge

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| P1 | High | Mobile drawer: no Escape, weak ARIA, no close | `aria-expanded`, Escape, close btn, focus trap | `DONE` |
| P2 | Medium | Auth gate uses marketing AppShell flash | Platform-styled spinner | `DONE` |
| P3 | Medium | Logout `⎋` unclear + tiny tap target | “Sign out” or larger control | `DONE` |
| P4 | Medium | Logo → marketing `/` | Link to `/app/dashboard` | `DONE` |
| P5 | Medium | Rainbow nav icons vs active cyan | Muted icons; accent when active | `DONE` |
| P6 | Medium | No mobile page title when drawer closed | Top bar with section name | `DONE` |
| P7 | Low | User pill raw plan/status | `StatusBadge` for urgency | `DONE` |

**Phase 4 exit criteria**
- [x] Mobile menu open/close is accessible (Escape, ARIA, close)
- [x] Logo and logout behave as users expect in-app
- [x] Loading into `/app` doesn’t flash marketing chrome

---

## Phase 5 — Platform core pages

**Goal:** Dashboard, Billing, Calls, Transcripts, Numbers — clear loading, CTAs, mobile tables.  
**Status:** `DONE` (2026-07-25)  
**Depends on:** Phase 4 shell + Phase 1 skeletons/tokens

**Typography (inner pages):** Main content uses **Sora** for titles/values and **DM Sans** for body/labels/tables. Sidebar keeps Syne.

### 5A — Dashboard

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| D1 | High | Stats show `"—"` while loading | Skeleton cards | `DONE` |
| D2 | Medium | Empty states with no CTA | Links to Numbers / Billing | `DONE` |
| D3 | Medium | Custom progress bar | Reuse `.progress-*` | `DONE` |
| D4 | Low | Plan casing inconsistent | Shared plan label helper | `DONE` |

### 5B — Billing

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| B1 | High | No “Current plan” state on CTAs | Badge / disable current | `DONE` |
| B2 | High | One global `pending` freezes page | Per-action pending | `DONE` |
| B3 | High | Cancel — no confirm | Confirm dialog | `DONE` |
| B4 | Medium | Dual cancel paths confuse | One primary path | `DONE` |
| B5 | Medium | Promo/recharge lack labels | Visible labels | `DONE` |
| B6 | Medium | Invoice error looks like empty | Error banner | `DONE` |
| B7 | Medium | History table not mobile-friendly | Cards / priority cols | `DONE` |

### 5C — Call History & Transcripts

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| CH1 | High | Empty table flash while loading | Skeleton / Loading block | `DONE` |
| CH2 | High | Wide tables painful on mobile | Stacked cards | `DONE` |
| CH3 | Medium | “View” is mailto — misleading | Rename to Email / Open mail | `DONE` |
| CH4 | Medium | Transcripts vs Calls unclear | Clarify subtitle / columns | `DONE` |
| CH5 | Medium | Sent as Yes/No text | `StatusBadge` | `DONE` |
| CH6 | Low | Load more + no “Showing X of Y” | Align + counts | `DONE` |

### 5D — Phone Numbers

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| PN1 | High | “Upgrade in Billing” not a link | `Link` to `/app/billing` | `DONE` |
| PN2 | Medium | Add form uses `auth-card` | Platform `.card` | `DONE` |
| PN3 | Medium | Last line — silent no-remove | Helper text | `DONE` |
| PN4 | Medium | Phone format unclear | Example under field | `DONE` |
| PN5 | Low | `window.confirm` for remove | In-app confirm | `DONE` |

**Phase 5 exit criteria**
- [x] No empty-table flash on Calls/Transcripts/Dashboard
- [x] Billing shows current plan + safe cancel confirm
- [x] Tables usable on mobile (cards or priority columns)
- [x] Phone limit upgrade is a real link

---

## Phase 6 — Platform extras

**Goal:** Coupons, Affiliate, Settings — copy feedback and polish.  
**Status:** `DONE` (2026-07-25)  
**Depends on:** Phase 5 patterns (toasts, cards, badges)

### 6A — Coupons

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| CP1 | Medium | “Server env” / Stripe internals in copy | Customer-friendly wording | `DONE` |
| CP2 | Medium | Codes not copyable | Tap-to-copy + toast | `DONE` |
| CP3 | Medium | No apply path when pending payment | “Apply on Billing” button | `DONE` |
| CP4 | Low | Success green hex ≠ token | Use `--green` | `DONE` |

### 6B — Affiliate

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| AF1 | High | Copy link — no feedback | Toast + clipboard fallback | `DONE` |
| AF2 | Medium | Connect field placeholder-only | Label + help text | `DONE` |
| AF3 | Medium | Code not separately copyable | Copy code chip | `DONE` |
| AF4 | Medium | Loading layout jump | Skeleton stats/table | `DONE` |
| AF5 | Low | Dense payout eligibility copy | Status chip | `DONE` |

### 6C — Account Settings

| ID | Priority | Item | Suggested fix | Status |
|----|----------|------|---------------|--------|
| AS1 | Medium | Profile uses `auth-card` | Platform `.card` | `DONE` |
| AS2 | Medium | Raw `pending_payment` status | Human label + badge | `DONE` |
| AS3 | Medium | Name row crushes on phone | Stack under 768px | `DONE` |
| AS4 | Medium | Email only in subtitle | Read-only email field | `DONE` |
| AS5 | Low | Language — no helper | Short helper text | `DONE` |
| AS6 | Low | Save always enabled | Dirty-state disable | `DONE` |

**Phase 6 exit criteria**
- [x] Copy actions always give feedback
- [x] Settings/Coupons/Affiliate match platform card language
- [x] No leftover “developer” copy in customer UI

---

## Pages covered

| Route | Phase(s) |
|-------|----------|
| Shared forms / tokens / badges | 1 |
| `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email` | 2 |
| `/contact`, `/status`, legal, 404, `/ref/[code]` | 3 |
| `/app` shell / nav | 4 |
| `/app/dashboard`, `/billing`, `/calls`, `/transcripts`, `/numbers` | 5 |
| `/app/coupons`, `/affiliate`, `/settings` | 6 |
| `/`, `/es` landing | **Skipped** |

---

## Notes

- Prefer existing utilities (`.skeleton`, `.data-table`, `.card`, `.progress-*`) over new one-offs.
- Keep dark surfaces + cyan accents; don’t invent a second look inside `/app`.
- When a phase is finished, set its Overall progress row to `DONE`, then start the next.
- Say **“start Phase 1”** when ready to implement.
