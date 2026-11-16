# Phase 5: Outbound reminder calls

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Plus and Family Premium members set reminders by voice or on the dashboard; Buddy calls them at the time, says the reminder, and can keep talking. Only after the member agreed by keypad on a recorded call.

**Architecture:** The backend owns reminders (table, limits, consent, schedule) and a 30-second dispatch loop in the worker. When one is due it asks the voice server to place the call; the voice server checks the account like an inbound call, dials with answering-machine detection, and reports the outcome through its outbox. Missed reminders (no answer twice, 15 minutes apart) and ones that can't be placed are emailed.

**Spec:** FINAL APIs §1 rows 12–13, §4 "Twilio Voice outbound", §6; FINAL Plans §2.1 (reminders 10 / 30 a month), §3 ("Inbound calls and reminder calls count"); scope memory: keypad consent menu, reminder tool (create/list/cancel by voice), custom opening line and goodbye on outbound calls, in-backend scheduler (not EventBridge), no SMS.

## Global Constraints
- No outbound call without the member's recorded consent for that phone line (keypad 1 on a call).
- A reminder uses one "reminders" unit when it is created; cancelling before the call gives it back. Pay As You Go / Basic: not in plan.
- Reminder calls use plan minutes like inbound calls (same caller check and usage report), capped at 5 minutes.
- Retry: no answer / busy / failed → once more after 15 minutes, then email the reminder. Voicemail counts as delivered (the reminder is left as a message).
- Times are the member's local time (User.timezone, default America/New_York).
- Never run anything against production; E2E on Docker Postgres; no live Twilio or OpenAI calls.

## Review Focus
1. Two workers at once never place the same reminder call twice (row claim).
2. The voice server is down at dispatch: retried, never lost, never double-dialed.
3. Consent: no consent, no call — on every path (voice, dashboard, dispatch).
4. Cancel while the call is being placed: no unit refund after a call was made; no call after cancel was confirmed.
5. Time zones and DST: "tomorrow at 9" lands at 9 local.

## Tasks
1. Backend schema + reminders lib (create/list/cancel, consent, local→UTC) + integration and user routes. Tests `reminders.test.js`.
2. Backend dispatch loop + result endpoint + missed email. Tests `reminderDispatch.test.js`.
3. Voice: outbound route, answer webhook with AMD, call-status result report, reminder greeting. Tests `outboundCalls.test.js`.
4. Voice: reminder tools (both modes) + keypad consent. Tests `reminderTools.test.js` + routing.
5. Frontend: Reminders page (list, cancel, create, time zone, consent state). Tests `reminderView.test.mjs`.
6. Verify: suites, lint, build, Postgres E2E (concurrent dispatch, consent, limits), browser, fresh review, commit.
