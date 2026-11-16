# Phase 6: Family Premium — daily check-ins, relatives, family dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Family Premium members get a daily check-in call from Buddy at a chosen time (not billed, up to 3 minutes). If two tries go unanswered, up to two relatives get an alert (email + family dashboard) and Buddy tries once more an hour later. The member agrees by voice or keypad on their first call and chooses what relatives see: status only, summaries, or full transcripts.

**Spec:** Technical Specification v3 §Family Premium (lines on check-ins, consent, sharing, acceptance tests), B9 wording; FINAL Plans §2 (Family Premium: daily check-in, family dashboard 2 relatives); scope memory (no SMS: alerts by email + dashboard; in-backend scheduler).

## Global Constraints
- No check-in call before the member's recorded consent; a "no" stops check-ins and the account holder is told by email.
- Check-ins don't use plan minutes (no usage report), capped at 180 s.
- Tries: at the time, +15 min; after 2 unanswered → one alert to each relative → one more try 60 min later.
- Alerts say "not an emergency service"; relatives can opt out (link in every email).
- "Status only" shares no summaries or transcripts with relatives — on every path (family page, emails, gift owner's call pages).
- Plans: features.dailyCheckin and features.relativesMax from the plan table.

## Review Focus
1. Exactly one alert per relative per missed check-in, with two workers.
2. A check-in never runs twice for the same day; downtime doesn't produce a burst of past days.
3. Sharing level enforced on the family page, its call detail, and the gift owner's call pages.
4. Consent "no" or withdrawal stops future check-ins at once (including one already generated for today).
5. Family view tokens: unguessable, stored hashed, revocable.

## Tasks
1. Backend schema + family lib (schedule, consent, sharing, relatives with view tokens) + routes. Tests `family.test.js`.
2. Backend check-in dispatch (generate today's occurrence, tries, alerts, results). Tests `checkinDispatch.test.js`.
3. Backend family view API (public token) + sharing on the owner's call pages. Tests `familyView.test.js`.
4. Voice: check-in calls (route kind, not billed, 3 min, opening line, voicemail), consent + sharing menu by keypad or yes/no, withdraw by voice. Tests.
5. Frontend: owner Family page (check-in settings, consent status, relatives, log) + public /family/[token] page. Tests.
6. Verify: suites, lint, build, Postgres E2E (two loops, alerts once, sharing), browser, fresh review, commit.
