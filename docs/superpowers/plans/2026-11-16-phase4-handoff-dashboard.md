# Phase 4: Voice hand-off, tool limits, customer dashboard, call summaries

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every call's transcript, language and AI cost reach the backend reliably; live tools obey each plan's monthly limits; customers see usage, limits, calls, transcripts and summaries in the new dashboard; Plus and Family Premium calls get a written summary.

**Architecture:** The voice server keeps its pipeline and gains two small things: a call-end report (through the existing durable outbox) and a tool gate in front of every paid lookup. The backend owns the rules: a reserve/release endpoint with an atomic per-period counter, encrypted transcript storage, and a worker job that writes summaries (Gemini free tier, Grok fallback). The frontend dashboard reads two new user endpoints.

**Tech stack:** Express 4 + Prisma 5 + Postgres (backend), Node voice server, Next.js 16 / React 19 (frontendnext).

**Spec:** `BuddyCallAI_Developer_Package/.../BuddyCallAI_FINAL_Plans_and_Prices latest.docx` §2, §2.1; `BuddyCallAI_FINAL_APIs_to_Integrate latest.docx` §6; scope memory `nov-2026-rebuild-scope`.

## Global Constraints

- Limits come from `Plan.limits` (`research, weather, flights, hotels, maps, reminders`). Pay As You Go and Basic have no live tools. Reminders are phase 5.
- "When a limit is reached, the tool stops until the next monthly reset. Buddy explains this and offers an upgrade. No paid API is called."
- "Permission first: check subscription, plan and monthly limit, and reserve one unit, before calling any paid API. Release the unit if the provider fails."
- "Costs: log the cost of every call and request per customer and plan."
- Summaries: Plus/Family only (`features.summaries`), Gemini free tier, Grok fallback. Never OpenAI. No live AI calls in tests.
- Voice system unchanged apart from the hand-off and the gate. No SMS.
- Never run anything against `backend/.env`'s DATABASE_URL (production). E2E on throwaway Docker Postgres.
- Every report from the voice server is idempotent by call id and goes through the outbox.

## Review Focus

1. Two tool calls at once on one account at the last unit: only one gets it (atomic counter).
2. The backend is down mid-call: a plan that includes the tool still answers (fail-open), and the use is counted later through the outbox.
3. A call-end report arrives twice, or before/without call-start: one session, transcript stored once, summary queued once.
4. A summary provider times out or returns garbage: retried with a cap, never blocks other summaries, two workers never summarize one call.
5. A customer can only see and resend their own calls; resend is rate-limited.

---

### Task 1: Backend schema and tool limits

**Files:** `backend/prisma/schema.prisma`, migration `20261116130000_call_handoff`, `backend/src/lib/toolLimits.js`, `backend/src/routes/integrations.js`, `backend/src/lib/callerEligibility.js`, test `backend/test/toolLimits.test.js`.

**Produces:**
- `ToolCounter { id = "<userId>:<tool>:<windowKey>", userId, tool, windowKey, count }`, `ToolUse { id (idempotency key), userId, callSid?, tool, toolName?, windowKey, status: reserved|denied|released, createdAt }`.
- `CallSession` gains `language, transcriptEnc (Text), costUsd (Float), summaryStatus, summaryEnc (Text), summaryAttempts, summaryClaimedAt, summaryProvider, transcriptResentAt`, index on `twilioCallSid`.
- `toolAccessFor(user, plan) -> { mode: "unlimited"|"limited"|"none", limits, windowKey, resetsAt }` — legacy plans unlimited (ruling), trial/test/no user none/unlimited as below.
- `POST /api/v1/integrations/voice/tool-use` body `{ userId, key, tool, toolName?, callSid?, action: "reserve"|"release"|"record" }` → `{ allowed, reason?: "not_in_plan"|"limit_reached", limit?, used?, resetsAt? }`.
- caller-check answers carry `tools: { mode, limits }`.

Tests: reserve under limit allowed; at limit denied with reason and resetsAt; same key twice = one unit; 10 simultaneous reserves at limit 3 → exactly 3 allowed; release gives the unit back once; record (fail-open report) counts even past the limit, once; Basic → not_in_plan; legacy plan → unlimited; new period → fresh count.

### Task 2: Backend call-end hand-off

**Files:** `backend/src/lib/transcriptCrypto.js`, `backend/src/routes/integrations.js`, test `backend/test/callHandoff.test.js`.

- `encryptText(s)` / `decryptText(s)`: AES-256-GCM, key from `TRANSCRIPT_ENCRYPTION_KEY` (32-byte base64/hex) or, if unset, HKDF from `JWT_SECRET`; stored as `v1:<keyId>:<iv>:<tag>:<ct>`.
- `/voice/call-end` accepts `{ callSid, userId?, callerNumber?, calledNumber?, status, durationSeconds, transcriptSent, transcript: string[], language?, costUsd? }`; finds the session by callSid, creates it when call-start never arrived and the user is known; stores the transcript encrypted (capped 200 KB); sets `summaryStatus = "pending"` only once, only when the plan has `features.summaries` and the caller spoke.

Tests: transcript stored encrypted and decrypts; repeat report is one session and keeps summary state; no call-start → session created; Basic → no summary; trial caller without account → 200 no-op.

### Task 3: Summaries job

**Files:** `backend/src/lib/summaries.js`, `backend/src/jobs/billingJobs.js` (register), `backend/src/config.js`, test `backend/test/summaries.test.js`.

- `summarizeTranscript(text, { fetchImpl }) -> { text, provider }`: Gemini `generateContent` (`GEMINI_API_KEY`, `GEMINI_MODEL`, default `gemini-2.5-flash`), Grok `chat/completions` (`XAI_API_KEY`, `XAI_MODEL`, default `grok-3-mini`) on failure; 20 s timeout each.
- `runSummaries({ limit = 10 })`: claim rows `summaryStatus in (pending, working-stale>5min)` one by one with a conditional update; on success `done`; on failure attempts+1, `failed` after 3.

Tests: Gemini answer stored; Gemini fails → Grok; both fail → retried then failed at 3; no keys → stays pending (nothing to do); two runners never take one row.

### Task 4: Customer dashboard API

**Files:** `backend/src/routes/user.js`, test `backend/test/dashboardApi.test.js`.

- `GET /user/overview` → minutes (included, used, left, prepaid, period end), tool limits with used counts, features, recent 5 calls.
- `GET /user/calls?cursor&limit` (existing, extended with summary/transcript flags), `GET /user/calls/:id` → transcript lines + summary (decrypted), only for the owner.
- `POST /user/calls/:id/resend-transcript` → emails the transcript to the line's transcript email; 1 per call per 5 minutes (409 otherwise).

Tests: owner sees own call, another user's call is 404; resend sends one mail then 409 inside 5 min; overview counts tools for the current period.

### Task 5: Voice server hand-off and tool gate

**Files:** `services/platformApi.js`, `services/toolGate.js`, `routes/calls.js`, `handlers/mediaStream.js`, tests `test/toolGate.test.js`, `test/callReports.test.js`.

- Call-end report through the outbox (`callend:<callSid>`), with transcript lines, `replyLanguage`, and the AI cost from `estimateCost` on the session's usage.
- `toolLimitKey(name, args)`: weather→weather; find_places hotel→hotels, food/local_service→maps; flights fare/status→flights; web_search/news/sports/crypto/stocks/rates/fx→research; time→null (free).
- `createToolGate({ platformApi, session })` → `check(key, toolName) -> { ok, say?, release() }`; unlimited/disabled → ok; none/0 → say "not in plan"; limited → reserve (1.5 s timeout), fail-open with a `toolrecord:` outbox report.
- Tools mode: `runToolCalls` guard; regex mode: one gate before the intent branches; release on provider failure.

### Task 6: Frontend dashboard

**Files:** `frontendnext/src/views/platform/PlatformDashboardPage.jsx`, `PlatformCallHistoryPage.jsx`, new `PlatformCallDetailPage.jsx` + route `app/app/calls/[id]/page.js`, `/app/transcripts` → redirect to `/app/calls`, `src/utils/dashboardView.js` + test.

Dashboard: minutes bar (80%/100% colours), tool-limit bars (plans with tools), upgrade prompt for plans without tools, recent calls with summary snippet. Calls page: list with duration, language, summary snippet; detail with transcript, summary, resend button.

### Task 7: Verify and review

Full suites (backend, frontend, voice), lint, build; E2E on Docker Postgres (call-end report → dashboard shows the call; tool limits at the edge); fresh whole-branch review; commit per repo.
