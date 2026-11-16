/**
 * Reminder calls placed by the voice server: account checked like an inbound call,
 * dialed with answering-machine detection, voicemail gets the reminder read out,
 * and every try's outcome goes back to the platform.
 * Run: node test/outboundCalls.test.js
 */
const assert = require("assert");
const express = require("express");
const createCallRoutes = require("../routes/calls");
const createOutboundRoutes = require("../routes/outbound");
const { CallStore } = require("../utils/callStore");

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`       ${err.message}`);
    process.exitCode = 1;
  }
}
const silent = { info() {}, warn() {}, error() {} };
const SECRET = "int-secret";
const MEMBER = "+15550003333";

async function start({ callerCheck, twilioFails = false } = {}) {
  const dialed = [];
  const results = [];
  const checkins = [];
  const usage = [];
  const callStore = new CallStore();
  const config = {
    publicBaseUrl: "https://voice.example.test",
    ringDelaySeconds: 0,
    twilio: { phoneNumber: "+18005550100", outboundCallerId: "+18005550199" },
    platform: { integrationSecret: SECRET },
    reminderCallMaxSeconds: 300,
  };
  const platformApi = {
    enabled: true,
    callerCheck: async () => callerCheck,
    notifyCallStart: async () => ({ ok: true }),
    notifyCallEnd: async () => ({ ok: true }),
    reportUsage: async (p) => (usage.push(p), { ok: true }),
    trialReport: async () => ({ ok: true }),
    reportReminderResult: (p) => results.push(p),
    reportCheckinResult: (p) => checkins.push(p),
  };
  const twilioClient = {
    calls: Object.assign((sid) => ({ fetch: async () => ({ sid, status: "completed" }) }), {
      create: async (opts) => {
        if (twilioFails) throw new Error("Twilio said no");
        dialed.push(opts);
        return { sid: `CAout${dialed.length}` };
      },
    }),
  };
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(createCallRoutes({ logger: silent, callStore, config, services: { email: { sendTranscript: async () => {} }, platformApi } }));
  app.use(createOutboundRoutes({ logger: silent, callStore, config, twilioClient, platformApi }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (path, body, secret = SECRET) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-integration-secret": secret }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const form = (path, body) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() }).then((r) => r.text());
  const get = (path, secret = SECRET) =>
    fetch(`${base}${path}`, { headers: { "x-integration-secret": secret } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const close = () => {
    server.closeAllConnections();
    server.close();
  };
  return { dialed, results, checkins, usage, callStore, json, form, get, close };
}

const member = { allowed: true, mode: "subscriber_platinum", userId: "u1", secondsRemaining: 3000, tools: { mode: "limited", limits: { weather: 50 } }, timezone: "America/Chicago", reminderConsent: true, transcriptEmail: "m@example.test" };
const job = { reminderId: "r1", attempt: 1, to: MEMBER, userId: "u1", message: "Take your pills" };

(async () => {
  console.log("outbound reminder calls\n");

  await check("dials the member with machine detection, from the outbound number, and keeps the call's details", async () => {
    const t = await start({ callerCheck: member });
    const r = await t.json("/internal/outbound/reminder", job);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body, { ok: true, callSid: "CAout1" });
    const d = t.dialed[0];
    assert.strictEqual(d.to, MEMBER);
    assert.strictEqual(d.from, "+18005550199");
    assert.strictEqual(d.machineDetection, "DetectMessageEnd");
    assert.strictEqual(d.url, "https://voice.example.test/outbound-answer");
    assert.strictEqual(d.statusCallback, "https://voice.example.test/call-status");
    const s = t.callStore.get("CAout1");
    assert.strictEqual(s.platformUserId, "u1");
    assert.strictEqual(s.billingMode, "subscriber_platinum");
    assert.strictEqual(s.maxBillableSeconds, 300);
    assert.strictEqual(s.callerNumber, MEMBER);
    assert.deepStrictEqual(s.outbound, { kind: "reminder", reminderId: "r1", attempt: 1, message: "Take your pills" });
    t.close();
  });

  await check("fewer minutes left than the cap: the call is capped at what's left", async () => {
    const t = await start({ callerCheck: { ...member, mode: "subscriber", secondsRemaining: 120 } });
    await t.json("/internal/outbound/reminder", job);
    assert.strictEqual(t.callStore.get("CAout1").maxBillableSeconds, 120);
    t.close();
  });

  await check("account can't take calls (unpaid, no minutes) or the number is someone else's: not dialed", async () => {
    for (const cc of [{ allowed: false, message: "pay" }, { allowed: true, mode: "trial", maxSecondsThisCall: 60 }, { ...member, userId: "someone-else" }]) {
      const t = await start({ callerCheck: cc });
      const r = await t.json("/internal/outbound/reminder", job);
      assert.deepStrictEqual(r.body, { ok: false, skipped: "no_access" });
      assert.strictEqual(t.dialed.length, 0);
      t.close();
    }
  });

  await check("wrong secret or missing fields: refused", async () => {
    const t = await start({ callerCheck: member });
    assert.strictEqual((await t.json("/internal/outbound/reminder", job, "nope")).status, 401);
    assert.strictEqual((await t.json("/internal/outbound/reminder", { ...job, to: "" })).status, 400);
    assert.strictEqual(t.dialed.length, 0);
    t.close();
  });

  await check("the same try asked twice (platform timed out and retried): one dial, same call id", async () => {
    const t = await start({ callerCheck: member });
    const [a, b] = await Promise.all([t.json("/internal/outbound/reminder", job), t.json("/internal/outbound/reminder", job)]);
    assert.strictEqual(t.dialed.length, 1);
    assert.strictEqual(a.body.callSid, b.body.callSid);
    t.close();
  });

  await check("account check unavailable: 503 'not dialed' so the platform tries again, never 'skipped'", async () => {
    const t = await start({ callerCheck: { allowed: false, unavailable: true, message: "x" } });
    const r = await t.json("/internal/outbound/reminder", job);
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.body.notDialed, true);
    assert.strictEqual(t.dialed.length, 0);
    t.close();
  });

  await check("call status lookup for the platform: secret required, Twilio's status returned", async () => {
    const t = await start({ callerCheck: member });
    const sid = "CA" + "a".repeat(32);
    const ok = await t.get(`/internal/outbound/status?callSid=${sid}`);
    assert.deepStrictEqual(ok, { status: 200, body: { status: "completed" } });
    assert.strictEqual((await t.get(`/internal/outbound/status?callSid=${sid}`, "nope")).status, 401);
    assert.strictEqual((await t.get("/internal/outbound/status?callSid=bad")).status, 400);
    t.close();
  });

  await check("check-in call: not billed, 3-minute cap, outcome reported as a check-in, no minutes used", async () => {
    const results = [];
    const t = await start({ callerCheck: { ...member, mode: "subscriber", secondsRemaining: 60 } });
    const r = await t.json("/internal/outbound/reminder", { kind: "checkin", checkinId: "k1", attempt: 2, to: MEMBER, userId: "u1", memberName: "Rosa", language: "en" });
    assert.strictEqual(r.body.ok, true);
    const s = t.callStore.get("CAout1");
    assert.strictEqual(s.billingMode, "checkin");
    assert.strictEqual(s.maxBillableSeconds, 180, "not limited by the 60 s of plan minutes left");
    assert.strictEqual(s.outbound.kind, "checkin");
    assert.strictEqual(s.outbound.memberName, "Rosa");
    await t.form("/outbound-answer", { CallSid: "CAout1", AnsweredBy: "human" });
    await t.form("/call-status", { CallSid: "CAout1", CallStatus: "completed", CallDuration: "170" });
    await new Promise((res) => setTimeout(res, 20));
    assert.deepStrictEqual(t.checkins, [{ checkinId: "k1", attempt: 2, outcome: "answered", callSid: "CAout1" }]);
    assert.deepStrictEqual(t.results, [], "not a reminder result");
    assert.deepStrictEqual(t.usage, [], "check-ins don't use plan minutes");
    void results;
    t.close();
  });

  await check("check-in to voicemail: a short message, counted as not answered", async () => {
    const t = await start({ callerCheck: member });
    await t.json("/internal/outbound/reminder", { kind: "checkin", checkinId: "k2", attempt: 1, to: MEMBER, userId: "u1", memberName: "Rosa" });
    const xml = await t.form("/outbound-answer", { CallSid: "CAout1", AnsweredBy: "machine_end_beep" });
    assert.ok(/Hi Rosa, it's Buddy with your daily call/.test(xml));
    await t.form("/call-status", { CallSid: "CAout1", CallStatus: "completed", CallDuration: "12" });
    await new Promise((res) => setTimeout(res, 20));
    assert.strictEqual(t.checkins[0].outcome, "voicemail");
    t.close();
  });

  await check("Twilio refuses: 502 so the platform tries again", async () => {
    const t = await start({ callerCheck: member, twilioFails: true });
    const r = await t.json("/internal/outbound/reminder", job);
    assert.strictEqual(r.status, 502);
    t.close();
  });

  await check("a person answers: Buddy's stream connects", async () => {
    const t = await start({ callerCheck: member });
    await t.json("/internal/outbound/reminder", job);
    const xml = await t.form("/outbound-answer", { CallSid: "CAout1", AnsweredBy: "human" });
    assert.ok(/<Connect><Stream url="wss:\/\/voice.example.test\/media-stream"/.test(xml), xml);
    assert.strictEqual(t.callStore.get("CAout1").outbound.outcome, "answered");
    t.close();
  });

  await check("voicemail: the reminder is read out and the call ends", async () => {
    const t = await start({ callerCheck: member });
    await t.json("/internal/outbound/reminder", job);
    const xml = await t.form("/outbound-answer", { CallSid: "CAout1", AnsweredBy: "machine_end_beep" });
    assert.ok(/Take your pills/.test(xml) && /<Hangup\/>/.test(xml) && !/<Stream/.test(xml), xml);
    assert.strictEqual(t.callStore.get("CAout1").outbound.outcome, "voicemail");
    t.close();
  });

  await check("an answer for a call we don't know: hang up", async () => {
    const t = await start({ callerCheck: member });
    const xml = await t.form("/outbound-answer", { CallSid: "CAunknown", AnsweredBy: "human" });
    assert.ok(/<Hangup\/>/.test(xml) && !/<Stream/.test(xml));
    t.close();
  });

  await check("each try's outcome is reported: answered, no answer, busy", async () => {
    for (const [answer, status, expected] of [["human", "completed", "answered"], [null, "no-answer", "no-answer"], [null, "busy", "busy"], [null, "failed", "failed"]]) {
      const t = await start({ callerCheck: member });
      await t.json("/internal/outbound/reminder", job);
      if (answer) await t.form("/outbound-answer", { CallSid: "CAout1", AnsweredBy: answer });
      await t.form("/call-status", { CallSid: "CAout1", CallStatus: status, CallDuration: answer ? "45" : "0" });
      await new Promise((r) => setTimeout(r, 20));
      assert.deepStrictEqual(t.results, [{ reminderId: "r1", attempt: 1, outcome: expected, callSid: "CAout1" }], status);
      t.close();
    }
  });

  await check("an answered reminder call uses plan minutes like any call", async () => {
    const t = await start({ callerCheck: member });
    await t.json("/internal/outbound/reminder", job);
    await t.form("/outbound-answer", { CallSid: "CAout1", AnsweredBy: "human" });
    await t.form("/call-status", { CallSid: "CAout1", CallStatus: "completed", CallDuration: "45" });
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(t.usage[0].secondsConsumed, 45);
    assert.strictEqual(t.usage[0].userId, "u1");
    assert.strictEqual(t.usage[0].callerNumber, MEMBER, "the member, not our number");
    t.close();
  });

  console.log(`\n${passed} passed`);
})();
