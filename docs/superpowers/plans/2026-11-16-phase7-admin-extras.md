# Phase 7: Admin extras — kill switches, free-minute switch, cost reports, budget alerts

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Admins can turn each service off at once (live tools, reminder calls, check-in calls, summaries) and the free first minute, see costs per call, customer and plan (check-in minutes apart), and get an email when a provider's monthly budget reaches 80% and 100%.

**Spec:** FINAL APIs §6 "Costs: log the cost of every call and request per customer and plan. Budget alerts per provider. A kill switch for each service in the admin panel."; Tech Spec v3 "Per call, customer and plan; check-in minutes shown separately"; scope memory (admin cost reports, kill switches, budget alert email, free-minute switch).

## Global Constraints
- One settings row read through a short cache (like the plan table); a save takes effect on this process at once and on others within 30 s.
- A switched-off tool is never called and Buddy says it isn't available right now (not "not in your plan"); no unit is used.
- Switched-off reminders/check-ins: no new calls placed; due reminders are emailed instead; check-ins of that day are skipped.
- Free minute off: unknown callers hear the subscribe message; nothing else changes.
- Costs are estimates: AI cost from the voice server per call; phone minutes and tool requests at unit prices the admin sets.
- Budget alert: once per provider, month and threshold, to admin accounts (or ADMIN_ALERT_EMAILS).
- Admin API only for isAdmin accounts.

## Tasks
1. Backend settings store + admin settings API; switches applied (tools, reminders, check-ins, summaries, free minute). Tests.
2. Backend cost report API + budget alert job. Tests.
3. Voice: switched-off tool message in the gate. Tests.
4. Frontend: /admin/controls and /admin/costs. Tests.
5. Verify: suites, lint, build, Postgres E2E, browser, fresh review, commit.
